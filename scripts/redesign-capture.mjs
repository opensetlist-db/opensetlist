#!/usr/bin/env node
// Redesign before/after capture tool.
//
// Captures full-page screenshots plus per-page metrics for a fixed set of
// pages × locales × viewports, and writes a `captures.json` manifest. The
// redesign ticket 02 baseline (wiki: output/redesign/handoffs/02/captures/
// captures.json, captured at origin/dev 04b07bf4) was taken with this page
// list; later redesign tickets re-capture the SAME key/viewport/locale on
// their branch so the two manifests compare entry by entry.
//
// Usage (from the repo root, against a running server):
//   node scripts/redesign-capture.mjs --base http://localhost:3110 --out <dir>
//     [--browser chromium|webkit]   default chromium
//     [--filter ko-event-,admin-]   comma-separated key prefixes; keys are
//                                    `<locale>-<page>` for public pages and
//                                    `admin-<page>` for admin pages
//     [--png]                        also keep the full-size PNG
//     [--no-webp]                    skip WebP (then --png is implied)
//     [--env <path>]                 dotenv file with ADMIN_PASSWORD
//                                    (default: <repo>/.env)
//     [--list]                       print the keys that would be captured
//
// Serve a production build, not `next dev` — dev-mode TTFB, bundle bytes and
// overlay errors make the metrics meaningless. Build with the Sentry
// variables emptied so nothing uploads:
//   SENTRY_AUTH_TOKEN= SENTRY_DSN= NEXT_PUBLIC_SENTRY_DSN= npm run build
//   npx next start -p 3110
//
// Known local-only noise: `/_vercel/speed-insights/script.js` 404s outside
// Vercel, which shows up as one "Failed to load resource … 404" console
// error on every page (the baseline has it too). `failedResponses` records
// the URL so it can be told apart from a real regression.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import dotenv from "dotenv";
// @playwright/test is the declared dependency and re-exports the browser types.
import { chromium, webkit } from "@playwright/test";
import sharp from "sharp";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { values: args } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:3110" },
    out: { type: "string" },
    browser: { type: "string", default: "chromium" },
    filter: { type: "string" },
    png: { type: "boolean", default: false },
    "no-webp": { type: "boolean", default: false },
    env: { type: "string", default: path.join(repoRoot, ".env") },
    list: { type: "boolean", default: false },
  },
});

const BASE = args.base.replace(/\/+$/, "");
const BROWSERS = { chromium, webkit };
const browserType = BROWSERS[args.browser];
if (!browserType) {
  console.error(`--browser must be one of: ${Object.keys(BROWSERS).join(", ")}`);
  process.exit(1);
}
const WEBP = !args["no-webp"];
const PNG = args.png || !WEBP;

// WebP's hard limit is 16383 px per side; split taller pages into parts so
// the evidence stays WebP (vault-friendly size). Heights are in device
// pixels, so the 2× mobile viewport hits this at ~8000 CSS px.
const WEBP_MAX_PART_HEIGHT = 16000;
const WEBP_QUALITY = 90;

const VIEWPORTS = {
  d1440: { width: 1440, height: 900 },
  m390: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

// ---------------------------------------------------------------------------
// Default page set — the ticket 02 baseline list.
//
// Record states are time-dependent: event 111 was "ongoing" and 107/109
// "upcoming" only on the baseline date (2026-10-20), item counts grow as
// setlists are entered, and series 26's schedule moves on. Before relying on
// a key's name for a comparison, re-check that the record is still in the
// state the key describes; when it is not, compare against the baseline's
// screenshot as "that record then", or pick a new record and note it.
// ---------------------------------------------------------------------------
const MEMBER = "e750790e-215c-410f-b1b2-37825ac43d69";
const ALL = ["ko", "ja", "en"];
const KO = ["ko"];
// [key, path (without locale), locales]
const PUBLIC = [
  ["home", "", ALL],
  ["events-list", "/events", ALL],
  ["events-list-ongoing", "/events?filter=ongoing", KO],
  ["events-list-upcoming", "/events?filter=upcoming", KO],
  ["events-list-completed", "/events?filter=completed", KO],
  ["events-list-pastpage2", "/events?pastPage=2", KO],
  ["event-111-ongoing", "/events/111/rehearsal-lovelive-fes-2020-day1", ALL],
  ["event-2-past-21items", "/events/2/hasunosora-6th-fukuoka-day2", ALL],
  ["event-82-past-40items", "/events/82/niji-5th-live-cdcs-day2", KO],
  ["event-8-completed-0items", "/events/8/hasunosora-6th-saitama-day2", KO],
  ["event-107-upcoming", "/events/107/hasunosora-ishikawa-daikankou-ii-day1", ALL],
  ["event-109-upcoming-fes", "/events/109/lovelive-15th-fes-day1", KO],
  ["artists-list", "/artists", ALL],
  ["artists-list-animegame", "/artists?category=animegame", KO],
  ["artist-1-overview", "/artists/1/hasunosora", ALL],
  ["artist-1-albums", "/artists/1/hasunosora?tab=albums", KO],
  ["artist-1-history", "/artists/1/hasunosora?tab=history", KO],
  ["artist-2-unit", "/artists/2/cerise-bouquet", KO],
  ["albums-list", "/albums", ALL],
  ["albums-list-artist1", "/albums?artist=1", KO],
  ["album-459-tracks", "/albums/459/s-memorial-cd-box-complete-best-box", ALL],
  ["album-459-events", "/albums/459/s-memorial-cd-box-complete-best-box?tab=events", KO],
  ["album-459-bonus", "/albums/459/s-memorial-cd-box-complete-best-box?tab=bonus", KO],
  ["song-765-history", "/songs/765/eternalize-love", ALL],
  ["song-765-variations", "/songs/765/eternalize-love?tab=variations", KO],
  ["song-62-variant", "/songs/62/dream-believers-104", KO],
  ["member-anyoji-overview", `/members/${MEMBER}/anyoji-hime`, ALL],
  ["member-anyoji-songs", `/members/${MEMBER}/anyoji-hime?tab=songs`, KO],
  ["member-anyoji-history", `/members/${MEMBER}/anyoji-hime?tab=history`, KO],
  ["series-8-schedule", "/series/8", ALL],
  ["series-8-songs", "/series/8?tab=songs", KO],
  ["series-26-upcoming", "/series/26", KO],
  ["privacy", "/privacy", ALL],
  ["terms", "/terms", ALL],
  ["notfound-event", "/events/999999", KO],
];
// Admin pages are Korean-only and unprefixed; they need the admin cookie.
const ADMIN = [
  ["admin-series-list", "/admin/event-series"],
  ["admin-series-8-edit", "/admin/event-series/8/edit"],
  ["admin-series-new", "/admin/event-series/new"],
  ["admin-events-list", "/admin/events"],
  ["admin-event-107-edit", "/admin/events/107/edit"],
  ["admin-events-new", "/admin/events/new"],
  ["admin-albums-list", "/admin/albums"],
  ["admin-album-459-edit", "/admin/albums/459/edit"],
];

const targets = [
  ...PUBLIC.flatMap(([key, p, locales]) =>
    locales.map((loc) => ({ key: `${loc}-${key}`, url: `/${loc}${p}`, admin: false })),
  ),
  ...ADMIN.map(([key, p]) => ({ key, url: p, admin: true })),
];
const prefixes = args.filter?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
const selected = prefixes.length
  ? targets.filter((t) => prefixes.some((p) => t.key.startsWith(p)))
  : targets;

if (args.list) {
  for (const t of selected) console.log(t.key.padEnd(36), t.url);
  process.exit(0);
}
if (!args.out) {
  console.error("--out <dir> is required");
  process.exit(1);
}
if (selected.length === 0) {
  console.error(`--filter ${args.filter} matched no keys (see --list)`);
  process.exit(1);
}

// Read ADMIN_PASSWORD only when an admin page is selected. It is posted to
// the login route and never logged or written to the manifest.
let adminPassword = null;
if (selected.some((t) => t.admin)) {
  adminPassword = fs.existsSync(args.env)
    ? dotenv.parse(fs.readFileSync(args.env)).ADMIN_PASSWORD
    : undefined;
  if (!adminPassword) {
    console.error(`ADMIN_PASSWORD not found in ${args.env} (needed for admin-* keys)`);
    process.exit(1);
  }
}

const outDir = path.resolve(args.out);
fs.mkdirSync(outDir, { recursive: true });

// limitInputPixels off: a long 2× mobile page (the baseline's longest is
// ~41000 CSS px → 82000 device px) exceeds sharp's default pixel cap long
// before it is a problem for memory.
const SHARP_INPUT = { limitInputPixels: false };

// `png` in the manifest is null unless --png was passed; comparisons should
// read the `webp` array, which every run fills (unless --no-webp).
async function writeImages(png, stem) {
  const files = { png: null, webp: [] };
  if (PNG) {
    files.png = `${stem}.png`;
    fs.writeFileSync(path.join(outDir, files.png), png);
  }
  if (!WEBP) return files;
  const { width, height } = await sharp(png, SHARP_INPUT).metadata();
  const parts = Math.ceil(height / WEBP_MAX_PART_HEIGHT);
  for (let i = 0; i < parts; i++) {
    const top = i * WEBP_MAX_PART_HEIGHT;
    const file = parts === 1 ? `${stem}.webp` : `${stem}.part${i + 1}.webp`;
    await sharp(png, SHARP_INPUT)
      .extract({ left: 0, top, width, height: Math.min(WEBP_MAX_PART_HEIGHT, height - top) })
      .webp({ quality: WEBP_QUALITY })
      .toFile(path.join(outDir, file));
    files.webp.push(file);
  }
  return files;
}

const browser = await browserType.launch();
const manifest = [];

// One fresh context per capture: no cache, cookies or service-worker state
// carries over, so every TTFB/bytes figure is a cold load and admin cookies
// never leak into public captures.
async function capture({ key, url, admin }, vpKey) {
  const vp = VIEWPORTS[vpKey];
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: !!vp.isMobile,
    hasTouch: !!vp.hasTouch,
    deviceScaleFactor: vp.deviceScaleFactor ?? 1,
    timezoneId: "Asia/Seoul",
  });
  try {
    if (admin) {
      const r = await ctx.request.post(`${BASE}/api/admin/login`, {
        data: { password: adminPassword },
      });
      if (!r.ok()) throw new Error(`admin login ${r.status()}`);
    }
    // WebKit lacks the layout-shift / LCP entry types (observe() on an
    // unsupported type is a silent no-op, not an error); report null there
    // instead of a misleading 0.
    await ctx.addInitScript(() => {
      const types = PerformanceObserver.supportedEntryTypes ?? [];
      window.__cls = types.includes("layout-shift") ? 0 : null;
      window.__lcp = null;
      if (window.__cls !== null)
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
        }).observe({ type: "layout-shift", buffered: true });
      if (types.includes("largest-contentful-paint"))
        new PerformanceObserver((l) => {
          const es = l.getEntries();
          window.__lcp = es[es.length - 1].startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
    });
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
    });
    let bytes = 0;
    let jsBytes = 0;
    let reqs = 0;
    const writes = [];
    const failedResponses = [];
    // Body reads finish asynchronously; collect them so the byte totals are
    // complete before the manifest entry is written.
    const bodyReads = [];
    page.on("request", (rq) => {
      if (rq.method() !== "GET" && rq.method() !== "HEAD")
        writes.push(`${rq.method()} ${rq.url().replace(BASE, "")}`.slice(0, 200));
    });
    page.on("response", (res) => {
      if (!res.url().startsWith(BASE)) return;
      reqs++;
      if (res.status() >= 400)
        failedResponses.push(`${res.status()} ${res.url().replace(BASE, "")}`.slice(0, 200));
      bodyReads.push(
        res
          .body()
          .then((b) => {
            bytes += b.length;
            if (res.request().resourceType() === "script") jsBytes += b.length;
          })
          // Redirects and aborted requests have no body to count.
          .catch(() => {}),
      );
    });
    const capturedAt = new Date().toISOString();
    const resp = await page.goto(BASE + url, { waitUntil: "load", timeout: 60000 });
    // Settle time for hydration, client fetches and late layout shifts.
    await page.waitForTimeout(2500);
    const m = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0];
      return {
        ttfbMs: Math.round(n.responseStart - n.requestStart),
        dclMs: Math.round(n.domContentLoadedEventEnd),
        loadMs: Math.round(n.loadEventEnd),
        htmlBytes: n.decodedBodySize,
        cls: window.__cls === null ? null : Number(window.__cls.toFixed(4)),
        lcpMs: window.__lcp === null ? null : Math.round(window.__lcp),
        title: document.title,
        lang: document.documentElement.lang,
        h1: document.querySelector("h1")?.textContent?.trim().slice(0, 120) ?? null,
        docHeight: document.documentElement.scrollHeight,
        hScroll: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
    const png = await page.screenshot({ fullPage: true });
    await Promise.all(bodyReads);
    const files = await writeImages(png, `${key}__${vpKey}`);
    manifest.push({
      key,
      vp: vpKey,
      browser: args.browser,
      requested: url,
      finalUrl: page.url().replace(BASE, ""),
      status: resp?.status(),
      capturedAt,
      ...m,
      transferBytesDecoded: bytes,
      jsBytesDecoded: jsBytes,
      requests: reqs,
      nonGetRequests: writes,
      failedResponses,
      consoleErrors,
      ...files,
    });
    console.log(vpKey, key, resp?.status(), `${m.ttfbMs}ms`, "cls", m.cls, files.webp.length > 1 ? `${files.webp.length} parts` : "");
  } finally {
    await ctx.close();
  }
}

for (const t of selected) {
  for (const vpKey of Object.keys(VIEWPORTS)) {
    try {
      await capture(t, vpKey);
    } catch (e) {
      manifest.push({ key: t.key, vp: vpKey, browser: args.browser, error: String(e).slice(0, 300) });
      console.log("ERR", vpKey, t.key, String(e.message ?? e).slice(0, 200));
    }
  }
}
// Manifest first: Playwright's WebKit on Windows can hang in
// browser.close() (its network process lingers), and a run that captured
// everything must not lose its manifest to that. The close is bounded and
// process.exit below ends the run either way.
fs.writeFileSync(path.join(outDir, "captures.json"), JSON.stringify(manifest, null, 2));
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 10000))]);
const errors = manifest.filter((e) => e.error).length;
console.log(`done: ${manifest.length} captures, ${errors} errors → ${outDir}`);
process.exit(errors ? 1 : 0);
