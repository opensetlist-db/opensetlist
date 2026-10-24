// Common font delivery, actual glyphs and readable fallback on every public
// page type. Resource interception happens before navigation in a fresh context
// for each cell; the cold and failure checks therefore cannot borrow fonts
// already cached by the normal cell. This scenario never writes application data.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { WEIGHTS, SPECIMEN, FONT_URL, realWeights, noLoadedFaces, rejectedFaces, fallbackGlyphs, classifyRequestFailure, runtimeFailures, observeFontResponses, responseErrors, verifyFontResponses } from "../font-proof.mjs";

const PAGES = {
  home: "", events: "/events", artists: "/artists", albums: "/albums",
  event: "/events/111/rehearsal-lovelive-fes-2020-day1",
  artist: "/artists/1/hasunosora",
  album: "/albums/459/s-memorial-cd-box-complete-best-box",
  song: "/songs/765/eternalize-love",
  member: "/members/e750790e-215c-410f-b1b2-37825ac43d69/anyoji-hime",
  series: "/series/8", privacy: "/privacy", terms: "/terms",
  search: "/search?q=Dream&type=all",
};
const ROLES = ["header .font-josefin", "footer .font-josefin", "main h1", "main h2", "main a"];

async function shot(page, file, cold = false) {
  // Viewport evidence is deliberate: page-specific layout and full-page
  // approval comparisons belong to each consumer, while this isolates the
  // shared roles and the mixed-script specimen at a readable scale.
  // The cold shot must not wait for the deliberately held responses.
  // Restore the process flag even on an error so later scenarios keep
  // Playwright's normal screenshot font-readiness guarantee.
  const prior = process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY;
  if (cold) process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = "1";
  try {
    await sharp(await page.screenshot({ animations: "disabled" })).webp({ quality: 90 }).toFile(file);
  } finally {
    if (prior === undefined) delete process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY;
    else process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = prior;
  }
}

async function roles(page) {
  return page.evaluate((selectors) => {
    const inspect = (el) => {
      if (!el) return null;
      const css = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        text: el.textContent.trim().slice(0, 160), family: css.fontFamily,
        weight: css.fontWeight, size: css.fontSize, lineHeight: css.lineHeight,
        tracking: css.letterSpacing, transform: css.textTransform,
        color: css.color, background: css.backgroundColor, border: css.borderColor,
        width: r.width, height: r.height,
      };
    };
    return {
      lang: document.documentElement.lang,
      overflow: document.documentElement.scrollWidth - innerWidth,
      roles: selectors.map((selector) => ({ selector, ...inspect(document.querySelector(selector)) })),
      symbols: [...document.querySelectorAll('header img[src*="opensetlist-symbol"], footer img[src*="opensetlist-symbol"]')].map(inspect),
      faces: [...document.fonts].filter((f) => f.status !== "unloaded").map((f) => ({ family: f.family, weight: f.weight, status: f.status })),
      cls: window.__foundationCLS ?? null,
    };
  }, ROLES);
}

async function platformFonts(ctx, page, selectors) {
  const cdp = await ctx.newCDPSession(page);
  try {
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument");
    const rows = [];
    for (const selector of selectors) {
      const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
      if (nodeId) rows.push({ selector, ...(await cdp.send("CSS.getPlatformFontsForNode", { nodeId })) });
    }
    return rows;
  } finally {
    await cdp.detach();
  }
}

async function specimen(page) {
  await page.evaluate(({ weights, texts }) => {
    const panel = document.createElement("aside");
    panel.id = "foundation-font-specimen";
    panel.style.cssText = "position:fixed;inset:0;z-index:999999;background:white;color:#172445;padding:16px;overflow:auto;font-family:var(--font-body)";
    const label = document.createElement("p");
    label.textContent = "Font diagnostic / 400 · 500 · 600 · 700";
    panel.append(label);
    for (const w of weights) {
      const row = document.createElement("div");
      row.style.cssText = `font-size:20px;line-height:1.8;font-weight:${w};margin:12px 0;overflow-wrap:anywhere`;
      for (const [script, text] of Object.entries(texts)) {
        const span = document.createElement("span");
        span.id = `foundation-${script}-${w}`;
        span.textContent = text;
        row.append(span);
      }
      panel.append(row);
    }
    document.body.append(panel);
  }, { weights: WEIGHTS, texts: SPECIMEN });
}

export function createFoundationScenario({ smoke = false, manifest = null } = {}) {
return {
  name: "shared-foundation",
  async run(h) {
    let failed = false;
    const check = (name, ok, detail) => {
      if (!ok) failed = true;
      h.check(name, ok, detail);
    };
    const entries = [];
    const file = path.join(h.outDir, `font-evidence-${h.browserName}${h.quick ? "-quick" : ""}.json`);
    const save = () => fs.writeFileSync(file, JSON.stringify({ base: h.base, smoke, manifestSha256: manifest?.sha256 ?? null, at: new Date().toISOString(), entries }, null, 2));
    // The full browser/locale/width shell matrix is run by shell-qa. These
    // cells isolate the approved desktop/mobile font boundary and failure.
    const locales = smoke || h.quick ? ["ko"] : ["ja", "ko", "en"];
    const widths = smoke || h.quick ? [390] : [1440, 390];
    for (const [key, p] of Object.entries(smoke ? { privacy: PAGES.privacy } : PAGES)) {
      for (const locale of locales) for (const width of widths) {
        for (const state of ["normal", "cold", "failure"]) {
          const name = `${key}/${locale}/${width}/${state}`;
          const completed = await h.section(name, async () => {
            let release;
            const gate = new Promise((resolve) => { release = resolve; });
            const attempts = [];
            let observer;
            const exceptions = [];
            const unexpectedFailures = [];
            let held = 0;
            const item = { key, locale, width, height: 1000, dpr: 1, timezone: "UTC", state, at: new Date().toISOString() };
            try {
              const { ctx, page, resp, errors } = await h.open(`/${locale}${p}`, {
                width, height: 1000, waitUntil: "domcontentloaded", waitForFonts: state !== "cold",
                beforeNavigate: async ({ ctx, page }) => {
                  page.on("pageerror", (e) => exceptions.push(String(e)));
                  page.on("requestfailed", (r) => {
                    if (classifyRequestFailure(r, state) === "unexpected") unexpectedFailures.push(`${r.url()} ${r.failure()?.errorText}`);
                  });
                  await page.addInitScript(() => {
                    if (PerformanceObserver.supportedEntryTypes?.includes("layout-shift")) {
                      window.__foundationCLS = 0;
                      new PerformanceObserver((list) => {
                        for (const e of list.getEntries()) if (!e.hadRecentInput) window.__foundationCLS += e.value;
                      }).observe({ type: "layout-shift", buffered: true });
                    }
                  });
                  observer = observeFontResponses(page);
                  await ctx.route("**/*", async (route) => {
                    const req = route.request();
                    if (!["GET", "HEAD"].includes(req.method()) || /google-analytics|googletagmanager|sentry\.io|speed-insights/.test(req.url())) return route.abort();
                    if (FONT_URL.test(req.url())) {
                      attempts.push(req.url());
                      if (state === "failure") return route.abort();
                      if (state === "cold") { held++; await gate; }
                    }
                    return route.continue();
                  });
                },
              });
              check(`${name} HTTP`, resp?.status() === 200, `${resp?.status()} ${page.url()}`);
              if (state === "cold") {
                await page.waitForTimeout(700);
                check(`${name} font gate active`, held > 0, `held ${held}`);
              } else {
                await page.waitForTimeout(350);
                check(`${name} font requests observed`, attempts.length > 0, `${attempts.length} font requests`);
              }
              item.url = page.url();
              item.page = await roles(page);
              if (state !== "normal") {
                check(`${name} no custom faces loaded`, noLoadedFaces(item.page.faces), JSON.stringify(item.page.faces));
                if (state === "failure") check(`${name} rejected faces observed`, rejectedFaces(item.page.faces), `${item.page.faces.length} attempted faces`);
              }
              check(`${name} readable roles`, item.page.roles.every((r) => r.text && r.width > 0 && r.height > 0), JSON.stringify(item.page.roles.map((r) => [r.selector, r.text])));
              check(`${name} overflow`, item.page.overflow <= 1, `${item.page.overflow}px`);
              check(`${name} language`, item.page.lang === locale, item.page.lang);
              const capture = `${key}-${locale}-${width}-${state}-${h.browserName}.webp`;
              await shot(page, path.join(h.outDir, capture), state === "cold");
              item.capture = capture;
              if (!h.webkit) {
                item.platformFonts = await platformFonts(ctx, page, ROLES);
                if (state !== "normal") check(`${name} actual fallback glyphs`, fallbackGlyphs(item.platformFonts), JSON.stringify(item.platformFonts));
              }
              if (state === "cold") {
                release();
                await page.evaluate(() => document.fonts.ready.then(() => undefined));
                item.afterRelease = await roles(page);
                if (!h.webkit) item.releasedFonts = await platformFonts(ctx, page, ROLES);
              }
              if (state !== "failure") {
                const logos = item.page.roles.filter((r) => r.selector.includes("josefin"));
                if (state === "normal") check(`${name} logo metrics`, logos.length === 2 && logos.every((r) => r.weight === "400" && r.transform === "uppercase" && Math.abs(parseFloat(r.tracking) - parseFloat(r.size) * 0.02) < 0.01), JSON.stringify(logos));
                await specimen(page);
                await page.evaluate(() => document.fonts.ready.then(() => undefined));
                const selectors = WEIGHTS.flatMap((w) => ["latin", "ja", "ko"].map((s) => `#foundation-${s}-${w}`));
                item.specimen = `${key}-${locale}-${width}-${state}-specimen-${h.browserName}.webp`;
                await shot(page, path.join(h.outDir, item.specimen));
                if (!h.webkit) {
                  item.specimenFonts = await platformFonts(ctx, page, selectors);
                  check(`${name} actual custom glyphs and weights`, realWeights(item.specimenFonts), JSON.stringify(item.specimenFonts));
                } else {
                  const faces = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => ({ family: f.family.replaceAll('"', ""), weight: f.weight })));
                  check(`${name} loaded specimen weights`, ["DM Sans", "Noto Sans KR", "Noto Sans JP"].every((family) => WEIGHTS.every((w) => faces.some((f) => f.family === family && f.weight === String(w)))), JSON.stringify(faces));
                  h.skip(`${name} CDP glyph proof`, "WebKit has no CDP CSS platform fonts API; resource hashes + screenshots retained, actual iOS owner validation separate");
                }
                await page.locator("#foundation-font-specimen").evaluate((el) => el.remove());
              }
              // Generic resource console lines omit their URL in Chromium.
              // The requestfailed listener above admits only the exact font
              // fault/telemetry resources; page exceptions are never filtered.
              const failures = runtimeFailures({ errors, exceptions, requests: unexpectedFailures });
              check(`${name} runtime`, failures.length === 0, failures.join("; "));
              const responses = await observer.finish();
              check(`${name} response bodies recorded`, responseErrors(responses).length === 0, JSON.stringify(responseErrors(responses)));
              if (manifest) {
                const mismatches = verifyFontResponses(responses, manifest, { requireResponses: state !== "failure" });
                check(`${name} approved font response SHA`, mismatches.length === 0, mismatches.join("; "));
              }
              item.attempts = attempts;
              item.fontResponses = responses;
            } finally {
              release();
              // Even a navigation/screenshot throw must retain the response
              // errors already consumed by the listener.
              if (observer) item.fontResponses = await observer.finish();
              item.attempts = attempts;
              entries.push(item);
              save();
            }
          }, { ms: h.timeoutMs * 4 });
          if (smoke && (!completed || failed)) return;
        }
      }
    }
    save();
  },
};
}
export default createFoundationScenario();
