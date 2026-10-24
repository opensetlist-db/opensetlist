// Existing event-page entry → actual html2canvas PNG/clipboard boundaries.
// Personal predictions are isolated localStorage fixtures; all app/DB traffic
// is read-only. Native-share faults are explicitly simulated, never iOS proof.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { loadFontManifest, verifyFontResponses } from "../font-proof.mjs";

const PHASES = { prediction: "109", live: "111", final: "2" };
const CARD = '[data-share-card]';
const wordmark = `${CARD} > div:last-child > span:first-child`;
const messages = Object.fromEntries(["ja", "ko", "en"].map((loc) => [loc,
  JSON.parse(fs.readFileSync(path.resolve("messages", `${loc}.json`), "utf8")),
]));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function fonts(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  try {
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument");
    const result = [];
    for (const selector of ["header .font-josefin", "footer .font-josefin", wordmark,
      `${CARD} [data-capture-shift="event-title"]`, `${CARD} [data-capture-shift="row-title"]`,
      `${CARD} [data-capture-shift="row-number"]`, `${CARD} [data-capture-shift="score-percent"]`]) {
      const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
      if (nodeId) result.push({ selector, ...(await cdp.send("CSS.getPlatformFontsForNode", { nodeId })) });
    }
    return result;
  } finally { await cdp.detach(); }
}

function seed(id, songs, extra = null) {
  return async ({ ctx, page }) => {
    await ctx.addInitScript(({ id, songs }) => {
      if (sessionStorage.getItem("c18-seeded")) return;
      sessionStorage.setItem("c18-seeded", "1");
      localStorage.setItem(`predict-${id}`, JSON.stringify({ eventId: id, songs,
        savedAt: "2026-10-08T00:00:00.000Z", lockedAt: null }));
    }, { id, songs });
    if (extra) await extra({ ctx, page });
  };
}

async function enter(page, loc, key = "Enter") {
  const m = messages[loc];
  const tab = page.getByRole("tab", { name: m.Setlist.tabPredicted, exact: true });
  // Personal state mounts after the initial SSR/hydration boundary.
  // Counting once can skip a not-yet-mounted tab on slower WebKit.
  await tab.waitFor();
  await tab.click();
  const entry = page.getByRole("button", { name: /🎯/ }).filter({ hasText: /./ }).last();
  await entry.waitFor();
  await entry.focus();
  await page.keyboard.press(key);
  await page.getByRole("dialog").waitFor();
  return { entry, dialog: page.getByRole("dialog") };
}

async function save(page, loc, file) {
  const download = page.waitForEvent("download", { timeout: 25000 });
  await page.getByRole("button", { name: messages[loc].ShareCard.downloadImage, exact: true }).click();
  const result = await download;
  return archiveDownload(result, file);
}

async function archiveDownload(result, file) {
  await result.saveAs(file);
  const bytes = fs.readFileSync(file);
  const size = await sharp(bytes).metadata();
  return { file, bytes: bytes.length, sha256: sha(bytes), width: size.width, height: size.height };
}

const scenario = {
  name: "share-export",
  async run(h) {
    const part = process.env.C18_QA_PART ?? "all";
    if (!["all", "exports", "controls", "faults"].includes(part)) {
      throw new Error(`Unknown C18_QA_PART: ${part}`);
    }
    const snapshot = JSON.parse(await h.getText("/api/setlist?eventId=111&locale=ko"));
    const songs = snapshot.items.filter((item) => item.type === "song")
      .flatMap((item) => item.songs.map(({ song }) => ({ songId: song.id, song }))).slice(0, 6);
    h.check("seed contains actual six songs", songs.length === 6, songs.map((song) => song.songId).join(","));
    const manifest = process.env.C18_FONT_MANIFEST ? loadFontManifest(process.env.C18_FONT_MANIFEST) : null;
    const evidence = [];
    const exports = path.join(h.outDir, "exports");
    fs.mkdirSync(exports, { recursive: true });
    const write = () => fs.writeFileSync(path.join(h.outDir, "export-evidence.json"), JSON.stringify({
      base: h.base, browser: h.browserName, at: new Date().toISOString(),
      fontManifest: manifest?.sha256 ?? null, source: "existing event entry; real PNG files, no DB mutation", evidence,
    }, null, 2));
    const locales = h.quick ? ["ko"] : ["ja", "ko", "en"];
    if (part === "all" || part === "exports") for (const loc of locales) for (const [phase, id] of Object.entries(PHASES)) {
      await h.section(`${phase} ${loc} actual exports`, async () => {
        let observer;
        const { ctx, page } = await h.open(`/${loc}/events/${id}`, { width: 390,
          beforeNavigate: seed(id, songs, async ({ page }) => {
            const responses = [];
            // Record bytes at the delivery boundary. html2canvas removes
            // its cloned iframe, invalidating response.body's CDP ids;
            // route.fetch retains the actual bytes fulfilled to each frame.
            await page.route(/\.woff2?(?:\?|$)/, async (route) => {
              try {
                const response = await route.fetch({ maxRetries: 2 });
                const bytes = await response.body();
                await route.fulfill({ response, body: bytes });
                responses.push({ url: response.url(), status: response.status(),
                  bytes: bytes.length, sha256: sha(bytes) });
              } catch (error) {
                // Closing a discarded capture iframe/context can abort an
                // in-flight request. Keep active delivery failures in the
                // evidence instead of rejecting an unhandled route promise.
                const url = route.request().url();
                responses.push({ url, status: 0, error: String(error) });
                await route.abort().catch(() => {});
              }
            });
            observer = { finish: async () => [...responses] };
          }),
        });
        const { entry, dialog } = await enter(page, loc);
        const m = messages[loc].ShareCard;
        const labels = await dialog.getByRole("button").allTextContents();
        h.check(`${phase} ${loc}: existing actions`, labels.includes(m.downloadImage), labels.join(" / "));
        for (const theme of ["light", "dark"]) {
          await page.getByRole("button", { name: theme === "light" ? m.themeLight : m.themeDark, exact: true }).click();
          const name = `${phase}-${loc}-${theme}`;
          const output = await save(page, loc, path.join(exports, `${name}.png`));
          h.check(`${name}: actual PNG 1200px`, output.width === 1200 && output.bytes > 10000, JSON.stringify(output));
          const visible = page.locator(CARD).first();
          const text = await visible.innerText();
          h.check(`${name}: uppercase source identity/privacy`, text.includes("OPENSETLIST") &&
            text.includes("opensetlist.com") && !text.includes("predict-") && !text.includes("savedAt"), text.slice(-110));
          const style = await page.locator(wordmark).first().evaluate((el) => {
            const s = getComputedStyle(el);
            return { family: s.fontFamily, weight: s.fontWeight, size: s.fontSize,
              spacing: s.letterSpacing, color: s.color, children: el.children.length };
          });
          h.check(`${name}: single-ink 24px regular wordmark`, style.weight === "400" &&
            style.size === "24px" && style.spacing === "0.48px" && style.children === 0, JSON.stringify(style));
          await sharp(output.file).webp({ quality: 90 }).toFile(path.join(exports, `${name}.webp`));
          await sharp(output.file).extract({ left: 40, top: output.height - 160, width: 1120, height: 145 })
            .resize({ width: 1680 }).webp({ quality: 90 }).toFile(path.join(exports, `${name}-logo.webp`));
          await h.shot(page, `${name}-modal`);
          let clipboard = null;
          let shared = null;
          if (!h.webkit) {
            const logoPixels = async (bytes) => sha(await sharp(bytes).extract({ left: 40,
              top: output.height - 160, width: 1120, height: 145 }).raw().toBuffer());
            const expectedLogo = await logoPixels(fs.readFileSync(output.file));
            await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
            await page.getByRole("button", { name: m.copyImage, exact: true }).click();
            await page.getByRole("status").getByText(m.imageCopiedToast, { exact: true }).waitFor();
            const copyBytes = Buffer.from(await page.evaluate(async () => {
              const items = await navigator.clipboard.read();
              return Array.from(new Uint8Array(await (await items[0].getType("image/png")).arrayBuffer()));
            }));
            const copyFile = path.join(exports, `${name}-clipboard.png`);
            fs.writeFileSync(copyFile, copyBytes);
            clipboard = { file: copyFile, bytes: copyBytes.length, sha256: sha(copyBytes) };
            h.check(`${name}: actual clipboard logo pixels match download`, await logoPixels(copyBytes) === expectedLogo, clipboard.sha256);
            // API-boundary simulation captures the actual File given to the
            // native share sheet. This is distinct from real iOS evidence.
            await page.evaluate(() => {
              Object.defineProperty(navigator, "share", { configurable: true, value: async (data) => {
                window.__c18Share = { url: data.url, title: data.title, text: data.text,
                  bytes: Array.from(new Uint8Array(await data.files[0].arrayBuffer())) };
              } });
            });
            await page.getByRole("button", { name: m.downloadImage, exact: true }).click();
            await page.waitForFunction(() => window.__c18Share?.bytes?.length > 0);
            const payload = await page.evaluate(() => window.__c18Share);
            const sharedBytes = Buffer.from(payload.bytes);
            const shareFile = path.join(exports, `${name}-share-file.png`);
            fs.writeFileSync(shareFile, sharedBytes);
            shared = { file: shareFile, bytes: sharedBytes.length, sha256: sha(sharedBytes),
              url: payload.url, title: payload.title, text: payload.text, kind: "native API boundary simulation" };
            h.check(`${name}: shared File logo pixels match download`, await logoPixels(sharedBytes) === expectedLogo, shared.sha256);
            h.check(`${name}: public URL and mode text retained`, new URL(payload.url).pathname.startsWith(`/${loc}/events/${id}`) &&
              payload.title.length > 0 && payload.text.length > 0 && !payload.url.includes("localhost"), payload.url);
            await page.evaluate(() => { delete navigator.share; delete window.__c18Share; });
          }
          let platform = null;
          if (!h.webkit) {
            platform = await fonts(ctx, page);
            const logo = platform.find((row) => row.selector === wordmark);
            h.check(`${name}: actual Josefin regular custom glyphs`, logo?.fonts.length > 0 &&
              logo.fonts.every((font) => font.isCustomFont && font.glyphCount > 0 && /JosefinSans(?:Thin)?-Regular/.test(font.postScriptName)), JSON.stringify(logo));
          } else h.skip(`${name}: CDP glyph proof`, "Windows WebKit has no CDP; actual PNG is still exported");
          evidence.push({ phase, loc, theme, id, url: page.url(), viewport: { width: 390, height: 900 },
            ...output, style, platform, clipboard, shared, text, at: new Date().toISOString() });
          write();
        }
        const responses = await observer.finish();
        if (manifest) h.check(`${phase} ${loc}: delivered approved font bytes`,
          verifyFontResponses(responses, manifest).length === 0, JSON.stringify(verifyFontResponses(responses, manifest)));
        else h.skip("font manifest comparison", "set C18_FONT_MANIFEST to the approved manifest");
        evidence.push({ phase, loc, fontResponses: responses });
        write();
        // Native controls and dialog keyboard boundary, including focus return.
        const buttons = dialog.getByRole("button");
        await buttons.last().focus();
        await page.keyboard.press("Tab");
        h.check(`${phase} ${loc}: Tab wraps`, await buttons.first().evaluate((el) => el === document.activeElement), "");
        await page.keyboard.press("Shift+Tab");
        h.check(`${phase} ${loc}: Shift+Tab wraps`, await buttons.last().evaluate((el) => el === document.activeElement), "");
        h.check(`${phase} ${loc}: background inert`, await page.locator("header").first().evaluate((el) => !!el.closest("[inert]")), "");
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "detached" });
        h.check(`${phase} ${loc}: focus restored`, await entry.evaluate((el) => el === document.activeElement), "");
        await ctx.close();
      }, { ms: 180000 });
    }

    if (part === "all" || part === "controls") for (const loc of locales) for (const width of (h.quick ? [390, 1440] : [320, 375, 390, 430, 768, 1024, 1440])) {
      await h.section(`controls ${loc} ${width}`, async () => {
        const { page } = await h.open(`/${loc}/events/109`, { width, beforeNavigate: seed("109", songs) });
        const { entry, dialog } = await enter(page, loc, width < 700 ? "Space" : "Enter");
        const action = page.getByRole("button", { name: messages[loc].ShareCard.downloadImage, exact: true });
        await page.keyboard.press("Tab");
        await action.focus();
        const focus = await action.evaluate((el) => {
          const s = getComputedStyle(el);
          return { outline: s.outline, offset: s.outlineOffset, radius: s.borderRadius,
            background: s.backgroundImage, shadow: s.boxShadow, minHeight: s.minHeight };
        });
        h.check(`${loc} ${width}: primary geometry/focus`, focus.radius === "8px" &&
          focus.background === "none" && focus.shadow === "none" && focus.minHeight === "44px" &&
          focus.outline.includes("3px") && focus.offset === "4px", JSON.stringify(focus));
        await action.hover();
        await page.waitForFunction((el) => getComputedStyle(el).backgroundColor === "rgb(16, 74, 169)",
          await action.elementHandle(), { timeout: 3000 });
        h.check(`${loc} ${width}: primary hover`, await action.evaluate((el) =>
          getComputedStyle(el).backgroundColor === "rgb(16, 74, 169)"), "");
        await page.mouse.down();
        await page.waitForFunction((el) => getComputedStyle(el).backgroundColor === "rgb(12, 61, 140)",
          await action.elementHandle(), { timeout: 3000 });
        h.check(`${loc} ${width}: primary pressed`, await action.evaluate((el) =>
          getComputedStyle(el).backgroundColor === "rgb(12, 61, 140)"), "");
        // Release over the card inside the dialog's content wrapper.
        // A down-inside/up-on-backdrop click targets the backdrop's
        // common ancestor and intentionally closes this dialog.
        const buttonBox = await action.boundingBox();
        await page.mouse.move(buttonBox.x + buttonBox.width / 2, buttonBox.y - 10);
        await page.mouse.up();
        await action.evaluate((el) => { el.querySelector("span").textContent += " — ".repeat(2) + el.textContent.repeat(3); });
        const fits = await dialog.getByRole("button").evaluateAll((els) => els.every((el) => {
          const r = el.getBoundingClientRect();
          return r.left >= 0 && r.right <= innerWidth && el.scrollWidth <= el.clientWidth + 1;
        }));
        h.check(`${loc} ${width}: long labels fit`, fits, "all modal buttons");
        await h.shot(page, `controls-${loc}-${width}`);
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "detached" });
        h.check(`${loc} ${width}: keyboard entry/return`, await entry.evaluate((el) => document.activeElement === el), "");
      });
    }

    if (part === "all" || part === "controls") await h.section("prediction entry 0/1 and picker completion consumer", async () => {
      const { page } = await h.open("/ko/events/109", { width: 390, beforeNavigate: seed("109", songs.slice(0, 1)) });
      const { dialog } = await enter(page, "ko");
      await page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
      await page.getByRole("button", { name: messages.ko.Predict.add, exact: true }).click();
      const confirm = page.getByRole("button", { name: messages.ko.Predict.picker.confirmButton.replace("{count}", "1"), exact: true });
      await confirm.waitFor();
      h.check("current-dev picker completion uses primary", await confirm.evaluate((el) => getComputedStyle(el).borderRadius === "8px"), "C10 local replacement remains owned by C10");
      await confirm.click();
      await confirm.waitFor({ state: "hidden" });
      h.check("picker completion closes picker", !(await confirm.isVisible()), "waited for sheet close transition");
      await page.evaluate(() => localStorage.removeItem("predict-109"));
      await page.reload({ waitUntil: "load" });
      await page.waitForTimeout(800);
      h.check("zero predictions hides share after positive one-pick entry", await page.getByRole("button", { name: /🎯/ }).count() === 0, "no DB writes");
    });

    if (part === "all" || part === "faults") await h.section("PNG clipboard and canvas failure/retry", async () => {
      const { ctx, page } = await h.open("/ko/events/111", { width: 390, beforeNavigate: seed("111", songs) });
      await enter(page, "ko");
      const copy = page.getByRole("button", { name: messages.ko.ShareCard.copyImage, exact: true });
      if (h.webkit) return h.skip("real clipboard", "Windows WebKit clipboard permission is unavailable; actual iOS remains required");
      await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
      await copy.click();
      await page.getByRole("status").getByText(messages.ko.ShareCard.imageCopiedToast, { exact: true }).waitFor();
      const payload = await page.evaluate(async () => {
        const items = await navigator.clipboard.read();
        const blob = await items[0].getType("image/png");
        return Array.from(new Uint8Array(await blob.arrayBuffer()));
      });
      const file = path.join(exports, "clipboard-ko-live.png");
      fs.writeFileSync(file, Buffer.from(payload));
      h.check("actual clipboard image/png 1200px", (await sharp(file).metadata()).width === 1200, `${payload.length} bytes`);
      await page.evaluate(() => {
        window.__originalToBlob = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function (callback) { setTimeout(() => callback(null), 500); };
      });
      await copy.click();
      h.check("busy disables both actions", await copy.isDisabled(), "");
      await page.getByRole("status").getByText(messages.ko.ShareCard.imageCopyFailedToast, { exact: true }).waitFor();
      h.check("failure releases busy for retry", await copy.isEnabled(), "");
      await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = window.__originalToBlob; });
      await copy.click();
      await page.getByRole("status").getByText(messages.ko.ShareCard.imageCopiedToast, { exact: true }).waitFor();
      h.check("same entry retry succeeds", await copy.isEnabled(), "actual clipboard write after canvas fault");
    }, { ms: 120000 });

    if (part === "all" || part === "faults") await h.section("source font and clone-only font failures recover", async () => {
      for (const cloneOnly of [false, true]) {
        let blocked = true;
        let faults = 0;
        const { page } = await h.open("/ko/events/109", { width: 390, waitForFonts: false,
          beforeNavigate: seed("109", songs, async ({ page }) => {
            await page.route(/\.woff2?(?:\?|$)/, async (route) => {
              if (blocked && (!cloneOnly || route.request().frame() !== page.mainFrame())) {
                faults++; return route.abort();
              }
              return route.continue();
            });
          }),
        });
        await enter(page, "ko");
        let downloaded = 0;
        page.on("download", () => downloaded++);
        await page.getByRole("button", { name: messages.ko.ShareCard.downloadImage, exact: true }).click();
        await page.getByRole("status").getByText(messages.ko.ShareCard.imageErrorToast, { exact: true }).waitFor();
        const label = cloneOnly ? "clone-only" : "source+clone";
        h.check(`${label}: font fault actually reached`, faults > 0, faults);
        h.check(`${label}: fallback export rejected`, downloaded === 0, downloaded);
        await h.shot(page, `font-failure-${label}`);
        const failedFaces = await page.evaluate(() => [...document.fonts].filter((face) => face.status === "error")
          .map((face) => ({ family: face.family, weight: face.weight, status: face.status })));
        blocked = false;
        let recovered;
        for (let attempt = 1; attempt <= 3 && !recovered; attempt++) {
          const errorToast = page.getByRole("status").getByText(messages.ko.ShareCard.imageErrorToast, { exact: true });
          await errorToast.waitFor({ state: "hidden", timeout: 10000 });
          // An automatic retry may have started while the route was still
          // offline. Its bounded failure must remain visible/retryable; a
          // subsequent click must create a fresh request, without a reload.
          // WebKit can first reject an old CSS face exposed as unloaded,
          // then settle the offline replacement before a fresh face loads.
          // Keep each error/no-output assertion and bound the whole recovery.
          let downloadedFile;
          const nextDownload = new Promise((resolve) => { downloadedFile = resolve; });
          page.on("download", downloadedFile);
          try {
            await page.getByRole("button", { name: messages.ko.ShareCard.downloadImage, exact: true }).click();
            const result = await Promise.race([
              nextDownload,
              errorToast.waitFor({ timeout: 20000 }).then(() => null),
            ]);
            if (result) recovered = await archiveDownload(result, path.join(exports, `font-retry-${label}.png`));
            else {
              const action = page.getByRole("button", { name: messages.ko.ShareCard.downloadImage, exact: true });
              await page.waitForFunction((el) => !el.disabled, await action.elementHandle(), { timeout: 20000 });
              h.check(`${label}: overlapping offline retry fails safely`, downloaded === 0 && await action.isEnabled(),
                `attempt ${attempt}; downloads=${downloaded}; retry enabled after error cleanup`);
            }
          } finally { page.off("download", downloadedFile); }
        }
        if (!recovered) throw new Error(`${label}: no PNG after three recovery attempts`);
        h.check(`${label}: retry creates actual PNG`, recovered.width === 1200 && downloaded > 0, recovered.sha256);
        evidence.push({ fault: label, faults, failedFaces, recovered }); write();
      }
    }, { ms: 180000 });

    if (part === "all" || part === "faults") await h.section("native share/cancel/fallback and analytics API boundaries", async () => {
      const { page } = await h.open("/ko/events/109", { width: 390,
        beforeNavigate: seed("109", songs, async ({ ctx }) => {
          await ctx.addInitScript(() => {
            window.__c18Events = []; window.__c18Calls = [];
            window.gtag = (...args) => window.__c18Events.push(args);
            window.__c18NativeMode = "success";
            Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
            Object.defineProperty(navigator, "share", { configurable: true, value: async (data) => {
              window.__c18Calls.push({ url: data.url, bytes: data.files[0].size,
                activation: navigator.userActivation?.isActive });
              if (window.__c18NativeMode === "abort") throw new DOMException("cancelled", "AbortError");
              if (window.__c18NativeMode === "fail") throw new Error("platform fault");
            } });
          });
        }),
      });
      const { dialog } = await enter(page, "ko");
      const share = page.getByRole("button", { name: messages.ko.ShareCard.shareImage, exact: true });
      await page.waitForTimeout(2000);
      // Preview's afterInteractive Google Analytics replaces the init-script
      // spy. Observe the actual export handler after that script has mounted.
      await page.evaluate(() => { window.gtag = (...args) => window.__c18Events.push(args); });
      await share.click();
      await page.waitForFunction(() => window.__c18Calls.length === 1);
      await page.waitForFunction(() => window.__c18Events.some((event) => event[1] === "share_card_save"));
      h.check("supported native label and actual File payload", await page.evaluate(() =>
        window.__c18Calls[0].bytes > 10000 && window.__c18Calls[0].activation), "API simulation; real iOS tested separately");
      const before = await page.evaluate(() => window.__c18Events.filter((event) => event[1] === "share_card_save").length);
      await page.evaluate(() => { window.__c18NativeMode = "abort"; });
      await share.click();
      await page.waitForFunction(() => window.__c18Calls.length === 2);
      const after = await page.evaluate(() => window.__c18Events.filter((event) => event[1] === "share_card_save").length);
      h.check("native cancel stays silent and modal remains usable", before > 0 && before === after && await dialog.isVisible(), `${before}→${after}`);
      await page.evaluate(() => { window.__c18NativeMode = "fail"; });
      const fallback = page.waitForEvent("download");
      await share.click();
      const file = await fallback; await file.saveAs(path.join(exports, "native-fallback.png"));
      h.check("native platform failure downloads actual PNG", (await sharp(path.join(exports, "native-fallback.png")).metadata()).width === 1200, "");
      if (!h.webkit) {
        await page.evaluate(() => Object.defineProperty(navigator.clipboard, "write", { configurable: true,
          value: async () => { throw new DOMException("denied", "NotAllowedError"); } }));
        await page.getByRole("button", { name: messages.ko.ShareCard.copyImage, exact: true }).click();
        await page.getByRole("status").getByText(messages.ko.ShareCard.imageCopyFailedToast, { exact: true }).waitFor();
        h.check("clipboard denial preserves failure analytics", await page.evaluate(() => window.__c18Events.some((event) =>
          event[1] === "share_card_save_failed" && event[2].reason === "clipboard_denied")), "");
      }
    }, { ms: 120000 });
  },
};
export default scenario;
