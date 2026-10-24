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
      localStorage.setItem(`predict-${id}`, JSON.stringify({ eventId: id, songs,
        savedAt: "2026-10-08T00:00:00.000Z", lockedAt: null }));
    }, { id, songs });
    if (extra) await extra({ ctx, page });
  };
}

async function enter(page, loc) {
  const m = messages[loc];
  const tab = page.getByRole("tab", { name: m.Setlist.tabPredicted, exact: true });
  if (await tab.count()) await tab.click();
  const entry = page.getByRole("button", { name: /🎯/ }).filter({ hasText: /./ }).last();
  await entry.waitFor();
  await entry.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").waitFor();
  return { entry, dialog: page.getByRole("dialog") };
}

async function save(page, loc, file) {
  const download = page.waitForEvent("download", { timeout: 25000 });
  await page.getByRole("button", { name: messages[loc].ShareCard.downloadImage, exact: true }).click();
  const result = await download;
  await result.saveAs(file);
  const bytes = fs.readFileSync(file);
  const size = await sharp(bytes).metadata();
  return { file, bytes: bytes.length, sha256: sha(bytes), width: size.width, height: size.height };
}

const scenario = {
  name: "share-export",
  async run(h) {
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
    for (const loc of locales) for (const [phase, id] of Object.entries(PHASES)) {
      await h.section(`${phase} ${loc} actual exports`, async () => {
        let observer;
        const { ctx, page } = await h.open(`/${loc}/events/${id}`, { width: 390,
          beforeNavigate: seed(id, songs, async ({ page }) => {
            const responses = new Map();
            // Record bytes at the delivery boundary. html2canvas removes
            // its cloned iframe, invalidating response.body's CDP ids;
            // route.fetch retains the actual bytes fulfilled to each frame.
            await page.route(/\.woff2?(?:\?|$)/, async (route) => {
              const response = await route.fetch();
              const bytes = await response.body();
              responses.set(response.url(), { url: response.url(), status: response.status(),
                bytes: bytes.length, sha256: sha(bytes) });
              await route.fulfill({ response, body: bytes });
            });
            observer = { finish: async () => [...responses.values()] };
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
          let platform = null;
          if (!h.webkit) {
            platform = await fonts(ctx, page);
            const logo = platform.find((row) => row.selector === wordmark);
            h.check(`${name}: actual Josefin regular custom glyphs`, logo?.fonts.length > 0 &&
              logo.fonts.every((font) => font.isCustomFont && font.glyphCount > 0 && /JosefinSans(?:Thin)?-Regular/.test(font.postScriptName)), JSON.stringify(logo));
          } else h.skip(`${name}: CDP glyph proof`, "Windows WebKit has no CDP; actual PNG is still exported");
          evidence.push({ phase, loc, theme, id, url: page.url(), viewport: { width: 390, height: 900 },
            ...output, style, platform, text, at: new Date().toISOString() });
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

    await h.section("PNG clipboard and canvas failure/retry", async () => {
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
  },
};
export default scenario;
