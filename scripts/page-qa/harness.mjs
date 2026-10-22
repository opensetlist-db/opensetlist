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
//   skip(name, detail)         record SKIP: the check's subject is absent on
//                              this build or this data (a page not yet
//                              redesigned, no show on today). Never fails the
//                              run; counted apart from PASS
//   section(name, fn, {ms})    run fn as one unit: a throw or a timeout is a
//                              FAIL "<name> (threw|timeout)" and the run moves
//                              on; contexts opened inside are closed after.
//                              Sections do not nest (an inner one throws)
//   open(path, opts)           new context + page, goto base+path; returns
//                              { ctx, page, resp, errors } (opts below)
//   layoutMatrix(opts)         locales × widths; the generic checks per cell
//                              plus the scenario's own `cell` callback;
//                              `basics: true` adds one <h1> in <main>, no
//                              control under 24×24px and valid heading
//                              markup (no heading in a phrasing-only parent,
//                              <summary> headings direct and at most one),
//                              `capture: true` a
//                              full-page PNG per cell taken BEFORE `cell` (so
//                              no focus ring or skip link is in it)
//   reducedMotion(opts)        transitions/animations off under reduce, and
//                              present without it (positive control);
//                              `rest: { opacity: "1" }` computed styles the
//                              elements must settle on under reduce,
//                              `optional: true` SKIP when a selector is absent
//   focusRing(page, name, selector, ring)  keyboard-style focus, outline
//                              matched against the RegExp `ring`
//   scrollRegion(page, opts)   horizontal scroller: scrolls only below a
//                              width, last link reachable, ArrowRight scrolls
//   contrast(page, pairs, name)  text contrast ≥ 4.5:1 by exact CSS-module
//                              class suffix, over a linear gradient against
//                              its worst stop; returns the pair names found
//   clipped(page, selectors)   text cut off (ellipsis, line-clamp, or
//                              overflow the box clips) → [{ text, why }]
//   expectStatus(name, path, { status, location })   request API, no redirect
//                              following; `location` a RegExp on the header
//   getText(path)              response body through the request API
//   afterNav(page, { url, ready, action })  client-side navigation done:
//                              the URL matches AND `ready` is in <main> (the
//                              URL flips before the RSC payload re-renders);
//                              `action` (a click, goBack) runs with the URL
//                              wait armed. One --timeout for both waits
//   pressOn(page, selector, key)  focus + key, WebKit-safe (see below)
//   shot(page, label)          full-page PNG into --out (WebKit, over
//                              32,767px: `.partN.png` parts); returns paths
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
// errors, console errors and responses ≥400 as they arrive, minus the Vercel
// Speed Insights script's 404 (it is served only on Vercel, never by a local
// `next start`). Responses are judged by their URL and status: the console
// line for a failed resource carries no URL in Chromium, so those lines are
// left to the response listener.
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
import { execFileSync } from "node:child_process";
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

// Response that may fail locally: exactly the Speed Insights script's 404 on
// the server under test (any other status or host counts).
const knownNoiseResponse = (r, base) =>
  r.status() === 404 && r.url().startsWith(`${base}/_vercel/speed-insights/`);

// WebKit refuses a screenshot taller than this many device px; h.shot()
// captures such a page in parts of SHOT_PART_HEIGHT (WebP's 16,383 px side
// limit, rounded down as in redesign-capture.mjs).
const WEBKIT_MAX_SHOT = 32767;
const SHOT_PART_HEIGHT = 16000;

// In-page (serialised into page.evaluate): layoutMatrix `basics`. Targets
// are visible a/button/input/select/textarea in <main> under 24×24 CSS px
// (WCAG 2.2 target size, minimum); sr-only controls (1px, clipped) are not
// pointer targets. Links inside running prose count too, although WCAG
// exempts them — a prose-heavy page would need its own filter. `targets`
// (how many were inspected) is the check's positive control.
function basicsInPage() {
  const main = document.querySelector("main");
  const targets = [...(main?.querySelectorAll("a, button, input, select, textarea") ?? [])].filter((el) => {
    if (el.type === "hidden") return false;
    const r = el.getBoundingClientRect();
    return getComputedStyle(el).visibility !== "hidden" && r.width > 1 && r.height > 1;
  });
  const small = targets.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width < 24 || r.height < 24;
  });
  return {
    targets: targets.length,
    h1: main ? main.querySelectorAll("h1").length : 0,
    small: small.slice(0, 3).map((el) => {
      const r = el.getBoundingClientRect();
      const text = (el.textContent || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 25);
      return `${el.tagName.toLowerCase()} "${text}" ${Math.round(r.width)}×${Math.round(r.height)}`;
    }),
    smallCount: small.length,
  };
}

// In-page (serialised into page.evaluate, so every helper stays inside
// the function): layoutMatrix `basics` heading markup. Headings in <main> are
// flow content; React builds the DOM by hand, so a design that wraps one in
// a <span> (or puts it inside <summary> behind a wrapper) renders exactly
// as written instead of being repaired by the HTML parser — the invalid
// tree reaches the accessibility tree and any reader of the markup. FAILs:
//   - a heading whose parent only takes phrasing content (span, strong,
//     label, button, p, another heading, …; plus address, dt and th; the list is
//     not exhaustive). `a`, `ins` and `del` are transparent (their
//     content model is their parent's), so a heading in a card link
//     (<div><a><h3>) is valid and is judged by the first ancestor above
//     them;
//   - a <summary> heading that is not a direct child (summary takes
//     phrasing content, optionally intermixed with ONE heading, as a child);
//   - a <summary> with more than one heading as direct children.
// `headings` (how many were inspected) is the positive control. Exported
// for its unit test (src/__tests__/unit/page-qa-markup.test.ts), which runs
// it under jsdom against a bad and a good structure.
export function markupInPage() {
  const main = document.querySelector("main");
  const HEADING = "h1, h2, h3, h4, h5, h6";
  const PHRASING_ONLY = new Set([
    "abbr", "b", "bdi", "bdo", "button", "cite", "code", "data", "dfn", "em", "i", "kbd", "label",
    "mark", "meter", "output", "p", "pre", "progress", "q", "rp", "rt", "ruby", "s", "samp", "small", "span",
    "strong", "sub", "sup", "time", "u", "var",
    // Not phrasing-only, but they forbid heading content all the same.
    "address", "dt", "th",
    // A heading's own content is phrasing too, so a nested heading fails.
    // Not `legend`: it takes phrasing optionally intermixed with headings.
    "h1", "h2", "h3", "h4", "h5", "h6",
  ]);
  const TRANSPARENT = new Set(["a", "ins", "del"]);
  const tag = (el) => el.tagName.toLowerCase();
  const describe = (el) => {
    const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).join(".") : "";
    return `${tag(el)}${cls}`;
  };
  const headings = [...(main?.querySelectorAll(HEADING) ?? [])];
  // One entry per offending element, with every reason it fails.
  const bad = new Map();
  const flag = (el, why) => bad.set(el, [...(bad.get(el) ?? []), why]);
  for (const hd of headings) {
    let parent = hd.parentElement;
    while (parent && TRANSPARENT.has(tag(parent))) parent = parent.parentElement;
    if (parent && PHRASING_ONLY.has(tag(parent))) flag(hd, `inside <${describe(parent)}>`);
  }
  for (const s of main?.querySelectorAll("summary") ?? []) {
    const direct = [...s.children].filter((c) => c.matches(HEADING));
    for (const hd of s.querySelectorAll(HEADING)) if (hd.parentElement !== s) flag(hd, "in <summary> but not its direct child");
    if (direct.length > 1) flag(s, `${direct.length} headings directly inside`);
  }
  const entries = [...bad].map(([el, why]) => {
    const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 25);
    return `${describe(el)} "${text}" ${why.join("; ")}`;
  });
  return { headings: headings.length, bad: entries.slice(0, 3), badCount: entries.length };
}

// In-page: contrast(). Per pair, one entry per visible element whose class
// ends in `__<name>`: its text colour and the background layers from it
// (or its `__<bg>` ancestor) up to the first opaque colour, innermost
// first. A layer is a background-color string, or `{ stops }` for a
// background-image made only of linear gradients (painted above the same
// element's background-color): the colour stops, each of which the text may
// sit on. `image` names the element of any other background-image (a url(),
// a radial or conic gradient), which this check cannot see through. `from`
// names the element whose background decides the result: the gradient's
// when there is one, else the first opaque colour's.
function readContrastInPage(pairs) {
  const root = document.querySelector("main") ?? document.body;
  const hasSuffix = (e, n) => [...e.classList].some((c) => c.endsWith("__" + n));
  const alpha = (c) => {
    if (c === "transparent") return 0;
    const n = c.match(/[\d.]+%?/g) ?? [];
    if (n.length < 4) return 1;
    return n[3].endsWith("%") ? parseFloat(n[3]) / 100 : parseFloat(n[3]);
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return getComputedStyle(el).visibility !== "hidden" && r.width > 0 && r.height > 0;
  };
  return pairs.map(({ name, bg }) => {
    const els = [...root.querySelectorAll("*")].filter((e) => hasSuffix(e, name) && visible(e));
    return {
      name,
      items: els.map((el) => {
        let start = el;
        if (bg) while (start && !hasSuffix(start, bg)) start = start.parentElement;
        if (!start) return { missingBg: true };
        const label = (a) => (a === el ? "self" : ([...a.classList].find((c) => c.includes("__")) ?? a.tagName.toLowerCase()));
        const layers = [];
        let image = null;
        let gradient = null;
        let from = "page white";
        for (let a = start; a; a = a.parentElement) {
          const cs = getComputedStyle(a);
          const bi = cs.backgroundImage;
          if (bi !== "none") {
            // Every comma-separated layer a (repeating-)linear-gradient:
            // split on top-level commas only (the stops carry their own).
            const parts = [];
            let depth = 0;
            let cur = "";
            for (const ch of bi) {
              if (ch === "," && depth === 0) {
                parts.push(cur.trim());
                cur = "";
                continue;
              }
              if (ch === "(") depth++;
              if (ch === ")") depth--;
              cur += ch;
            }
            parts.push(cur.trim());
            const linear = parts.every((p) => /^(repeating-)?linear-gradient\(/.test(p));
            const stops = bi.match(/rgba?\([^)]*\)/g) ?? [];
            // A stop the browser keeps in another colour syntax (oklch(),
            // color(), color-mix()…) would be left out of `stops` and the
            // rest measured as if complete; such a gradient is unmeasured.
            const otherColour = /\b(?:ok)?l(?:ab|ch)\(|\bcolor(?:-mix)?\(|\bhsla?\(|\bhwb\(/.test(bi);
            if (linear && stops.length && !otherColour) {
              layers.push({ stops });
              gradient ??= label(a);
              // Opaque at every stop: nothing behind it shows through, so a
              // url() image further up must not turn the item into a SKIP.
              if (stops.every((s) => alpha(s) >= 1)) break;
            } else {
              image ??= `${label(a)}${linear ? ", gradient colours not rgb()" : ""}`;
            }
          }
          layers.push(cs.backgroundColor);
          if (alpha(cs.backgroundColor) >= 1) {
            from = label(a);
            break;
          }
        }
        return { fg: getComputedStyle(el).color, layers, image, from: gradient ? `${gradient} gradient` : from };
      }),
    };
  });
}

function parseRgb(c) {
  if (c === "transparent") return { rgb: [0, 0, 0], a: 0 };
  const m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(c ?? "");
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return { rgb: [m[1], m[2], m[3]].map(Number), a };
}
// Source-over: a colour with alpha onto an opaque one.
const over = (top, under) => top.rgb.map((v, i) => v * top.a + under[i] * (1 - top.a));
// Background layers innermost first, ending at the first opaque one (or the
// page's white canvas when none is) → the opaque colour the text sits on.
function compositeLayers(layers) {
  const parsed = layers.map(parseRgb);
  if (parsed.some((x) => !x)) return null;
  let under = [255, 255, 255];
  for (const x of parsed.reverse()) under = over(x, under);
  return under;
}
// Layers with gradients (`{ stops }`, see readContrastInPage) → one plain
// colour list per combination of sampled colours, so every colour the text
// may sit on is judged. Each gradient is sampled at its stops and at 1/4,
// 1/2 and 3/4 between neighbouring stops: luminance along an sRGB mix is
// not monotonic (red → green dips below both ends midway), so dark text on
// a hue-shifting gradient can fail between two stops that both pass.
function stopVariants(layers) {
  const mix = (a, b, t) => {
    const [x, y] = [parseRgb(a), parseRgb(b)];
    if (!x || !y) return a; // unparsed: left to compositeLayers to report
    const [r, g, bl] = x.rgb.map((v, i) => v + (y.rgb[i] - v) * t);
    return `rgba(${r}, ${g}, ${bl}, ${x.a + (y.a - x.a) * t})`;
  };
  const samples = (stops) =>
    stops.flatMap((s, i) => (i === 0 ? [s] : [0.25, 0.5, 0.75].map((t) => mix(stops[i - 1], s, t)).concat(s)));
  let out = [[]];
  for (const l of layers) {
    const choices = typeof l === "string" ? [l] : samples(l.stops);
    out = out.flatMap((v) => choices.map((c) => [...v, c]));
  }
  return out;
}
// WCAG 2 contrast ratio of two opaque sRGB colours.
function contrastRatio(a, b) {
  const lum = (rgb) => {
    const [r, g, bl] = rgb.map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

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
 * The checkout under test: the git work tree that holds the current
 * directory, not the one that holds this file. A copy of the QA scripts
 * extracted into another checkout (a redesign worktree's gitignored
 * .claude/tmp/, run with cwd = that worktree) then reads that checkout's
 * files, where a path relative to the script would land in .claude/.
 * Outside any git work tree it returns `fallback` (the caller's
 * script-relative root). The same function lives in admin-qa/harness.mjs
 * (and inlined in redesign-capture.mjs): each harness stays extractable
 * without the other, so change all three together.
 */
export function checkoutRoot(fallback) {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (top) return path.resolve(top);
  } catch {
    // not in a work tree, or git missing
  }
  return fallback;
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
  // A fixture run (with or without --only-fixture) gets its own files, so
  // it never overwrites the plain run's report in the same --out.
  const suffix = `${quick ? "-quick" : ""}${fixture ? "-fixture" : ""}`;
  const stem = `${scenario.name}-${browserName}${suffix}`;
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
  const skip = (name, detail = "") => {
    if (late()) return;
    const d = String(detail ?? "");
    results.push({ name, ok: true, skipped: true, detail: d });
    log(`SKIP ${name}${d ? " — " + d : ""}`);
  };

  let finished = false;
  const summarize = (extra = {}) => {
    const failed = results.filter((r) => !r.ok);
    const skipped = results.filter((r) => r.skipped).length;
    const summary = {
      scenario: scenario.name,
      browser: browserName,
      quick,
      onlyFixture,
      base,
      at: new Date(started).toISOString(),
      seconds: Math.round((Date.now() - started) / 1000),
      passed: results.length - failed.length - skipped,
      skipped,
      failed: failed.length,
      total: results.length,
      results,
      ...extra,
    };
    fs.writeFileSync(jsonFile, JSON.stringify(summary, null, 2));
    log("");
    for (const f of failed) log(`FAIL ${f.name} — ${f.detail}`);
    log(`${summary.passed}/${summary.total} PASS${skipped ? `, ${skipped} SKIP` : ""} (${scenario.name}, ${browserName}${quick ? ", quick" : ""}) in ${summary.seconds}s → ${jsonFile}`);
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

  // Set inside the try below, so a launch failure is reported like any
  // other and still writes the JSON.
  let browser;
  let api;

  const newContext = async (opts) => {
    const scope = scopeStore.getStore();
    const ctx = await browser.newContext(opts);
    // A section that already ended (an abandoned body still running after
    // its timeout) gets no new context: nobody would close it.
    if (scope?.closed) {
      await withTimeout(ctx.close(), 10_000).catch(() => {});
      throw new Error("section already ended");
    }
    ctx.setDefaultTimeout(timeoutMs);
    ctx.setDefaultNavigationTimeout(timeoutMs);
    scope?.contexts.add(ctx);
    return ctx;
  };

  const h = {
    check,
    skip,
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
      // One level only: an inner scope would hide the outer one's
      // abandoned flag and contexts.
      if (scopeStore.getStore()) throw new Error(`h.section("${name}") inside another section`);
      log(`» ${name} (${elapsed()})`);
      const scope = { abandoned: false, closed: false, contexts: new Set() };
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
      scope.closed = true;
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
        // An HTTP error status: reported, with its URL, by the listener below.
        if (/^Failed to load resource: the server responded with a status of/.test(m.text())) return;
        errors.push(`${m.text().slice(0, 200)}${where ? ` @ ${where}` : ""}`);
      });
      page.on("response", (r) => {
        if (r.status() >= 400 && !knownNoiseResponse(r, base)) errors.push(`${r.status()} ${r.url().slice(0, 200)}`);
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

    // Client-side navigation (a Link click, a ?tab= link, page.goBack()):
    // the URL changes before the RSC payload re-renders <main>, so a DOM
    // read right after waitForURL sees the old (or an empty) page. Waits
    // for `url` (anything page.waitForURL takes: RegExp, glob string or
    // URL predicate), then for `ready` attached inside <main> — a selector
    // that exists only on the destination, or the wait passes on the old
    // page. `action` (optional) is started together with the URL wait, so
    // a fast navigation cannot finish before the wait is armed; without
    // it, call this after the navigation (waitForURL also accepts a URL
    // that already matches). Both waits share one --timeout deadline.
    // Returns the `ready` locator.
    async afterNav(page, { url, ready, action }) {
      const deadline = Date.now() + timeoutMs;
      const left = () => Math.max(1, deadline - Date.now());
      const nav = page.waitForURL(url, { timeout: timeoutMs });
      if (action) await Promise.all([nav, action()]);
      else await nav;
      const target = page.locator("main").locator(ready).first();
      await target.waitFor({ state: "attached", timeout: left() });
      return target;
    },

    async pressOn(page, selector, key = "Enter") {
      await page.keyboard.press("Shift");
      await page.focus(selector);
      await page.keyboard.press(key);
    },

    // Full-page PNG; on WebKit, a page over its 32,767-device-px screenshot
    // limit (the unpaginated /ko/albums is ~50,000px at 390) is written as
    // clipped `<label>.partN.png` parts of SHOT_PART_HEIGHT device px — the
    // cut points redesign-capture.mjs uses for its `.partN.webp` files.
    // Returns the paths written, top to bottom.
    async shot(page, label) {
      const stem = path.join(outDir, `${scenario.name}-${browserName}${suffix}-${label}`);
      const { w, ht, dpr } = await page.evaluate(() => ({
        w: document.documentElement.scrollWidth,
        ht: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
        dpr: devicePixelRatio,
      }));
      if (!h.webkit || ht * dpr <= WEBKIT_MAX_SHOT) {
        await page.screenshot({ path: `${stem}.png`, fullPage: true });
        return [`${stem}.png`];
      }
      const step = Math.floor(SHOT_PART_HEIGHT / dpr);
      const files = [];
      for (let y = 0; y < ht; y += step) {
        const file = `${stem}.part${files.length + 1}.png`;
        // `clip` with `fullPage` is in page coordinates; Playwright trims
        // the last part to the page.
        await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y, width: w, height: Math.min(step, ht - y) } });
        files.push(file);
      }
      return files;
    },

    // Text elements matching `selectors` (a CSS selector or a list) that are
    // set to truncate or are cut off: `text-overflow: ellipsis` or any
    // `-webkit-line-clamp` counts even where the text fits today (it is for
    // text the design says must wrap, which another width or a longer name
    // would cut), and overflow-x other than visible with content wider than
    // the box. Plain `scrollWidth > clientWidth` is not enough on its own: Chrome
    // hangs a trailing full-width "）" ~2px past the box (it trims end-of-
    // line punctuation) while still painting it in full, so overflow counts
    // only where the box actually clips it. Hidden elements are ignored.
    // Returns [{ text, why }] (empty when nothing is clipped) for a check
    // such as `check(name("never clipped"), c.length === 0, …)`.
    async clipped(page, selectors) {
      const sel = Array.isArray(selectors) ? selectors.join(", ") : selectors;
      return page.evaluate((s) => {
        const out = [];
        for (const el of document.querySelectorAll(s)) {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          if (cs.visibility === "hidden" || r.width === 0 || r.height === 0) continue;
          const clamp = cs.webkitLineClamp ?? cs.getPropertyValue("-webkit-line-clamp");
          const why =
            cs.textOverflow === "ellipsis"
              ? "ellipsis"
              : clamp && clamp !== "none"
                ? `line-clamp ${clamp}`
                : cs.overflowX !== "visible" && el.scrollWidth > el.clientWidth + 1
                  ? `overflow-x ${cs.overflowX} ${el.scrollWidth}>${el.clientWidth}`
                  : null;
          if (why) out.push({ text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40), why });
        }
        return out;
      }, sel);
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
    // width — a non-2xx answer fails the cell as "(threw)" — then the
    // generic checks
    //   "<prefix> <loc> <w>: no page overflow"      document scrollWidth
    //   "<prefix> <loc> <w>: html lang"             <html lang> = locale
    //   "<prefix> <loc> <w>: no raw keys / errors"  no visible
    //                                               "Namespace.key", no page/
    //                                               console error
    // and `cell({ page, loc, width, name, check, errors })` for the
    // scenario's own checks, `name(suffix)` giving "<prefix> <loc> <w>: …".
    // Opt-in, between the generic checks and `cell`:
    //   basics   "one h1" (in <main>), "no target under 24px" and "heading
    //            markup" (markupInPage)
    //   capture  h.shot(page, "<prefix>-<loc>-<w>") — before `cell`, so a
    //            focus ring or the skip link from the cell's keyboard steps
    //            never lands in a comparison capture
    async layoutMatrix({
      path: pathFor,
      locales = h.LOCALES,
      widths = h.WIDTHS,
      prefix = "layout",
      height = 900,
      basics = false,
      capture = false,
      cell,
    }) {
      for (const loc of locales) {
        for (const width of widths) {
          const name = (s) => `${prefix} ${loc} ${width}: ${s}`;
          await h.section(
            `${prefix} ${loc} ${width}`,
            async () => {
              const { page, resp, errors } = await h.open(pathFor(loc), { width, height });
              // Positive control for every check below: on an error page
              // (a wrong path, a 404) they would pass for the wrong reason.
              if (!resp?.ok()) throw new Error(`${pathFor(loc)} answered ${resp?.status() ?? "nothing"}`);
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
              if (basics) {
                const b = await page.evaluate(basicsInPage);
                check(name("one h1"), b.h1 === 1, String(b.h1));
                check(
                  name("no target under 24px"),
                  b.targets > 0 && b.smallCount === 0,
                  `${b.smallCount}/${b.targets}${b.smallCount ? ": " + b.small.join(", ") : ""}`,
                );
                const m = await page.evaluate(markupInPage);
                check(
                  name("heading markup"),
                  m.headings > 0 && m.badCount === 0,
                  `${m.badCount} bad of ${m.headings} headings${m.badCount ? ": " + m.bad.join(" | ") : ""}`,
                );
              }
              if (capture) await h.shot(page, `${prefix}-${loc}-${width}`);
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
    // control (transition present otherwise)" (every one moves without
    // reduce) — without the control, a selector that never animated would
    // pass the first check for the wrong reason, so the control covers each
    // selector, not just one of them.
    //
    // `rest` (computed property → value) is also required of every selector
    // under reduce: an animation removed mid-cycle can leave an element at a
    // keyframe's value (a pulsing dot frozen half-transparent). `optional`
    // turns a selector missing from the NORMAL load into one SKIP for both
    // checks — for elements that exist only on some data (a LIVE badge);
    // one present normally but missing under reduce still FAILs.
    async reducedMotion({ path: p, selectors, width = 390, label = "reduced motion", rest = null, optional = false }) {
      const read = (page) =>
        page.evaluate(
          ({ sels, props }) => {
            const positive = (v) => v.split(",").some((x) => parseFloat(x) > 0);
            return sels.map((sel) => {
              const el = document.querySelector(sel);
              if (!el) return { sel, missing: true };
              const s = getComputedStyle(el);
              const moving = positive(s.transitionDuration) || (s.animationName !== "none" && positive(s.animationDuration));
              const rest = Object.fromEntries(props.map((k) => [k, s.getPropertyValue(k)]));
              return { sel, moving, t: s.transitionDuration, a: s.animationName, rest };
            });
          },
          { sels: selectors, props: Object.keys(rest ?? {}) },
        );
      const show = (rs) =>
        rs
          .map((r) => (r.missing ? `${r.sel} missing` : `${r.t}/${r.a}${rest ? " " + JSON.stringify(r.rest) : ""}`))
          .join(" ");
      const reduced = await read((await h.open(p, { width, reducedMotion: "reduce", hydrate: null })).page);
      const normal = await read((await h.open(p, { width, hydrate: null })).page);
      if (optional && normal.some((r) => r.missing)) {
        skip(`${label}`, `not on this page/data: ${show(normal)}`);
        return;
      }
      const atRest = (r) => Object.entries(rest ?? {}).every(([k, v]) => r.rest[k] === v);
      // Control first, so the log reads in the order the claim depends on.
      check(`${label}: positive control (transition present otherwise)`, normal.every((r) => !r.missing && r.moving), show(normal));
      check(`${label}: transitions off`, reduced.every((r) => !r.missing && !r.moving && atRest(r)), show(reduced));
    },

    // Focus `selector` as a keyboard user would reach it — Shift first, so
    // :focus-visible matches a programmatic focus (links included) — and
    // match "<style> <width> <color> <offset>" of the focused element's
    // outline against the RegExp `ring`. SKIP when nothing matches.
    async focusRing(page, name, selector, ring) {
      const target = page.locator(selector).first();
      if (!(await target.count())) return skip(name, `${selector} absent`);
      await page.keyboard.press("Shift");
      await target.focus();
      const r = await page.evaluate(() => {
        const a = document.activeElement;
        const s = getComputedStyle(a);
        return {
          ring: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor} ${s.outlineOffset}`,
          el: `${a.tagName.toLowerCase()}${a.id ? "#" + a.id : ""}`,
        };
      });
      check(name, ring.test(r.ring), `${r.el}: ${r.ring}`);
    },

    // A horizontal scroller (a card rail) on `page`, which was opened at
    // `width` from `path`:
    //   "<name> scrolls below <scrollBelow>px" / "… static from …"  it
    //       overflows below the width; from there up it neither overflows
    //       nor has overflow-x auto/scroll
    //   "<name> last link in view on focus"  focusing its last link brings
    //       it into the region's box (polled for 2 s: WebKit scrolls a
    //       moment after focus())
    //   "<name> ArrowRight scrolls"  below the width only. On a FRESH page
    //       (h.open(path) at the same width): WebKit ignores arrow keys
    //       right after a programmatic scrollLeft reset, and reloading
    //       `page` itself would cancel its in-flight RSC prefetches, which
    //       WebKit logs as console errors that the cell's error check counts
    // With fewer than two links there is nothing to scroll to: SKIP.
    async scrollRegion(page, { name, selector, scrollBelow, width, path: p }) {
      const region = page.locator(selector).first();
      if (!(await region.count())) return skip(`${name} scroll`, `${selector} absent`);
      const s = await region.evaluate((el) => ({
        scrollable: el.scrollWidth > el.clientWidth + 1,
        overflowX: getComputedStyle(el).overflowX,
        links: el.querySelectorAll("a").length,
      }));
      if (s.links < 2) return skip(`${name} scroll`, `${s.links} link(s) in the region on this data`);
      const narrow = width < scrollBelow;
      if (narrow) check(`${name} scrolls below ${scrollBelow}px`, s.scrollable, `${s.links} links, scrollable ${s.scrollable}`);
      else
        check(
          `${name} static from ${scrollBelow}px`,
          !s.scrollable && !/auto|scroll/.test(s.overflowX),
          `${s.links} links, scrollable ${s.scrollable}, overflow-x ${s.overflowX}`,
        );
      await page.keyboard.press("Shift");
      await region.locator("a").last().focus();
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
          selector,
          { timeout: 2000 },
        )
        .then(
          () => true,
          () => false,
        );
      check(`${name} last link in view on focus`, inView);
      if (!narrow) return;
      // The fresh page exists only for the key press; its console is not
      // judged (the cell's own page already was).
      const fresh = (await h.open(p, { width })).page;
      const r2 = fresh.locator(selector).first();
      if (!(await r2.count())) return check(`${name} ArrowRight scrolls`, false, `${selector} absent after a fresh load of ${p}`);
      await r2.focus();
      const before = await r2.evaluate((el) => el.scrollLeft);
      await fresh.keyboard.press("ArrowRight");
      await fresh.waitForTimeout(1200);
      const after = await r2.evaluate((el) => el.scrollLeft);
      check(`${name} ArrowRight scrolls`, after > before, `${before}→${after}`);
    },

    // Text contrast ≥ 4.5:1 for each of `pairs` ("badge" or { name, bg }),
    // checked as "<name> <pair>" (pass e.g. "… contrast"). Elements are found by CSS-module
    // class SUFFIX, matched exactly: "badge" is a class ending in `__badge`
    // (`[class*=badge]` also matches a transparent `.badges` wrapper and
    // measures nothing). Every visible match is measured and the worst
    // reported. The background is the element's own — with `bg`, its
    // nearest `__<bg>` ancestor's — composited over the layers behind it up
    // to the first opaque one, so a translucent fill counts as it looks.
    // Ancestor `opacity` is not composited and can overstate the ratio.
    // Over a linear-gradient background the text is judged against each
    // colour stop and the worst one counts; `bg` in the detail then names
    // the element carrying the gradient. SKIP when no element matches, or
    // when text sits over any other background image (a url(), a radial
    // gradient: no colour to compare; judge it from the capture) — the
    // SKIP names that element.
    // Returns the pair names measured, so a scenario can FAIL a pair that is
    // measured nowhere in a whole run (a typo, a renamed class).
    async contrast(page, pairs, name) {
      const list = pairs.map((x) => (typeof x === "string" ? { name: x } : x));
      const found = [];
      for (const pr of await page.evaluate(readContrastInPage, list)) {
        const n = `${name} ${pr.name}`;
        if (!pr.items.length) {
          skip(n, `no visible .*__${pr.name}`);
          continue;
        }
        let worst = null;
        const unmeasured = [];
        for (const it of pr.items) {
          if (it.missingBg || it.image) {
            unmeasured.push(it.missingBg ? "no bg ancestor" : `background image (${it.image})`);
            continue;
          }
          const fg = parseRgb(it.fg);
          const bgs = stopVariants(it.layers).map(compositeLayers);
          if (!fg || bgs.some((b) => !b)) {
            const show = it.layers.map((l) => (typeof l === "string" ? l : `gradient(${l.stops.join(", ")})`));
            unmeasured.push(`unparsed ${it.fg} / ${show.join(" > ")}`);
            continue;
          }
          for (const bg of bgs) {
            const v = contrastRatio(fg.a < 1 ? over(fg, bg) : fg.rgb, bg);
            const on = `rgb(${bg.map(Math.round).join(", ")})${bgs.length > 1 ? ` (worst of ${bgs.length} gradient samples)` : ""}`;
            if (!worst || v < worst.v) worst = { v, fg: it.fg, bg: on, from: it.from };
          }
        }
        if (!worst) {
          skip(n, `cannot measure: ${unmeasured[0]}`);
          continue;
        }
        // Found = measured: a pair that only ever SKIPs as unmeasurable must
        // not satisfy a scenario's "found at some width" control.
        found.push(pr.name);
        check(
          n,
          worst.v >= 4.5,
          `${worst.v.toFixed(2)}, worst of ${pr.items.length - unmeasured.length} measured (${worst.fg} on ${worst.bg}, bg ${worst.from})`,
        );
        // The rest of the matches stay visible as their own SKIP, so a pass
        // on the measurable ones never hides an unchecked one.
        if (unmeasured.length) skip(`${n} (${unmeasured.length} not measured)`, unmeasured[0]);
      }
      return found;
    },
  };

  try {
    browser = await BROWSERS[browserName].launch({ timeout: timeoutMs });
    // One run-wide request context for status/redirect checks; maxRedirects
    // is set per call so a 308 is seen, not followed.
    api = (await newContext({})).request;
    if (!onlyFixture) await scenario.run(h);
    if (fixture) await scenario.fixture.run(h, fixture);
  } catch (e) {
    // A throw outside any section (a browser that failed to launch, a
    // scenario bug) still ends with results.
    check("run completed", false, String(e?.stack ?? e).slice(0, 600));
  }
  if (finished) return null;
  finished = true;
  clearTimeout(runTimer);
  // Results first: Playwright's WebKit on Windows can hang in
  // browser.close() (its network process lingers), so the close is bounded.
  const summary = summarize();
  if (browser) await withTimeout(browser.close(), 10_000).catch(() => log("browser.close() did not return in 10s; exiting anyway"));
  return summary;
}
