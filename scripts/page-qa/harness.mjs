// Browser QA harness for public (locale-routed) pages.
//
// A page ticket writes a SCENARIO module (scripts/page-qa/scenarios/*.mjs,
// contract below); this file owns what every public-page QA script used to
// rewrite: browser/context setup, console and page-error collection, the
// locale × width layout matrix, reduced motion with a positive control,
// status/redirect checks through the request API, timeouts, the progress
// log and the results JSON. scripts/page-qa.mjs is the CLI around it.
//
// Scenario module contract (default export):
//
//   {
//     name: "artist-detail",            // file stem of the log / JSON
//     run: async (h) => {},             // the page's checks (see `h` below)
//     fixture: {                        // optional; only with --fixture
//       needs: ["artistId", "slug"],    // keys the fixture JSON must have
//       about: "…",                     // what the rows are, for --list
//       run: async (h, fx) => {},       // checks that read the fixture rows
//     },
//   }
//
// The harness never writes to a database. A fixture is metadata only: the
// page ticket creates its rows itself (after claiming the dev DB slot on
// the redesign execution board), passes their ids as --fixture <json>, and
// deletes them afterwards. --only-fixture skips `run` and runs just
// `fixture.run`.
//
// The `h` object `run` and `fixture.run` receive:
//   check(name, ok, detail)    record PASS/FAIL (printed and logged at once)
//   section(name, fn, {ms})    run fn as one unit: a throw or a timeout is a
//                              FAIL "<name> (threw|timeout)" and the run moves
//                              on; contexts opened inside are closed after
//   open(path, opts)           new context + page, goto base+path; returns
//                              { ctx, page, resp, errors } (opts below)
//   layoutMatrix(opts)         locales × widths; the generic checks per cell
//                              plus the scenario's own `cell` callback
//   reducedMotion(opts)        transitions/animations off under reduce, and
//                              present without it (positive control)
//   expectStatus(name, path, { status, location })   request API, no redirect
//                              following; `location` a RegExp on the header
//   getText(path)              response body through the request API
//   pressOn(page, selector, key)  focus + key, WebKit-safe (see below)
//   shot(page, label)          full-page PNG into --out
//   log(line)                  progress line (stdout + the .log file)
//   LOCALES, WIDTHS            the matrix defaults for this mode
//   quick, browserName, webkit, base, outDir, timeoutMs
//
// open(path, opts): { width = 1440, height = 900, reducedMotion =
// "no-preference", timezoneId = "UTC", hydrate = "main" }. It waits for the
// `load` event, a non-empty <main> (on a 2xx answer), web fonts, and React
// hydration of the `hydrate` selector (null skips it) — never
// `networkidle`, which never settles on a page with a long-lived request
// and is how a WebKit run can sit silent for hours. `errors` collects page
// errors and console errors as they arrive, minus the Vercel Speed Insights
// script's 404 (it is served only on Vercel, never by a local `next start`).
//
// Timeouts. Every Playwright action and navigation is capped at --timeout
// (seconds, default 60). Every section is also raced against its own limit
// (default 4 × --timeout; one layout cell 2 ×), so a hang outside
// Playwright's own timeouts — the ticket 21 WebKit run sat silent for four
// hours — becomes a FAIL and the run continues. The whole run is capped at
// --timeout-min (default 45): past it, "run (timeout)" is recorded, the
// results so far are written, and the process exits 1.
//
// WebKit: Playwright's WebKit follows Safari's default, where plain Tab
// skips links (only form controls and buttons are tab stops). Scenarios
// therefore never Tab to a link: pressOn() focuses the element directly,
// pressing Shift first so :focus-visible matches as it would for a keyboard
// user.
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
// @playwright/test is the declared dependency and re-exports the browser types.
import { chromium, webkit } from "@playwright/test";

export const BROWSERS = { chromium, webkit };

// Widths straddle the redesign's band edges (700/768 tablet, 1100 nav and
// two-column switch); quick keeps one per band for a WebKit run, which is
// several times slower than Chromium on Windows.
export const FULL = { locales: ["ja", "ko", "en"], widths: [320, 375, 390, 430, 768, 1024, 1099, 1100, 1440] };
export const QUICK = { locales: ["ko"], widths: [390, 1100, 1440] };

// The Speed Insights script is injected by @vercel/speed-insights and served
// only on Vercel; locally it 404s on every page. Matched on the failing URL
// as well as the text (Chromium's console text for a failed resource omits
// the URL).
const KNOWN_NOISE = /\/_vercel\/speed-insights\//;

class SectionTimeout extends Error {}
function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new SectionTimeout(`no result after ${Math.round(ms / 1000)}s`)), ms);
    }),
  ]);
}

/**
 * Top-level i18n namespaces of this repo's messages/*.json. A visible
 * "Namespace.key" string means a lookup fell through to the raw key.
 */
export function messageNamespaces(repoRoot) {
  const dir = path.join(repoRoot, "messages");
  const ns = new Set();
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    for (const k of Object.keys(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))) ns.add(k);
  }
  return [...ns];
}

/**
 * Run one scenario. Resolves with the summary (also written to
 * <outDir>/<stem>.json); on the whole-run timeout the process exits 1 from
 * here after writing what it has.
 */
export async function runScenario({
  scenario,
  browserName,
  quick,
  base,
  outDir,
  timeoutMs,
  runMs,
  fixture = null,
  onlyFixture = false,
  namespaces = [],
}) {
  fs.mkdirSync(outDir, { recursive: true });
  const stem = `${scenario.name}-${browserName}${quick ? "-quick" : ""}${onlyFixture ? "-fixture" : ""}`;
  const logFile = path.join(outDir, `${stem}.log`);
  const jsonFile = path.join(outDir, `${stem}.json`);
  fs.writeFileSync(logFile, "");
  const started = Date.now();
  // Synchronous append: if the run hangs or is killed, the log still shows
  // the last thing it reached.
  const log = (line) => {
    console.log(line);
    fs.appendFileSync(logFile, line + "\n");
  };
  const elapsed = () => `${Math.round((Date.now() - started) / 1000)}s`;

  const results = [];
  // The section a check() runs in. A timed-out section's body cannot be
  // cancelled and may still settle later; its late checks are dropped so
  // they never land among the next section's.
  const scopeStore = new AsyncLocalStorage();
  const late = () => scopeStore.getStore()?.abandoned === true;
  const check = (name, ok, detail = "") => {
    if (late()) return;
    const d = String(detail ?? "");
    results.push({ name, ok: !!ok, detail: d });
    log(`${ok ? "PASS" : "FAIL"} ${name}${d ? " — " + d : ""}`);
  };

  let finished = false;
  const summarize = (extra = {}) => {
    const failed = results.filter((r) => !r.ok);
    const summary = {
      scenario: scenario.name,
      browser: browserName,
      quick,
      onlyFixture,
      base,
      at: new Date(started).toISOString(),
      seconds: Math.round((Date.now() - started) / 1000),
      passed: results.length - failed.length,
      failed: failed.length,
      total: results.length,
      results,
      ...extra,
    };
    fs.writeFileSync(jsonFile, JSON.stringify(summary, null, 2));
    log("");
    for (const f of failed) log(`FAIL ${f.name} — ${f.detail}`);
    log(`${summary.passed}/${summary.total} PASS (${scenario.name}, ${browserName}${quick ? ", quick" : ""}) in ${summary.seconds}s → ${jsonFile}`);
    return summary;
  };

  log(
    `page-qa ${scenario.name} on ${browserName}${quick ? " (quick)" : ""} against ${base}; ` +
      `timeout ${timeoutMs / 1000}s per action, ${runMs / 60000} min overall`,
  );

  // Whole-run guard, armed before the launch so a launch that hangs is
  // caught too. It does not close the browser: the main flow is still
  // running and would throw out of its awaits before the summary is
  // written. Playwright kills the browsers it launched when the process
  // exits.
  const runTimer = setTimeout(() => {
    if (finished) return;
    finished = true;
    results.push({ name: "run (timeout)", ok: false, detail: `whole run exceeded ${runMs / 60000} min; results so far kept` });
    log(`FAIL run (timeout) — whole run exceeded ${runMs / 60000} min at ${elapsed()}`);
    summarize({ timedOut: true });
    process.exit(1);
  }, runMs);

  const browser = await BROWSERS[browserName].launch({ timeout: timeoutMs });

  const newContext = async (opts) => {
    const ctx = await browser.newContext(opts);
    ctx.setDefaultTimeout(timeoutMs);
    ctx.setDefaultNavigationTimeout(timeoutMs);
    scopeStore.getStore()?.contexts.add(ctx);
    return ctx;
  };

  // One run-wide request context for status/redirect checks; maxRedirects
  // is set per call so a 308 is seen, not followed.
  const api = (await newContext({})).request;

  const h = {
    check,
    log,
    base,
    outDir,
    quick,
    browserName,
    webkit: browserName === "webkit",
    timeoutMs,
    LOCALES: (quick ? QUICK : FULL).locales,
    WIDTHS: (quick ? QUICK : FULL).widths,

    async section(name, fn, { ms = timeoutMs * 4 } = {}) {
      if (finished) return false;
      log(`» ${name} (${elapsed()})`);
      const scope = { abandoned: false, contexts: new Set() };
      let ok = true;
      try {
        await withTimeout(scopeStore.run(scope, fn), ms);
      } catch (e) {
        const timedOut = e instanceof SectionTimeout;
        check(`${name} (${timedOut ? "timeout" : "threw"})`, false, String(e?.message ?? e).split("\n")[0].slice(0, 300));
        if (timedOut) scope.abandoned = true;
        ok = false;
      }
      // Closing the contexts also makes a hung Playwright call in an
      // abandoned body throw and stop. Bounded: WebKit's close can hang.
      for (const ctx of scope.contexts) await withTimeout(ctx.close(), 10_000).catch(() => {});
      return ok;
    },

    async open(p, { width = 1440, height = 900, reducedMotion = "no-preference", timezoneId = "UTC", hydrate = "main" } = {}) {
      const ctx = await newContext({ viewport: { width, height }, reducedMotion, timezoneId });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        const where = m.location()?.url ?? "";
        if (KNOWN_NOISE.test(where) || KNOWN_NOISE.test(m.text())) return;
        errors.push(`${m.text().slice(0, 200)}${where ? ` @ ${where}` : ""}`);
      });
      const resp = await page.goto(base + p, { waitUntil: "load" });
      if (resp?.ok()) await page.locator("main > *").first().waitFor({ state: "attached" });
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      // React tags every hydrated host node with `__reactFiber$…`; a key
      // press or client-side Link navigation before that lands on inert
      // server HTML.
      if (resp?.ok() && hydrate) {
        await page.waitForFunction(
          (sel) => {
            const el = document.querySelector(sel);
            return !!el && Object.keys(el).some((k) => k.startsWith("__reactFiber$"));
          },
          hydrate,
        );
      }
      return { ctx, page, resp, errors };
    },

    async pressOn(page, selector, key = "Enter") {
      await page.keyboard.press("Shift");
      await page.focus(selector);
      await page.keyboard.press(key);
    },

    async shot(page, label) {
      const file = path.join(outDir, `${scenario.name}-${browserName}-${label}.png`);
      await page.screenshot({ path: file, fullPage: true });
      return file;
    },

    async expectStatus(name, p, { status, location } = {}) {
      const r = await api.get(base + p, { maxRedirects: 0 });
      const loc = r.headers().location ?? "";
      check(name, r.status() === status && (!location || location.test(loc)), `${r.status()}${loc ? " " + loc : ""}`);
      return r;
    },

    async getText(p) {
      return (await api.get(base + p)).text();
    },

    // Per cell (its own section, 2 × --timeout): open path(locale) at the
    // width, then the generic checks
    //   "<prefix> <loc> <w>: no page overflow"      document scrollWidth
    //   "<prefix> <loc> <w>: html lang"             <html lang> = locale
    //   "<prefix> <loc> <w>: no raw keys / errors"  no visible
    //                                               "Namespace.key", no page/
    //                                               console error
    // and `cell({ page, loc, width, name, check, errors })` for the
    // scenario's own checks, `name(suffix)` giving "<prefix> <loc> <w>: …".
    async layoutMatrix({ path: pathFor, locales = h.LOCALES, widths = h.WIDTHS, prefix = "layout", height = 900, cell }) {
      for (const loc of locales) {
        for (const width of widths) {
          const name = (s) => `${prefix} ${loc} ${width}: ${s}`;
          await h.section(
            `${prefix} ${loc} ${width}`,
            async () => {
              const { page, errors } = await h.open(pathFor(loc), { width, height });
              // Every dotted "Word.word…" token, kept when its first part is a
              // message namespace: a fixed pattern plus a lookup, not a RegExp
              // built from the namespace list (CI Semgrep blocks those), and
              // a dotted word that is not a namespace ("Ver.SAKURA") is prose.
              const g = await page.evaluate(
                (ns) => ({
                  scrollW: document.documentElement.scrollWidth,
                  innerW: innerWidth,
                  lang: document.documentElement.lang,
                  rawKeys: [...document.body.innerText.matchAll(/\b([A-Za-z]+)\.[A-Za-z][\w.]*/g)]
                    .filter((m) => ns.includes(m[1]))
                    .map((m) => m[0])
                    .slice(0, 3),
                }),
                namespaces,
              );
              check(name("no page overflow"), g.scrollW <= g.innerW, `${g.scrollW}/${g.innerW}`);
              check(name("html lang"), g.lang === loc, g.lang);
              if (cell) await cell({ page, loc, width, name, check, errors });
              // Last, so errors raised by the cell's own interactions count.
              check(name("no raw keys / errors"), g.rawKeys.length === 0 && errors.length === 0, [...g.rawKeys, ...errors].join(" | "));
            },
            { ms: timeoutMs * 2 },
          );
        }
      }
    },

    // `selectors` should each match an element that has a transition or
    // animation normally. Two checks: "<label>: transitions off" (every
    // selector present and not moving under reduce) and "<label>: positive
    // control (transition present otherwise)" (at least one moves without
    // reduce) — without the control, a selector that never animated would
    // pass the first check for the wrong reason.
    async reducedMotion({ path: p, selectors, width = 390, label = "reduced motion" }) {
      const read = (page) =>
        page.evaluate((sels) => {
          const positive = (v) => v.split(",").some((x) => parseFloat(x) > 0);
          return sels.map((sel) => {
            const el = document.querySelector(sel);
            if (!el) return { sel, missing: true };
            const s = getComputedStyle(el);
            const moving = positive(s.transitionDuration) || (s.animationName !== "none" && positive(s.animationDuration));
            return { sel, moving, t: s.transitionDuration, a: s.animationName };
          });
        }, selectors);
      const show = (rs) => rs.map((r) => (r.missing ? `${r.sel} missing` : `${r.t}/${r.a}`)).join(" ");
      const reduced = await read((await h.open(p, { width, reducedMotion: "reduce", hydrate: null })).page);
      check(`${label}: transitions off`, reduced.every((r) => !r.missing && !r.moving), show(reduced));
      const normal = await read((await h.open(p, { width, hydrate: null })).page);
      check(`${label}: positive control (transition present otherwise)`, normal.some((r) => r.moving), show(normal));
    },
  };

  try {
    if (!onlyFixture) await scenario.run(h);
    if (fixture) await scenario.fixture.run(h, fixture);
  } catch (e) {
    // A throw outside any section (a scenario bug) still ends with results.
    check("run completed", false, String(e?.stack ?? e).slice(0, 600));
  }
  if (finished) return null;
  finished = true;
  clearTimeout(runTimer);
  // Results first: Playwright's WebKit on Windows can hang in
  // browser.close() (its network process lingers), so the close is bounded.
  const summary = summarize();
  await withTimeout(browser.close(), 10_000).catch(() => log("browser.close() did not return in 10s; exiting anyway"));
  return summary;
}
