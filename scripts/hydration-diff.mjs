#!/usr/bin/env node
// Locate a React hydration mismatch (production "Minified React error
// #418 / #423 / #425", which names no component, text or location).
//
// Fetches the page's server-rendered HTML, loads the same URL in Playwright
// in each requested time zone, and prints:
//   - the page errors (uncaught exceptions — React reports a mismatch there)
//   - text only in the SSR HTML, and text only in the hydrated DOM, each with
//     a short ancestor path (tag#id[data-testid] / tag.class)
// When hydration fails React re-renders the root on the client, so the
// hydrated DOM is the client render and the two lists are the server and
// client sides of the mismatch. Redesign ticket 19 traced #418 this way to
// ImpressionCell dates formatted in the viewer's time zone: they only differ
// when the browser zone is not the server's (UTC), hence --timezone.
//
// Usage (from the repo root, against a running production build — see
// scripts/serve-build.sh; a dev server reports mismatches in readable form
// already):
//   node scripts/hydration-diff.mjs <url>
//     [--timezone <IANA zone>]...    repeatable, default UTC; e.g.
//                                    --timezone UTC --timezone Asia/Seoul
//                                    (redesign-capture.mjs runs in
//                                    Asia/Seoul, so start there when its
//                                    summary pointed here)
//     [--browser chromium|webkit]    default chromium
//     [--settle <ms>]                wait after `load` before reading the
//                                    DOM, default 1500
//     [--max <n>]                    lines per list, default 40
//     [--timeout <s>]                per fetch/navigation, default 60
//     [--run-timeout <min>]          whole run, default 10
//
// The text is compared as a multiset of each element's own text (its
// direct text children joined, whitespace collapsed), not by position:
// streamed Suspense content sits in hidden <div id="S:n"> holders in the
// HTML and moves into place on the client, and a client re-render splits
// text nodes differently from the server's <!-- --> separators. So a moved
// string is not a difference; a changed one shows on both sides.
//
// Not every difference is the mismatch: client effects that run after
// hydration (a fetch that fills a list, a relative "3 minutes ago") change
// text too. Compare the two time zones' output — the timezone-dependent
// lines are the ones that appear only in one of them — and the page
// errors tell whether hydration failed at all.
//
// Exits 1 when a zone shows a hydration error (or the fetch fails, or the
// run times out), 0 otherwise — text differences alone do not fail it,
// since post-hydration effects produce them on healthy pages; 2 on a usage
// error.
import { parseArgs } from "node:util";
// @playwright/test is the declared dependency and re-exports the browser types.
import { chromium, webkit } from "@playwright/test";

function usage(msg) {
  console.error(msg);
  console.error(
    "usage: node scripts/hydration-diff.mjs <url> [--timezone <zone>]... [--browser chromium|webkit] " +
      "[--settle <ms>] [--max <n>] [--timeout <s>] [--run-timeout <min>]",
  );
  process.exit(2);
}

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      timezone: { type: "string", multiple: true, default: [] },
      browser: { type: "string", default: "chromium" },
      settle: { type: "string", default: "1500" },
      max: { type: "string", default: "40" },
      timeout: { type: "string", default: "60" },
      "run-timeout": { type: "string", default: "10" },
    },
  });
} catch (e) {
  usage(e.message);
}
const { values: args, positionals } = parsed;
if (positionals.length !== 1) usage("exactly one <url> is required");
let url;
try {
  url = new URL(positionals[0]).href;
} catch {
  usage(`not an absolute URL: ${positionals[0]}`);
}
const BROWSERS = { chromium, webkit };
const browserType = BROWSERS[args.browser];
if (!browserType) usage(`--browser must be one of: ${Object.keys(BROWSERS).join(", ")}`);
const zones = args.timezone.length ? args.timezone : ["UTC"];
for (const z of zones) {
  // Intl rejects an unknown zone with a RangeError; Playwright would only
  // fail later, inside newContext, with a less direct message.
  try {
    new Intl.DateTimeFormat("en", { timeZone: z });
  } catch {
    usage(`unknown time zone: ${z}`);
  }
}
const SETTLE_MS = Number(args.settle);
const MAX = Number(args.max);
const STEP_MS = Number(args.timeout) * 1000;
const RUN_MS = Number(args["run-timeout"]) * 60_000;
// setTimeout fires at once above 2^31 ms (~24.8 days); a day is plenty.
if (!(STEP_MS > 0) || !(RUN_MS > 0) || STEP_MS > 86_400_000 || RUN_MS > 86_400_000)
  usage("--timeout and --run-timeout must be positive numbers, at most one day");
if (!(SETTLE_MS >= 0) || !(MAX > 0)) usage("--settle must be ≥ 0 and --max > 0");

// Whole-run guard: a hang outside Playwright's own timeouts (a wedged
// browser, WebKit's close on Windows) must not keep the run alive.
const runTimer = setTimeout(() => {
  console.log(`RUN TIMEOUT: --run-timeout ${args["run-timeout"]} min reached`);
  process.exit(1);
}, RUN_MS);

// Runs in the page. Collects each element's own text from a body — the
// parsed SSR string when `html` is given (DOMParser runs no scripts), else
// the live document — with a short ancestor path per entry.
function collectTexts(html) {
  const doc = html == null ? document : new DOMParser().parseFromString(html, "text/html");
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
  const step = (el) => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const testid = el.getAttribute("data-testid");
    if (id || testid) return `${tag}${id}${testid ? `[data-testid=${testid}]` : ""}`;
    // CSS-module classes carry the component's file name
    // (ImpressionCell_date__x1y2z), often the most direct pointer.
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "";
    return cls ? `${tag}.${cls}` : tag;
  };
  const pathOf = (el) => {
    const parts = [];
    for (let a = el; a && a !== doc.body && parts.length < 4; a = a.parentElement) parts.unshift(step(a));
    return parts.join(" > ");
  };
  const out = [];
  const walk = (el) => {
    if (SKIP.has(el.tagName)) return;
    let own = "";
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.nodeValue;
    own = own.replace(/\s+/g, " ").trim();
    if (own) out.push({ text: own, path: pathOf(el) });
    for (const c of el.children) walk(c);
  };
  if (doc.body) walk(doc.body);
  return out;
}

// a minus b as multisets of text; each surplus entry keeps its own path.
function minus(a, b) {
  const left = new Map();
  for (const e of b) left.set(e.text, (left.get(e.text) ?? 0) + 1);
  const out = [];
  for (const e of a) {
    const n = left.get(e.text) ?? 0;
    if (n > 0) left.set(e.text, n - 1);
    else out.push(e);
  }
  return out;
}

const HYDRATION_ERROR = /Minified React error #(418|423|425)|[Hh]ydrat/;

function printList(title, entries) {
  console.log("%s: %d", title, entries.length);
  for (const e of entries.slice(0, MAX)) console.log('  "%s"  %s', e.text.slice(0, 80), e.path);
  if (entries.length > MAX) console.log("  … +%d more (--max)", entries.length - MAX);
}

let failed = false;
let res;
let ssrHtml;
try {
  res = await fetch(url, { signal: AbortSignal.timeout(STEP_MS), redirect: "follow" });
  ssrHtml = await res.text();
} catch (e) {
  console.log("ERR fetch %s: %s", url, String(e.message ?? e));
  process.exit(1);
}
console.log("SSR %s %s (%d bytes)%s", res.status, url, ssrHtml.length, res.url !== url ? ` → ${res.url}` : "");

const browser = await browserType.launch();
try {
  for (const zone of zones) {
    const ctx = await browser.newContext({ timezoneId: zone });
    try {
      const page = await ctx.newPage();
      page.setDefaultTimeout(STEP_MS);
      page.setDefaultNavigationTimeout(STEP_MS);
      const errors = [];
      page.on("pageerror", (err) => errors.push(String(err.message ?? err)));
      page.on("console", (m) => {
        // React 19 reports recoverable errors (the mismatch) via reportError,
        // which arrives as a pageerror; a console.error naming hydration is
        // kept too, for builds that log instead.
        if (m.type() === "error" && HYDRATION_ERROR.test(m.text())) errors.push(`console: ${m.text()}`);
      });
      // The final URL of the fetch, so a slug redirect does not make the
      // browser load a different page from the HTML being compared.
      await page.goto(res.url, { waitUntil: "load" });
      await page.waitForTimeout(SETTLE_MS);
      const ssr = await page.evaluate(collectTexts, ssrHtml);
      const live = await page.evaluate(collectTexts, null);
      const onlySsr = minus(ssr, live);
      const onlyLive = minus(live, ssr);

      console.log("");
      console.log("=== timezone %s (%s) ===", zone, args.browser);
      console.log("page errors: %d", errors.length);
      for (const e of errors) console.log("  %s", e.slice(0, 300));
      printList("only in SSR HTML", onlySsr);
      printList("only in hydrated DOM", onlyLive);
      if (errors.some((e) => HYDRATION_ERROR.test(e))) failed = true;
    } finally {
      await ctx.close();
    }
  }
} finally {
  // Bounded: WebKit on Windows can hang in close() after a finished run.
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 10000))]);
}
clearTimeout(runTimer);
process.exit(failed ? 1 : 0);
