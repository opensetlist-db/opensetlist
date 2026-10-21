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
//                                    (default: <repo>/.env); it must match
//                                    the server's ADMIN_PASSWORD
//     [--list]                       print the keys that would be captured
//     [--compare <captures.json>]    after writing this run's manifest,
//                                    compare it entry by entry (key + vp)
//                                    with a baseline manifest and print a
//                                    regression summary. The ticket 02
//                                    baseline lives in the wiki vault, not
//                                    the repo, so pass its path. A report
//                                    only: it never changes the exit code.
//     [--repeat N]                   default 1. Load every key × viewport N
//                                    times and keep the TTFB of each load.
//                                    The manifest's `ttfbMs` is then the
//                                    median of the N samples and
//                                    `ttfbSamplesMs` holds them all (in
//                                    load order); every other field —
//                                    screenshot, bytes, CLS, console — comes
//                                    from the first load only, so WebP output
//                                    and runtime do not multiply. Use 3+
//                                    when a TTFB ratio has to be told apart
//                                    from DB/pooler noise: on identical code
//                                    a single-load median ratio swung
//                                    0.96×–1.26× between runs.
//     [--page-timeout S]             default 30 (seconds). Navigation and
//                                    every Playwright wait time out after S;
//                                    one whole load (login, navigation,
//                                    settle, screenshot, WebP) is cut at
//                                    2×S. A timed-out load is recorded as an
//                                    error starting with "timeout:" and the
//                                    run moves on to the next entry.
//     [--run-timeout M]              default 90 (minutes). Whole-run guard:
//                                    once M minutes have passed, entries not
//                                    yet loaded are recorded as "timeout:"
//                                    errors, the manifest is written with
//                                    what was captured, and the run exits 1.
//                                    A full run (all keys, --repeat 1) takes
//                                    about 15 minutes; raise M for a full run
//                                    with a large --repeat.
//
// Navigations wait for `load`, never `networkidle`: a page that keeps a
// connection open (polling, a stalled analytics request) never goes idle,
// and a networkidle wait on WebKit hung a QA run for ~30 minutes. The
// settle time after `load` is an explicit fixed wait instead.
//
// With --repeat, loads run in rounds — every entry once (with screenshots),
// then every entry again for TTFB only, and so on — rather than N loads of
// one entry back to back. DB/pooler latency drifts over minutes, so spacing
// an entry's samples across the run keeps one slow stretch from skewing
// a single entry's median.
//
// Serve a production build, not `next dev` — dev-mode TTFB, bundle bytes and
// overlay errors make the metrics meaningless. Build with the Sentry
// variables emptied so nothing uploads:
//   SENTRY_AUTH_TOKEN= SENTRY_DSN= NEXT_PUBLIC_SENTRY_DSN= npm run build
//   npx next start -p 3110
//
// Admin keys log in once per capture context. A production build marks the
// admin cookie Secure, which WebKit drops on http://localhost (Chromium
// keeps it), so over plain http the script re-adds the cookie without the
// Secure flag. A wrong ADMIN_PASSWORD fails at the login call (401). An
// admin capture that logged in but still ends on /admin-login — a dropped
// cookie, a session the server rejects — is recorded as an error and fails
// the run (exit 1) on either browser, rather than passing with the login
// form as evidence.
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
    compare: { type: "string" },
    repeat: { type: "string", default: "1" },
    "page-timeout": { type: "string", default: "30" },
    "run-timeout": { type: "string", default: "90" },
  },
});

// Positive-number options; a typo fails here rather than as NaN timeouts.
function positive(name, { integer = false } = {}) {
  const n = Number(args[name]);
  if (!Number.isFinite(n) || n <= 0 || (integer && !Number.isInteger(n))) {
    console.error(`--${name} must be a positive ${integer ? "integer" : "number"} (got ${args[name]})`);
    process.exit(1);
  }
  return n;
}
const REPEAT = positive("repeat", { integer: true });
const PAGE_TIMEOUT_MS = positive("page-timeout") * 1000;
// One load's hard cap: navigation alone may use PAGE_TIMEOUT_MS, and the
// settle wait, screenshot and WebP encoding of a long page come on top.
const LOAD_BUDGET_MS = PAGE_TIMEOUT_MS * 2;
const RUN_TIMEOUT_MS = positive("run-timeout") * 60000;

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
  // Constant format strings throughout: Semgrep's unsafe-formatstring rule
  // (a blocking CI check) rejects a non-literal first console.log argument.
  for (const t of selected) console.log("%s %s", t.key.padEnd(36), t.url);
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
// Load the baseline up front so a bad path fails before a long capture run,
// not after it.
let baseline = null;
if (args.compare) {
  try {
    baseline = JSON.parse(fs.readFileSync(args.compare, "utf8"));
    if (!Array.isArray(baseline)) throw new Error("not a captures.json array");
  } catch (e) {
    console.error(`--compare ${args.compare}: ${e.message}`);
    process.exit(1);
  }
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

const runStarted = Date.now();
const browser = await browserType.launch();

// Rejects with a "timeout:" error once `ms` has passed. The loser of the
// race is abandoned, not cancelled: the caller closes the browser context,
// which makes the abandoned load's next Playwright call throw.
function withTimeout(promise, ms, what) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout: ${what} exceeded ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

// Playwright's own wait/navigation timeouts throw a TimeoutError whose
// message starts "page.goto: Timeout 30000ms exceeded"; prefix it so every
// timed-out entry reads "timeout: …" in the manifest whichever limit hit.
// Only the first line is kept: Playwright appends a multi-line call log with
// ANSI colour codes.
function errorText(e) {
  const s = String(e?.message ?? e).split("\n")[0];
  return (e?.name === "TimeoutError" && !s.startsWith("timeout:") ? `timeout: ${s}` : s).slice(0, 300);
}

// One fresh context per load: no cache, cookies or service-worker state
// carries over, so every TTFB/bytes figure is a cold load and admin cookies
// never leak into public captures.
//
// `full` is the first round: metrics, screenshot and WebP. Later --repeat
// rounds (`full` false) only navigate and read TTFB, skipping the settle
// wait, body accounting and screenshot. Returns the manifest entry (or, for
// a TTFB-only round, just `{ ttfbMs, status }`); the caller owns the manifest so an
// abandoned, timed-out load can never push into it late.
async function loadOnce(ctx, { key, url, admin }, vpKey, round) {
  const full = round === 1;
  ctx.setDefaultTimeout(PAGE_TIMEOUT_MS);
  ctx.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
  if (admin) {
    const r = await ctx.request.post(`${BASE}/api/admin/login`, {
      data: { password: adminPassword },
    });
    if (!r.ok()) throw new Error(`admin login ${r.status()}`);
    // A production build (`next start`) sets the admin cookie Secure
    // (NODE_ENV === "production" in the login route). Chromium keeps a
    // Secure cookie on http://localhost, WebKit discards it, so without
    // this every WebKit admin capture is the login page. Over plain http,
    // re-add each cookie from its name=value pair alone: addCookies with a
    // `url` and no `secure` stores it non-Secure for this origin (also
    // without httpOnly and maxAge, which a one-page capture context never
    // needs). Only the pair is parsed; the value is never logged or
    // written anywhere.
    if (new URL(BASE).protocol === "http:") {
      const cookies = r
        .headersArray()
        .filter((h) => h.name.toLowerCase() === "set-cookie")
        .map((h) => {
          const nv = h.value.split(";")[0];
          const i = nv.indexOf("=");
          return { name: nv.slice(0, i).trim(), value: nv.slice(i + 1) };
        })
        .filter((c) => c.name)
        .map((c) => ({ ...c, url: BASE, sameSite: "Lax" }));
      if (cookies.length === 0) throw new Error("admin login answered OK without a cookie");
      await ctx.addCookies(cookies);
    }
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
  let bytes = 0;
  let jsBytes = 0;
  let reqs = 0;
  const writes = [];
  const failedResponses = [];
  // Body reads finish asynchronously; collect them so the byte totals are
  // complete before the manifest entry is written.
  const bodyReads = [];
  if (full) {
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
    });
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
  }
  const capturedAt = new Date().toISOString();
  const resp = await page.goto(BASE + url, { waitUntil: "load" });
  if (full) {
    // Settle time for hydration, client fetches and late layout shifts:
    // a fixed wait, not networkidle (see the header).
    await page.waitForTimeout(2500);
  }
  // An admin page without a valid session redirects to /admin-login and
  // answers 200, so the capture would otherwise "succeed" with the login
  // form as its evidence. Fail it instead: no screenshot is written, the
  // manifest entry carries the error, and the run exits non-zero. Both the
  // final URL (read after the settle wait, so a client-side redirect
  // counts too) and the server redirect chain are checked.
  if (admin) {
    const onLogin = (u) => new URL(u).pathname.replace(/\/+$/, "") === "/admin-login";
    const hops = [];
    for (let rq = resp?.request(); rq; rq = rq.redirectedFrom()) hops.push(rq.url());
    if (onLogin(page.url()) || hops.some(onLogin))
      throw new Error(
        `${key} landed on /admin-login: the admin session did not stick (cookie dropped, or rejected by this server)`,
      );
  }
  if (!full) {
    const ttfbMs = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0];
      return Math.round(n.responseStart - n.requestStart);
    });
    console.log("r%s %s %s %s %sms", round, vpKey, key, resp?.status(), ttfbMs);
    return { ttfbMs, status: resp?.status() };
  }
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
  const parts = files.webp.length > 1 ? `${files.webp.length} parts` : "";
  console.log("%s %s %s %sms cls %s %s", vpKey, key, resp?.status(), m.ttfbMs, m.cls, parts);
  return {
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
  };
}

// A fresh context per load, raced against LOAD_BUDGET_MS. The context is
// closed whichever side wins (bounded: a wedged browser must not stall the
// run here either).
async function load(t, vpKey, round) {
  const vp = VIEWPORTS[vpKey];
  const ctx = await withTimeout(
    browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: !!vp.isMobile,
      hasTouch: !!vp.hasTouch,
      deviceScaleFactor: vp.deviceScaleFactor ?? 1,
      timezoneId: "Asia/Seoul",
    }),
    PAGE_TIMEOUT_MS,
    "browser.newContext",
  );
  try {
    return await withTimeout(loadOnce(ctx, t, vpKey, round), LOAD_BUDGET_MS, `${t.key} ${vpKey} load`);
  } finally {
    await Promise.race([ctx.close().catch(() => {}), new Promise((r) => setTimeout(r, 10000))]);
  }
}

const median = (xs) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// One slot per key × viewport, in capture order. `entry` is round 1's
// manifest entry (or its error); later rounds add TTFB samples to it.
const slots = selected.flatMap((t) =>
  Object.keys(VIEWPORTS).map((vpKey) => ({ t, vpKey, entry: null, samples: [], repeatErrors: [] })),
);

// Builds the manifest from whatever has been captured so far, so the run
// guard can write a partial one. Entries not yet loaded become "timeout:"
// errors; an entry whose later rounds were cut short keeps the samples it
// has and lists the missing rounds in `repeatErrors`.
function buildManifest(cutShort) {
  const runLimit = `timeout: run limit (--run-timeout ${args["run-timeout"]} min) reached`;
  return slots.map((s) => {
    if (!s.entry) return { key: s.t.key, vp: s.vpKey, browser: args.browser, error: `${runLimit} before this entry` };
    if (s.entry.error) return s.entry;
    const repeatErrors = [...s.repeatErrors];
    const missingRounds = REPEAT - s.samples.length - s.repeatErrors.length;
    if (cutShort && missingRounds > 0) repeatErrors.push(`${runLimit}: ${missingRounds} round(s) not loaded`);
    return {
      ...s.entry,
      // The median of the samples replaces round 1's single TTFB, so older
      // tooling that reads `ttfbMs` keeps working on --repeat manifests.
      ttfbMs: s.samples.length ? Math.round(median(s.samples)) : null,
      ttfbSamplesMs: s.samples,
      ...(repeatErrors.length ? { repeatErrors } : {}),
    };
  });
}

let finished = false;
async function finish(cutShort) {
  if (finished) return;
  finished = true;
  const manifest = buildManifest(cutShort);
  // Manifest first: Playwright's WebKit on Windows can hang in
  // browser.close() (its network process lingers), and a run that captured
  // everything must not lose its manifest to that. The close is bounded and
  // process.exit below ends the run either way.
  fs.writeFileSync(path.join(outDir, "captures.json"), JSON.stringify(manifest, null, 2));
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 10000))]);
  const errors = manifest.filter((e) => e.error).length;
  if (cutShort) console.log(`RUN TIMEOUT: --run-timeout ${args["run-timeout"]} min reached; manifest is partial`);
  console.log(`done: ${manifest.length} captures, ${errors} errors → ${outDir}`);
  if (baseline) compareWithBaseline(baseline, manifest);
  process.exit(errors || cutShort ? 1 : 0);
}

// Whole-run guard. The loop below checks the deadline between loads; this
// timer is the backstop for a hang no per-load race covers (it fires even
// while the loop is stuck in an await).
setTimeout(() => {
  console.log("ERR run timeout while a load was in flight");
  finish(true);
}, RUN_TIMEOUT_MS).unref();

// A NaN timing (an odd navigation entry) is not a sample; with none left the
// entry's ttfbMs is null, which --compare already skips.
function addSample(s, ms) {
  if (Number.isFinite(ms)) s.samples.push(ms);
}

let cutShort = false;
run: for (let round = 1; round <= REPEAT; round++) {
  for (const s of slots) {
    if (Date.now() - runStarted > RUN_TIMEOUT_MS) {
      cutShort = true;
      break run;
    }
    // An entry whose first load failed has no page to sample again.
    if (round > 1 && s.entry.error) continue;
    try {
      const r = await load(s.t, s.vpKey, round);
      if (round === 1) {
        s.entry = r;
        addSample(s, r.ttfbMs);
      } else if (r.status !== s.entry.status) {
        // A 500 or a redirect in a later round is not a TTFB sample of the
        // page round 1 captured.
        s.repeatErrors.push(`round ${round}: status ${r.status} (round 1: ${s.entry.status})`);
      } else {
        addSample(s, r.ttfbMs);
      }
    } catch (e) {
      const err = errorText(e);
      if (round === 1) s.entry = { key: s.t.key, vp: s.vpKey, browser: args.browser, error: err };
      else s.repeatErrors.push(`round ${round}: ${err}`);
      console.log("ERR r%s %s %s %s", round, s.vpKey, s.t.key, err.slice(0, 200));
    }
  }
}
await finish(cutShort);

// ---------------------------------------------------------------------------
// --compare: entry-by-entry diff against a baseline manifest.
//
// Pairs are matched on key + vp only. The baseline (ticket 02) predates the
// `browser` field, and comparing a WebKit run against a Chromium baseline is
// the caller's choice, so browser is not part of the match.
//
// Only baseline entries this run was asked to capture count as "missing":
// with --filter, the rest of the baseline is out of scope, not lost.
// ---------------------------------------------------------------------------
function compareWithBaseline(before, after) {
  const CLS_THRESHOLD = 0.05;
  const id = (e) => `${e.key}__${e.vp}`;
  const selectedKeys = new Set(selected.map((t) => t.key));
  const viewportKeys = new Set(Object.keys(VIEWPORTS));
  const afterById = new Map(after.map((e) => [id(e), e]));

  const pairs = [];
  const missing = [];
  const errored = [];
  for (const b of before) {
    if (b.error || !selectedKeys.has(b.key) || !viewportKeys.has(b.vp)) continue;
    const a = afterById.get(id(b));
    if (!a) missing.push(id(b));
    else if (a.error) errored.push(`${id(b)}: ${a.error}`);
    else pairs.push([b, a]);
  }

  // Each regression is one line, grouped under its check so a long list
  // still reads at a glance.
  const regressions = {
    "horizontal scroll appeared": [],
    [`CLS up by more than ${CLS_THRESHOLD}`]: [],
    "more console errors": [],
    "lang changed": [],
    "HTTP status changed": [],
  };
  const ttfbRatios = [];
  // Per entry, slowest ÷ fastest of this run's own --repeat samples: how
  // much identical code on the same server varied within this one run.
  const ttfbSelfSpread = [];
  const jsDeltas = [];
  for (const [b, a] of pairs) {
    const k = id(b);
    if (a.hScroll && !b.hScroll) regressions["horizontal scroll appeared"].push(k);
    // CLS is null on WebKit (no layout-shift entries); skip rather than
    // treat null as 0.
    if (typeof a.cls === "number" && typeof b.cls === "number" && a.cls - b.cls > CLS_THRESHOLD)
      regressions[`CLS up by more than ${CLS_THRESHOLD}`].push(`${k}  ${b.cls} → ${a.cls}`);
    const ce = (e) => e.consoleErrors?.length ?? 0;
    if (ce(a) > ce(b))
      regressions["more console errors"].push(
        `${k}  ${ce(b)} → ${ce(a)}  (new: ${a.consoleErrors.slice(ce(b)).join(" | ").slice(0, 160)})`,
      );
    if (a.lang !== b.lang) regressions["lang changed"].push(`${k}  ${b.lang} → ${a.lang}`);
    if (a.status !== b.status) regressions["HTTP status changed"].push(`${k}  ${b.status} → ${a.status}`);
    // typeof, not >= 0: a NaN timing serialises to null, and null >= 0.
    if (typeof b.ttfbMs === "number" && typeof a.ttfbMs === "number" && b.ttfbMs > 0)
      ttfbRatios.push(a.ttfbMs / b.ttfbMs);
    const samples = a.ttfbSamplesMs?.filter((x) => x > 0) ?? [];
    if (samples.length > 1) ttfbSelfSpread.push(Math.max(...samples) / Math.min(...samples));
    if (typeof a.jsBytesDecoded === "number" && typeof b.jsBytesDecoded === "number")
      jsDeltas.push(a.jsBytesDecoded - b.jsBytesDecoded);
  }

  const total = Object.values(regressions).reduce((n, xs) => n + xs.length, 0);
  console.log("");
  console.log("=== compare vs %s ===", args.compare);
  console.log("matched: %d   missing from this run: %d   errored in this run: %d", pairs.length, missing.length, errored.length);
  const ttfb = median(ttfbRatios);
  const js = median(jsDeltas);
  // The median alone hides how far the entries scatter around it: an
  // all-entries 1.26× with an IQR of 1.20–1.30× is a shift, one with an IQR
  // of 0.85–1.60× is noise. Quartiles interpolate linearly.
  const quantile = (xs, q) => {
    const s = [...xs].sort((x, y) => x - y);
    const pos = (s.length - 1) * q;
    const lo = Math.floor(pos);
    return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo);
  };
  const x = (r) => `${r.toFixed(2)}×`;
  console.log(
    "median TTFB ratio (after/before): %s",
    ttfb === null
      ? "n/a"
      : `${x(ttfb)}   per-entry spread: IQR ${x(quantile(ttfbRatios, 0.25))}–${x(quantile(ttfbRatios, 0.75))}, ` +
          `min–max ${x(Math.min(...ttfbRatios))}–${x(Math.max(...ttfbRatios))}, n=${ttfbRatios.length}`,
  );
  // Only --repeat runs have samples. Ratios well inside this band are what
  // rerunning the same code would also produce.
  if (ttfbSelfSpread.length)
    console.log(
      "this run's TTFB repeat spread (slowest/fastest load per entry): median %s, max %s, n=%d",
      x(median(ttfbSelfSpread)),
      x(Math.max(...ttfbSelfSpread)),
      ttfbSelfSpread.length,
    );
  console.log(
    "median JS bytes delta (decoded): %s",
    js === null ? "n/a" : `${js >= 0 ? "+" : ""}${Math.round(js).toLocaleString("en-US")} B`,
  );
  console.log("");
  if (total === 0) {
    console.log("REGRESSIONS: none");
  } else {
    console.log("!!!!!!!! REGRESSIONS: %d !!!!!!!!", total);
    for (const [check, lines] of Object.entries(regressions)) {
      if (lines.length === 0) continue;
      console.log("  [%s] %d", check, lines.length);
      for (const l of lines) console.log("    %s", l);
    }
  }
  if (missing.length) {
    console.log("");
    console.log("MISSING (in baseline, not captured): %d", missing.length);
    for (const m of missing) console.log("    %s", m);
  }
  if (errored.length) {
    console.log("");
    console.log("ERRORED (capture failed in this run): %d", errored.length);
    for (const m of errored) console.log("    %s", m);
  }
}
