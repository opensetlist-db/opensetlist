#!/usr/bin/env node
// Browser QA for one public redesign page across locales × widths.
//
// Generalised from the ticket 15 (home) one-off. redesign-shell-qa.mjs
// covers the shared shell; this covers what a page ticket must verify on
// its own page, with the page-specific parts in a small SCENARIO module
// (scripts/redesign-page-qa/scenarios/*.mjs, contract below).
//
// Generic checks, per locale × width:
//   status     the page answers 200
//   overflow   no page-level horizontal scroll (scrollWidth ≤ clientWidth)
//   lang       <html lang> is the locale
//   h1         exactly one <h1> in <main>
//   targets    no visible a/button/input/select/textarea in <main> smaller
//              than 24×24 CSS px (WCAG 2.2 target size, minimum)
//   errors     no page error, no console error, and no response ≥400 —
//              except the local-only `_vercel/speed-insights` script, which
//              404s on `next start`. Responses are judged by their URL: the
//              console's "Failed to load resource" text carries none, so
//              those console lines are left to the response check. Counted
//              from the first load until the harness reloads the page for
//              a keyboard-scroll check (see scroll).
// Then, from the scenario:
//   checks     page-specific DOM assertions (no focus or keyboard)
//   capture    full-page PNG — taken BEFORE any focus/keyboard step, or the
//              focus ring and the skip link end up in comparison captures
//   focus      each focusRings[] selector shows the expected outline
//   scroll     each scrollRegions[] region scrolls horizontally only below
//              its `scrollBelow` width and is static from there up; its
//              last link is scrolled into view when focused; below the
//              width, ArrowRight on the focused region scrolls it (on a
//              fresh load, then a 1.2 s wait: WebKit ignores arrow keys
//              right after a programmatic scrollLeft reset)
//   contrast   each contrast pair ≥ 4.5:1 at the scenario's widths. An
//              element is found by its CSS-module class SUFFIX `__<name>`,
//              matched exactly: `[class*=badge]` also matches the
//              transparent `.badges` wrapper and measures nothing.
// Once per run (1440 wide, first locale):
//   motion     the scenario's reduced-motion target animates without the
//              preference (positive control — otherwise a missing or static
//              element passes vacuously), then has no running animation
//              with `prefers-reduced-motion: reduce`
//
// A scenario check whose subject is absent on this build prints SKIP (the
// redesigned page may not be on the branch served); SKIP never fails a run.
//
// Usage (repo root, against a production build — scripts/serve-build.sh):
//   node scripts/redesign-page-qa.mjs --scenario home --out <dir>
//     [--base http://localhost:3110]
//     [--path <p>]                    page path without the locale; default
//                                     the scenario's `path`. "events",
//                                     "/events" and "/ko/events" all work
//                                     (Git Bash rewrites a bare "/events"
//                                     into a Windows path — refused)
//     [--browser chromium|webkit]     default chromium
//     [--quick]                       ko × 390/1100/1440 (a full WebKit run
//                                     is slow on Windows)
//     [--locales ja,ko,en]            overrides the --quick/full default
//     [--widths 320,390,1440]         overrides the --quick/full default
//     [--timeout <s>]                 per-action limit, default 30; one
//                                     locale × width cell gets 6×
//     [--run-timeout <min>]           whole-run limit, default 60
//     [--list]                        list the scenarios and exit
//
// Writes <out>/<scenario>-<browser>-<locale>-<width>.png and
// <out>/<scenario>-<browser>-qa.json; prints `PASS|FAIL|SKIP <name> — detail`
// per check and a summary; exits 1 on any FAIL (a timeout is a FAIL).
//
// Scenario module contract (default export; every field but name optional):
//
//   {
//     name: "home",
//     path: "/",                       // default --path
//     // Selector that marks the page-specific markup as present. When it
//     // matches nothing, `checks`, `focusRings`, `scrollRegions` and
//     // `contrast` report one SKIP per cell instead of failing.
//     requires: "#hero-search",
//     checks: async (t) => {},         // t: page, locale, width, browserName,
//                                      //    check(name, ok, detail),
//                                      //    skip(name, detail)
//     focusRings: [{ name, selector, ring: /solid 3px rgb\(255, 255, 255\)/ }],
//                                      // ring is matched against
//                                      // "<style> <width> <color> <offset>"
//     scrollRegions: [{ name, selector, scrollBelow: 700 }],
//     contrast: { widths: [390, 1440], pairs: ["badge", { name, bg }] },
//                                      // bg: suffix of the ancestor that
//                                      // paints the background; default the
//                                      // element itself, else the nearest
//                                      // ancestor with an opaque background
//     reducedMotion: { suffix: "liveDot" | selector: "…", animation: "live-pulse" },
//   }
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
// @playwright/test is the declared dependency and re-exports the browser types.
import { chromium, webkit } from "@playwright/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scenarioDir = path.join(repoRoot, "scripts", "redesign-page-qa", "scenarios");

const { values: args } = parseArgs({
  options: {
    scenario: { type: "string" },
    out: { type: "string" },
    base: { type: "string", default: "http://localhost:3110" },
    path: { type: "string" },
    browser: { type: "string", default: "chromium" },
    quick: { type: "boolean", default: false },
    locales: { type: "string" },
    widths: { type: "string" },
    timeout: { type: "string", default: "30" },
    "run-timeout": { type: "string", default: "60" },
    list: { type: "boolean", default: false },
  },
});

if (args.list) {
  for (const f of fs.readdirSync(scenarioDir).filter((f) => f.endsWith(".mjs"))) console.log(f.replace(/\.mjs$/, ""));
  process.exit(0);
}
const usage = () => {
  console.error(
    "usage: node scripts/redesign-page-qa.mjs --scenario <name|path.mjs> --out <dir> [--base URL] [--path p] [--browser chromium|webkit] [--quick] [--locales ja,ko,en] [--widths 320,1440]",
  );
  process.exit(2);
};
if (!args.scenario || !args.out) usage();

const BROWSERS = { chromium, webkit };
const browserType = BROWSERS[args.browser];
if (!browserType) {
  console.error(`--browser must be one of: ${Object.keys(BROWSERS).join(", ")}`);
  process.exit(2);
}
const CHECK_MS = Number(args.timeout) * 1000;
const RUN_MS = Number(args["run-timeout"]) * 60_000;
// setTimeout fires at once above 2^31 ms (~24.8 days); a day is plenty.
if (!(CHECK_MS > 0) || !(RUN_MS > 0) || CHECK_MS > 86_400_000 || RUN_MS > 86_400_000) {
  console.error("--timeout and --run-timeout must be positive numbers, at most one day");
  process.exit(2);
}
// A cell is a load, the checks, a capture, the focus steps and a reload for
// each keyboard-scroll region — several navigations' worth.
const CELL_MS = CHECK_MS * 6;

const KNOWN_LOCALES = ["ja", "ko", "en"];
const list = (s) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const LOCALES = args.locales ? list(args.locales) : args.quick ? ["ko"] : KNOWN_LOCALES;
const WIDTHS = args.widths
  ? list(args.widths).map(Number)
  : args.quick
    ? [390, 1100, 1440]
    : [320, 375, 390, 430, 768, 1024, 1100, 1440];
if (!LOCALES.length || LOCALES.some((l) => !/^[a-z]{2}(-[A-Z]{2})?$/.test(l))) {
  console.error(`--locales: expected e.g. ja,ko,en — got "${args.locales}"`);
  process.exit(2);
}
if (!WIDTHS.length || WIDTHS.some((w) => !Number.isInteger(w) || w < 200 || w > 4000)) {
  console.error(`--widths: expected integers 200–4000 — got "${args.widths}"`);
  process.exit(2);
}

const scenarioPath = args.scenario.endsWith(".mjs")
  ? path.resolve(args.scenario)
  : path.join(scenarioDir, `${args.scenario}.mjs`);
const scenario = (await import(pathToFileURL(scenarioPath).href)).default;

// "/events", "events/", "/ko/events" and "/" all normalise to "" or
// "/events" (appended to /<locale>). Git Bash rewrites a bare "/events"
// argument into "C:/Program Files/Git/events" before node sees it.
function normalisePath(p) {
  if (/^[A-Za-z]:[\\/]/.test(p)) {
    console.error(`--path ${p}: looks like a path Git Bash rewrote; pass "--path events" or set MSYS_NO_PATHCONV=1`);
    process.exit(2);
  }
  let t = p.trim().replace(/^\/*/, "/").replace(/\/+$/, "");
  const seg = t.split("/")[1];
  if (KNOWN_LOCALES.includes(seg) || LOCALES.includes(seg)) t = t.slice(seg.length + 1);
  return t === "/" ? "" : t;
}
const PAGE_PATH = normalisePath(args.path ?? scenario.path ?? "/");
const BASE = args.base.replace(/\/+$/, "");
const NAME = scenario.name;
const outDir = path.resolve(args.out);
fs.mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------------------
// Results. check()/skip() calls from a cell that already timed out are
// dropped (its body is not cancellable and may settle later), so they do not
// land among the next cell's results.
// ---------------------------------------------------------------------------
const results = [];
const cellScope = new AsyncLocalStorage();
const late = () => cellScope.getStore()?.abandoned === true;
function check(name, ok, detail = "") {
  if (late()) return;
  results.push({ name, ok: !!ok, detail });
  console.log("%s %s%s", ok ? "PASS" : "FAIL", name, detail ? ` — ${detail}` : "");
}
function skip(name, detail) {
  if (late()) return;
  results.push({ name, ok: true, skipped: true, detail });
  console.log("SKIP %s — %s", name, detail);
}

class CheckTimeout extends Error {}
function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new CheckTimeout(`no result after ${ms / 1000}s`)), ms);
    }),
  ]);
}

// One cell throwing (a selector gone, a timeout) is a FAIL for that cell,
// not the end of the run. A timed-out cell is abandoned and its contexts
// closed, which also makes its hung Playwright calls throw and stop.
async function section(name, fn, ms) {
  const scope = { abandoned: false, contexts: new Set() };
  try {
    await withTimeout(cellScope.run(scope, fn), ms);
  } catch (e) {
    const timedOut = e instanceof CheckTimeout;
    check(`${name} (${timedOut ? "timeout" : "threw"})`, false, String(e.message ?? e).split("\n")[0].slice(0, 300));
    if (timedOut) scope.abandoned = true;
  } finally {
    for (const ctx of scope.contexts) await withTimeout(ctx.close(), 5000).catch(() => {});
  }
}

async function newContext(opts) {
  const ctx = await browser.newContext(opts);
  cellScope.getStore()?.contexts.add(ctx);
  ctx.setDefaultTimeout(CHECK_MS);
  ctx.setDefaultNavigationTimeout(CHECK_MS);
  return ctx;
}

// `load`, then <main> and web fonts — never `networkidle`, which never
// settled in one WebKit run (redesign-shell-qa.mjs). The keyboard steps
// also need React to have hydrated <main> (every hydrated host node carries
// a `__reactFiber$…` key), or focus and key presses hit inert server HTML.
async function open(page, url) {
  const resp = await page.goto(url, { waitUntil: "load" });
  if (resp?.ok()) {
    await page.locator("main > *").first().waitFor({ state: "attached" });
    await page.waitForFunction(() => {
      const m = document.querySelector("main");
      return !!m && Object.keys(m).some((k) => k.startsWith("__reactFiber$"));
    });
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return resp;
}

// Results first: Playwright's WebKit on Windows can hang in browser.close()
// (see redesign-capture.mjs), so the close is bounded and process.exit ends
// the run either way. The whole-run guard skips the close: the main flow is
// still running, and closing under it would throw out of a top-level await
// before the summary prints. Playwright kills its browsers on exit.
let finishing = false;
async function finish({ closeBrowser = true } = {}) {
  if (finishing) return;
  finishing = true;
  const file = path.join(outDir, `${NAME}-${args.browser}-qa.json`);
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
  if (closeBrowser) await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 10000))]);
  const fails = results.filter((r) => !r.ok);
  const skipped = results.filter((r) => r.skipped).length;
  console.log("");
  console.log(
    "%s: %d passed, %d skipped, %d failed (%s, %s%s, %s × %s) → %s",
    fails.length ? "FAIL" : "ALL PASS",
    results.length - fails.length - skipped,
    skipped,
    fails.length,
    NAME,
    args.browser,
    args.quick ? " quick" : "",
    LOCALES.join(","),
    WIDTHS.join(","),
    file,
  );
  for (const f of fails) console.log("FAIL %s — %s", f.name, f.detail);
  process.exit(fails.length ? 1 : 0);
}

// ---------------------------------------------------------------------------
// In-page helpers (serialised into page.evaluate, so self-contained).
// ---------------------------------------------------------------------------

// Generic per-cell measurements.
function measure() {
  const de = document.documentElement;
  const main = document.querySelector("main");
  const label = (el) => {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "";
    const text = (el.textContent || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 25);
    return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}${text ? ` "${text}"` : ""}`;
  };
  const small = main
    ? [...main.querySelectorAll("a, button, input, select, textarea")].filter((el) => {
        if (el.type === "hidden") return false;
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        // sr-only controls (1px, clipped) are not pointer targets.
        if (s.visibility === "hidden" || r.width <= 1 || r.height <= 1) return false;
        return r.width < 24 || r.height < 24;
      })
    : [];
  return {
    hasMain: !!main,
    overflow: de.scrollWidth - de.clientWidth,
    lang: de.lang,
    h1: main ? main.querySelectorAll("h1").length : 0,
    small: small.length,
    smallList: small
      .slice(0, 3)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return `${label(el)} ${Math.round(r.width)}×${Math.round(r.height)}`;
      })
      .join(", "),
  };
}

// Contrast pairs: [{ name, bg? }] → [{ name, fg, bg, bgFrom } | { name, missing }].
// Colours come back as the computed strings; parsed in Node.
function readContrast(pairs) {
  const bySuffix = (name, root = document.querySelector("main") ?? document.body) =>
    [...root.querySelectorAll("*")].find((e) => [...e.classList].some((c) => c.endsWith("__" + name)));
  const closestBySuffix = (el, name) => {
    for (let a = el; a; a = a.parentElement) if ([...a.classList].some((c) => c.endsWith("__" + name))) return a;
    return null;
  };
  const transparent = (c) => c === "transparent" || /^rgba\(.*,\s*0\)$/.test(c);
  return pairs.map(({ name, bg }) => {
    const el = bySuffix(name);
    if (!el) return { name, missing: true };
    let bgEl = bg ? closestBySuffix(el, bg) : el;
    if (!bgEl) return { name, missing: true, detail: `no __${bg} ancestor` };
    // The element (or the named ancestor) may not paint its own background;
    // the nearest ancestor that does is what the text sits on.
    while (bgEl.parentElement && transparent(getComputedStyle(bgEl).backgroundColor)) bgEl = bgEl.parentElement;
    const cls = [...bgEl.classList].find((c) => c.includes("__")) ?? bgEl.tagName.toLowerCase();
    return {
      name,
      fg: getComputedStyle(el).color,
      bg: getComputedStyle(bgEl).backgroundColor,
      bgFrom: bgEl === el ? "self" : cls,
    };
  });
}

function parseRgb(s) {
  const m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s ?? "");
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return { rgb: [m[1], m[2], m[3]].map(Number), a };
}
function lum(rgb) {
  const [r, g, b] = rgb.map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

const focusRingOf = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    const s = getComputedStyle(a);
    return {
      ring: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor} ${s.outlineOffset}`,
      el: `${a.tagName.toLowerCase()}${a.id ? "#" + a.id : ""}`,
    };
  });

// ---------------------------------------------------------------------------
// One locale × width cell.
// ---------------------------------------------------------------------------
async function runCell(locale, width) {
  const tag = `${args.browser} ${locale} ${width}`;
  const url = `${BASE}/${locale}${PAGE_PATH}`;
  const ctx = await newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  let errorsOpen = true;
  page.on("pageerror", (e) => errorsOpen && errors.push(String(e).split("\n")[0]));
  page.on("response", (r) => {
    if (errorsOpen && r.status() >= 400 && !/\/_vercel\/speed-insights\//.test(r.url()))
      errors.push(`${r.status()} ${r.url()}`);
  });
  page.on("console", (m) => {
    if (errorsOpen && m.type() === "error" && !/^Failed to load resource/.test(m.text()))
      errors.push(m.text().split("\n")[0]);
  });

  const resp = await open(page, url);
  check(`${tag} status`, resp?.status() === 200, `HTTP ${resp?.status()} ${url}`);
  const m = await page.evaluate(measure);
  if (!m.hasMain) {
    check(`${tag} <main>`, false, "no <main> on the page");
    return;
  }
  check(`${tag} no page overflow`, m.overflow <= 0, `${m.overflow}px`);
  check(`${tag} lang`, m.lang === locale, m.lang);
  check(`${tag} one h1`, m.h1 === 1, String(m.h1));
  check(`${tag} no tiny targets`, m.small === 0, m.small ? `${m.small}: ${m.smallList}` : "0");

  const present = !scenario.requires || (await page.locator(scenario.requires).count()) > 0;
  const absent = `"${scenario.requires}" not on this build`;
  const t = { page, locale, width, browserName: args.browser, check, skip, tag };
  if (scenario.checks) {
    if (present) await scenario.checks(t);
    else skip(`${tag} ${NAME} page checks`, absent);
  }

  // Capture before any focus or keyboard step (see the header).
  await page.screenshot({ path: path.join(outDir, `${NAME}-${args.browser}-${locale}-${width}.png`), fullPage: true });

  for (const f of scenario.focusRings ?? []) {
    const name = `${tag} focus ring ${f.name}`;
    const target = page.locator(f.selector).first();
    if (!present || !(await target.count())) {
      skip(name, present ? `"${f.selector}" absent` : absent);
      continue;
    }
    // A key press first, so :focus-visible matches a programmatic focus as
    // it would for a keyboard user (links included).
    await page.keyboard.press("Shift");
    await target.focus();
    const { ring, el } = await focusRingOf(page);
    check(name, f.ring.test(ring), `${el}: ${ring}`);
  }

  for (const r of scenario.scrollRegions ?? []) {
    const name = `${tag} ${r.name}`;
    const region = page.locator(r.selector).first();
    if (!present || !(await region.count())) {
      skip(`${name} scroll`, present ? `"${r.selector}" absent` : absent);
      continue;
    }
    const s = await region.evaluate((el) => ({
      scrollable: el.scrollWidth > el.clientWidth + 1,
      overflowX: getComputedStyle(el).overflowX,
      links: el.querySelectorAll("a").length,
    }));
    const narrow = width < r.scrollBelow;
    if (narrow) {
      check(`${name} scrolls below ${r.scrollBelow}px`, s.links < 2 || s.scrollable, `${s.links} links, scrollable ${s.scrollable}`);
    } else {
      check(
        `${name} static from ${r.scrollBelow}px`,
        !s.scrollable && !/auto|scroll/.test(s.overflowX),
        `scrollable ${s.scrollable}, overflow-x ${s.overflowX}`,
      );
    }
    if (s.links < 2) continue;
    await page.keyboard.press("Shift");
    const last = region.locator("a").last();
    await last.focus();
    // WebKit scrolls the region to the focused link a moment after focus(),
    // so poll briefly instead of reading once.
    const inView = await page
      .waitForFunction(
        (sel) => {
          const el = document.activeElement;
          const box = el?.closest(sel);
          if (!box) return false;
          const a = el.getBoundingClientRect();
          const b = box.getBoundingClientRect();
          return a.left >= b.left - 1 && a.right <= b.right + 1;
        },
        r.selector,
        { timeout: 2000 },
      )
      .then(() => true, () => false);
    check(`${name} last link scrolled into view on focus`, inView);
    if (narrow) {
      // Fresh load so the region starts at 0 without a programmatic reset.
      // Errors stop counting here: the reload cancels in-flight RSC
      // prefetches, which WebKit logs as "Fetch API cannot load … due to
      // access control checks" — the harness's doing, not the page's, and
      // the page itself was already observed through its first load.
      errorsOpen = false;
      await open(page, url);
      await region.focus();
      const before = await region.evaluate((el) => el.scrollLeft);
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(1200);
      const after = await region.evaluate((el) => el.scrollLeft);
      check(`${name} ArrowRight scrolls`, after > before, `${before}→${after}`);
    }
  }

  const c = scenario.contrast;
  if (c && (!c.widths || c.widths.includes(width)) && !present) {
    skip(`${tag} contrast`, absent);
  } else if (c && (!c.widths || c.widths.includes(width))) {
    const pairs = c.pairs.map((p) => (typeof p === "string" ? { name: p } : p));
    for (const p of await page.evaluate(readContrast, pairs)) {
      const name = `${tag} contrast ${p.name}`;
      if (p.missing) {
        skip(name, p.detail ?? `no .*__${p.name} element`);
        continue;
      }
      const fg = parseRgb(p.fg);
      const bg = parseRgb(p.bg);
      if (!fg || !bg || fg.a < 1 || bg.a < 1) {
        // A translucent colour's contrast depends on what is behind it,
        // which this check does not composite — judge it by eye.
        check(name, false, `cannot measure: fg ${p.fg} on bg ${p.bg} (${p.bgFrom})`);
        continue;
      }
      const v = ratio(fg.rgb, bg.rgb);
      check(name, v >= 4.5, `${v.toFixed(2)} (${p.fg} on ${p.bg}, bg ${p.bgFrom})`);
    }
  }

  check(`${tag} no errors`, errors.length === 0, errors.length ? `${errors.length}: ${errors.slice(0, 2).join(" | ")}` : "");
}

// Reduced motion: the target animates without the preference (positive
// control), then not with it.
async function runMotion() {
  const rm = scenario.reducedMotion;
  const locale = LOCALES[0];
  const where = rm.suffix ? `.*__${rm.suffix}` : rm.selector;
  const read = async (reducedMotion) => {
    const ctx = await newContext({ viewport: { width: 1440, height: 900 }, reducedMotion });
    const page = await ctx.newPage();
    await open(page, `${BASE}/${locale}${PAGE_PATH}`);
    return page.evaluate(({ suffix, selector }) => {
      const el = suffix
        ? [...document.querySelectorAll("*")].find((e) => [...e.classList].some((c) => c.endsWith("__" + suffix)))
        : document.querySelector(selector);
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        name: s.animationName,
        running: el.getAnimations().filter((a) => a.playState === "running").length,
      };
    }, rm);
  };
  const normal = await read("no-preference");
  if (!normal) {
    skip(`${args.browser} reduced motion`, `no ${where} on ${locale}${PAGE_PATH || "/"} (data or build)`);
    return;
  }
  check(
    `${args.browser} ${where} animates (positive control)`,
    normal.running > 0 && (!rm.animation || normal.name === rm.animation),
    JSON.stringify(normal),
  );
  const reduced = await read("reduce");
  check(
    `${args.browser} reduced motion stops ${where}`,
    !!reduced && reduced.running === 0,
    JSON.stringify(reduced),
  );
}

const browser = await browserType.launch();
setTimeout(() => {
  check("run (timeout)", false, `whole run exceeded ${args["run-timeout"]} min; results so far kept`);
  finish({ closeBrowser: false });
}, RUN_MS);

console.log(`${NAME}: ${BASE}/<locale>${PAGE_PATH || "/"} — ${args.browser}, ${LOCALES.join(",")} × ${WIDTHS.join(",")}`);
for (const locale of LOCALES) {
  for (const width of WIDTHS) {
    await section(`${args.browser} ${locale} ${width}`, () => runCell(locale, width), CELL_MS);
  }
}
if (scenario.reducedMotion) await section(`${args.browser} reduced motion`, runMotion, CHECK_MS * 4);

await finish();
