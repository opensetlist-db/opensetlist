// Common font delivery, actual glyphs and readable fallback on every public
// page type. Resource interception happens before navigation in a fresh context
// for each cell; the cold and failure checks therefore cannot borrow fonts
// already cached by the normal cell. This scenario never writes application data.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";

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
const WEIGHTS = [400, 500, 600, 700];
const ROLES = ["header .font-josefin", "footer .font-josefin", "main h1", "main h2", "main a"];
const FONT_URL = /\.woff2?(?:\?|$)/;

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
  await page.evaluate((weights) => {
    const panel = document.createElement("aside");
    panel.id = "foundation-font-specimen";
    panel.style.cssText = "position:fixed;inset:0;z-index:999999;background:white;color:#172445;padding:16px;overflow:auto;font-family:var(--font-body)";
    const label = document.createElement("p");
    label.textContent = "Font diagnostic / 400 · 500 · 600 · 700";
    panel.append(label);
    for (const w of weights) {
      const row = document.createElement("div");
      row.style.cssText = `font-size:20px;line-height:1.8;font-weight:${w};margin:12px 0;overflow-wrap:anywhere`;
      for (const [script, text] of Object.entries({ latin: "OpenSetlist 0123 ", ja: "ライブ出演 音楽 ", ko: "공연곡명 한국어 " })) {
        const span = document.createElement("span");
        span.id = `foundation-${script}-${w}`;
        span.textContent = text;
        row.append(span);
      }
      panel.append(row);
    }
    document.body.append(panel);
  }, WEIGHTS);
}

function realWeights(rows) {
  const suffix = { 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold" };
  return rows.length === 12 && rows.every((r) => {
    const weight = r.selector.split("-").at(-1);
    return r.fonts.length > 0 && r.fonts.every((f) =>
      f.isCustomFont && f.glyphCount > 0 && f.postScriptName.endsWith(`-${suffix[weight]}`),
    );
  });
}

const scenario = {
  name: "shared-foundation",
  async run(h) {
    const entries = [];
    const file = path.join(h.outDir, `font-evidence-${h.browserName}${h.quick ? "-quick" : ""}.json`);
    const save = () => fs.writeFileSync(file, JSON.stringify({ base: h.base, at: new Date().toISOString(), entries }, null, 2));
    // The full browser/locale/width shell matrix is run by shell-qa. These
    // cells isolate the approved desktop/mobile font boundary and failure.
    const locales = h.quick ? ["ko"] : ["ja", "ko", "en"];
    const widths = h.quick ? [390] : [1440, 390];
    for (const [key, p] of Object.entries(PAGES)) {
      for (const locale of locales) for (const width of widths) {
        for (const state of ["normal", "cold", "failure"]) {
          const name = `${key}/${locale}/${width}/${state}`;
          await h.section(name, async () => {
            let release;
            const gate = new Promise((resolve) => { release = resolve; });
            const attempts = [];
            const responses = [];
            const bodies = [];
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
                    const telemetry = /google-analytics|googletagmanager|sentry\.io|speed-insights/.test(r.url());
                    const fontFault = state !== "normal" && FONT_URL.test(r.url());
                    // The diagnostic overlay moves links out of view. Next
                    // cancels their speculative prefetches; active navigation
                    // and API requests never carry this prefetch header.
                    const prefetchAbort = r.headers()["next-router-prefetch"] === "1" && /ERR_ABORTED|cancelled|canceled/i.test(r.failure()?.errorText ?? "");
                    if (!telemetry && !fontFault && !prefetchAbort) unexpectedFailures.push(`${r.url()} ${r.failure()?.errorText}`);
                  });
                  await page.addInitScript(() => {
                    if (PerformanceObserver.supportedEntryTypes?.includes("layout-shift")) {
                      window.__foundationCLS = 0;
                      new PerformanceObserver((list) => {
                        for (const e of list.getEntries()) if (!e.hadRecentInput) window.__foundationCLS += e.value;
                      }).observe({ type: "layout-shift", buffered: true });
                    }
                  });
                  page.on("response", (r) => {
                    if (!FONT_URL.test(r.url())) return;
                    // Attach the rejection handler immediately: body() can
                    // reject before the later allSettled call is reached.
                    bodies.push(r.body().then(
                      (buf) => responses.push({ url: r.url(), bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex") }),
                      (error) => responses.push({ url: r.url(), error: String(error) }),
                    ));
                  });
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
              h.check(`${name} HTTP`, resp?.status() === 200, `${resp?.status()} ${page.url()}`);
              if (state === "cold") {
                await page.waitForTimeout(700);
                h.check(`${name} font gate active`, held > 0, `held ${held}`);
              } else {
                await page.waitForTimeout(350);
                h.check(`${name} font requests observed`, attempts.length > 0, `${attempts.length} font requests`);
              }
              item.url = page.url();
              item.page = await roles(page);
              if (state !== "normal") {
                h.check(`${name} no custom faces loaded`, item.page.faces.length > 0 && !item.page.faces.some((f) => f.status === "loaded"), JSON.stringify(item.page.faces));
                if (state === "failure") h.check(`${name} rejected faces observed`, item.page.faces.some((f) => f.status === "error"), `${item.page.faces.length} attempted faces`);
              }
              h.check(`${name} readable roles`, item.page.roles.every((r) => r.text && r.width > 0 && r.height > 0), JSON.stringify(item.page.roles.map((r) => [r.selector, r.text])));
              h.check(`${name} overflow`, item.page.overflow <= 1, `${item.page.overflow}px`);
              h.check(`${name} language`, item.page.lang === locale, item.page.lang);
              const capture = `${key}-${locale}-${width}-${state}-${h.browserName}.webp`;
              await shot(page, path.join(h.outDir, capture), state === "cold");
              item.capture = capture;
              if (!h.webkit) {
                item.platformFonts = await platformFonts(ctx, page, ROLES);
                if (state !== "normal") h.check(`${name} actual fallback glyphs`, item.platformFonts.length > 0 && item.platformFonts.every((r) => r.fonts.length > 0 && r.fonts.every((f) => !f.isCustomFont)), JSON.stringify(item.platformFonts));
              }
              if (state === "cold") {
                release();
                await page.evaluate(() => document.fonts.ready.then(() => undefined));
                item.afterRelease = await roles(page);
                if (!h.webkit) item.releasedFonts = await platformFonts(ctx, page, ROLES);
              }
              if (state !== "failure") {
                const logos = item.page.roles.filter((r) => r.selector.includes("josefin"));
                if (state === "normal") h.check(`${name} logo metrics`, logos.length === 2 && logos.every((r) => r.weight === "400" && r.transform === "uppercase" && Math.abs(parseFloat(r.tracking) - parseFloat(r.size) * 0.02) < 0.01), JSON.stringify(logos));
                await specimen(page);
                await page.evaluate(() => document.fonts.ready.then(() => undefined));
                const selectors = WEIGHTS.flatMap((w) => ["latin", "ja", "ko"].map((s) => `#foundation-${s}-${w}`));
                item.specimen = `${key}-${locale}-${width}-${state}-specimen-${h.browserName}.webp`;
                await shot(page, path.join(h.outDir, item.specimen));
                if (!h.webkit) {
                  item.specimenFonts = await platformFonts(ctx, page, selectors);
                  h.check(`${name} actual custom glyphs and weights`, realWeights(item.specimenFonts), JSON.stringify(item.specimenFonts));
                } else {
                  const faces = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => ({ family: f.family.replaceAll('"', ""), weight: f.weight })));
                  h.check(`${name} loaded specimen weights`, ["DM Sans", "Noto Sans KR", "Noto Sans JP"].every((family) => WEIGHTS.every((w) => faces.some((f) => f.family === family && f.weight === String(w)))), JSON.stringify(faces));
                  h.skip(`${name} CDP glyph proof`, "WebKit has no CDP CSS platform fonts API; resource hashes + screenshots retained, actual iOS owner validation separate");
                }
                await page.locator("#foundation-font-specimen").evaluate((el) => el.remove());
              }
              // Generic resource console lines omit their URL in Chromium.
              // The requestfailed listener above admits only the exact font
              // fault/telemetry resources; page exceptions are never filtered.
              const runtime = errors.filter((e) => !/^Failed to load resource: (net::ERR_FAILED|Load failed|cancelled|canceled)/i.test(e));
              const failures = [...runtime, ...exceptions, ...unexpectedFailures];
              h.check(`${name} runtime`, failures.length === 0, failures.join("; "));
              await Promise.allSettled(bodies);
              h.check(`${name} response bodies recorded`, responses.every((r) => !r.error), responses.filter((r) => r.error).map((r) => `${r.url}: ${r.error}`).join("; "));
              item.attempts = attempts;
              item.fontResponses = responses;
            } finally {
              release();
              entries.push(item);
              save();
            }
          }, { ms: h.timeoutMs * 4 });
        }
      }
    }
    save();
  },
};
export default scenario;
