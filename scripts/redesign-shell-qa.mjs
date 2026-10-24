#!/usr/bin/env node
// Redesign shared-shell QA (header, menu, footer, focus, motion), plus
// generic page-layout invariants for the pages a ticket names.
//
// Ported from the ticket 06 QA run. Page tickets rerun it after any change
// to shared styles (globals.css, tokens.ts, the Nav/Footer components), so a
// page-level tweak that breaks the shell at some width or locale shows up
// before review rather than on the Preview.
//
// Checks:
//   layout   ja/ko/en × widths 320…1440 × home/events/artist 1/album 459/
//            privacy: header height per width band, no page horizontal
//            overflow, every header descendant inside the viewport, 4 nav
//            links (≥ nav breakpoint) vs the menu toggle (below it), <html
//            lang>, locale font order (ko: Noto Sans KR before JP; ja/en:
//            JP before KR), footer statement present
//   page     only with --path, per path × locale × width (see below):
//            overflow  no visible element in <main> extends past the
//                      viewport — each element's box clipped by its
//                      overflow-hidden/scroll ancestors inside <main>, so a row that
//                      pokes out shows even when the document scrollWidth
//                      does not (an ancestor's overflow-x: hidden masks it);
//                      visually hidden helpers (sr-only boxes, clipped
//                      boxes, 1px aria-live regions) are skipped
//            clamp     no visible h1–h6 in <main> is truncated: text-overflow
//                      ellipsis or -webkit-line-clamp on it or inside it, or
//                      its content wider than its box
//            art       every [data-testid=event-art] lies left of its card's
//                      first heading when the two share a row (the card is
//                      the art's nearest ancestor holding a heading; a row
//                      means they overlap vertically) — CSS grid
//                      auto-placement can push the art into the last column
//            year      every visible <time> in <main> whose datetime is a full
//                      date (YYYY-MM-DD…) shows a 4-digit year in its text,
//                      unless the text is a clock time alone ("18:00")
//            A page with no matching elements reports N/A, not PASS.
//   overflow fixture  hidden helpers injected into <main> are skipped by
//            the page overflow check while injected real offenders (a 1px
//            hairline, a child of a 1×1 overflow-visible box, a static box
//            with an inapplicable clip) are reported (positive control)
//   selector the banner-scoped menu-toggle selector finds exactly one toggle
//            on a page with in-page <header> toggles injected, one per
//            excluded context (positive control: the unscoped selector must
//            find the banner toggle plus every injected one)
//   keyboard skip link → page <main>; menu opens by keyboard, Tab enters its
//            links, Escape closes and returns focus to the toggle, outside
//            click closes, widening past the nav breakpoint clears it, a
//            route selection closes it; 3px #174FAF focus ring
//   locale   switching locale keeps the query string
//   motion   prefers-reduced-motion → no transitions/animations anywhere
//
// Usage (from the repo root, against a running production build — see
// scripts/serve-build.sh):
//   node scripts/redesign-shell-qa.mjs --base http://localhost:3110
//     [--out <dir>]                  default test-results/shell-qa/<browser>
//                                    (…/<browser>-quick with --quick) under
//                                    the root of the checkout holding the
//                                    cwd (gitignored); a rerun, --path runs
//                                    included, overwrites it, so pass --out
//                                    for evidence to keep
//     [--browser chromium|webkit]   default chromium
//     [--quick]                      layout matrix limited to ko × 390/1100/
//                                    1440 × home/events (a full WebKit run
//                                    takes over 25 minutes on Windows)
//     [--path <p>]...                repeatable; run the layout matrix on
//                                    these paths (e.g. --path events, no
//                                    leading slash in Git Bash, which
//                                    rewrites /events into a Windows path)
//                                    instead of the fixed pages, and add the
//                                    page checks above for each
//     [--timeout <s>]                per-check limit, default 30
//     [--run-timeout <min>]          whole-run limit, default 60
//     [--summary]                    print only FAIL lines (timeouts are
//                                    FAILs) and the final tally; PASS and
//                                    N/A lines go to the JSON alone. A --path
//                                    run otherwise prints dozens of N/A lines
//
// Timeouts. Navigations wait for `load`, then for what the check reads
// (fonts for geometry, React hydration before driving the menu) — never
// `networkidle`, which never settled in one WebKit run and hung it for 30
// minutes. Every Playwright action and navigation is capped at --timeout;
// each check is also raced against a multiple of it (one layout page 2×, a
// multi-step section 4×), so a check that hangs outside Playwright's own
// timeouts records "<name> (timeout)" as a FAIL, its contexts are closed and
// its late results dropped, and the run moves on. If the
// whole run exceeds --run-timeout, it records "run (timeout)", writes what it
// has, and exits 1.
//
// Prints the resolved output folder as its first line ("out: <abs path>"),
// creates it (with any missing parents) and writes <out>/<browser>-qa.json
// (every check with ok/na/detail), <out>/<browser>-qa.log (every line printed
// to stdout or stderr after the output folder exists, as it is printed — no need to
// redirect stdout into the evidence folder) and two screenshots (open menu at 390, desktop focus ring). Exits 1
// if any check FAILs.
//
// WebKit: Playwright's WebKit follows Safari's default, where plain Tab skips
// links (only form controls and buttons are tab stops). The keyboard checks
// therefore focus links directly in WebKit instead of tabbing to them, and
// press a key first so :focus-visible still matches as it would for a
// keyboard user who enabled "Press Tab to highlight each item".
import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format, parseArgs } from "node:util";
// @playwright/test is the declared dependency and re-exports the browser types.
import { chromium, webkit } from "@playwright/test";

// The checkout holding the current directory, so a copy extracted into
// another checkout (a redesign worktree's .claude/tmp/) writes its default
// output there; the script-relative root only outside a git work tree.
// Same rule as checkoutRoot() in scripts/page-qa/harness.mjs, inlined so
// this script stays a single file to extract.
function checkoutRoot() {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (top) return path.resolve(top);
  } catch {
    // not in a work tree, or git missing
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

// From here on every console line also lands in `file`, so a caller never
// redirects stdout into a folder that may not exist yet (a shell redirect
// into a missing directory fails before the script starts, losing the run).
// Called right after --out is created. Synchronous append, as in
// scripts/page-qa/harness.mjs: a hung or killed run still shows the last
// line it reached. An uncaught error's stack, which Node prints without
// going through console, is appended too. Same helper as in
// redesign-capture.mjs, which stays a single file to extract.
function teeConsoleTo(file) {
  fs.writeFileSync(file, "");
  for (const level of ["log", "warn", "error"]) {
    const print = console[level].bind(console);
    console[level] = (...a) => {
      print(...a);
      fs.appendFileSync(file, format(...a) + "\n");
    };
  }
  process.on("uncaughtExceptionMonitor", (e) => fs.appendFileSync(file, `${e?.stack ?? e}\n`));
}

const { values: args } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:3110" },
    out: { type: "string" },
    browser: { type: "string", default: "chromium" },
    quick: { type: "boolean", default: false },
    path: { type: "string", multiple: true, default: [] },
    timeout: { type: "string", default: "30" },
    "run-timeout": { type: "string", default: "60" },
    summary: { type: "boolean", default: false },
  },
});

const BASE = args.base.replace(/\/+$/, "");
const BROWSERS = { chromium, webkit };
const browserType = BROWSERS[args.browser];
if (!browserType) {
  console.error(`--browser must be one of: ${Object.keys(BROWSERS).join(", ")}`);
  process.exit(1);
}
const CHECK_MS = Number(args.timeout) * 1000;
// A single-page check gets twice the navigation timeout, so a page that loads
// just under it still has time for fonts and the in-page measurements.
const SECTION_MS = CHECK_MS * 2;
const RUN_MS = Number(args["run-timeout"]) * 60_000;
// setTimeout fires at once above 2^31 ms (~24.8 days); a day is plenty.
if (!(CHECK_MS > 0) || !(RUN_MS > 0) || CHECK_MS > 86_400_000 || RUN_MS > 86_400_000) {
  console.error("--timeout and --run-timeout must be positive numbers, at most one day");
  process.exit(1);
}
const WEBKIT = args.browser === "webkit";
// A run started without --out still writes its log and JSON somewhere
// predictable instead of failing on a usage error. The default sits under
// the checkout root, where /test-results/ is gitignored — not under the cwd,
// which may be scripts/ or an extracted copy's folder, where nothing ignores
// it. It is split by browser and --quick, so a chromium full run and a
// webkit --quick run kept side by side do not overwrite each other's files;
// a --path run shares its browser's folder with the fixed-page run. An
// explicit --out still resolves against the cwd.
const outDir =
  args.out !== undefined
    ? path.resolve(args.out)
    : path.join(checkoutRoot(), "test-results", "shell-qa", `${args.browser}${args.quick ? "-quick" : ""}`);
fs.mkdirSync(outDir, { recursive: true });
teeConsoleTo(path.join(outDir, `${args.browser}-qa.log`));
console.log(`out: ${outDir}`);

// ---------------------------------------------------------------------------
// Shell geometry. Mirrors src/styles/tokens.ts — `layout.navHeight`
// ({ mobile: 64, tablet: 68, desktop: 80 }) and `breakpoint.nav` (1100); the
// tablet band starts at 700 per the comment on `layout`. These are the
// redesigned shell's tokens, which live on feature/redesign until the
// redesign merges; run this against a build of that branch (or a page
// ticket cut from it). A plain .mjs cannot import the .ts module, so when a
// token changes, change it here too.
// ---------------------------------------------------------------------------
const NAV_HEIGHT = { mobile: 64, tablet: 68, desktop: 80 };
const NAV_TABLET_MIN = 700;
const NAV_BREAKPOINT = 1100;
const DESKTOP_NAV_LINKS = 4;
// Focus ring: 3px solid #174FAF (rgb 23, 79, 175), offset 4px.
const FOCUS_RING = /solid 3px rgb\(23, 79, 175\) 4px/;

// The site banner: the <header> that is not a sectioning element's own
// header. Page content may use <header> inside a <section>/<article> (a
// collapsible group card's title row) with its own aria-controls toggle —
// valid HTML, and a bare `header button[aria-controls]` then matches every
// one of them, which a strict-mode locator rejects. Scoping by what the
// banner is NOT inside works on any shell (the site header sits outside
// <main> on dev and on feature/redesign alike) without the app having to
// carry a test hook.
const BANNER = "header:not(main header, article header, section header, aside header, nav header)";
const TOGGLE = `${BANNER} button[aria-controls]`;

const expectedHeaderHeight = (w) =>
  w >= NAV_BREAKPOINT ? NAV_HEIGHT.desktop : w >= NAV_TABLET_MIN ? NAV_HEIGHT.tablet : NAV_HEIGHT.mobile;

// --path p: "/events", "events/", "/" all normalise to the "" / "/events"
// form the fixed list uses (appended to /<locale>). Git Bash rewrites a bare
// "/events" argument into "C:/Program Files/Git/events" before node sees it,
// so a drive-letter value is refused with the two spellings that survive.
const PATHS = args.path.map((p) => {
  if (/^[A-Za-z]:[\\/]/.test(p)) {
    console.error(`--path ${p}: looks like a path Git Bash rewrote; pass "--path events" or set MSYS_NO_PATHCONV=1`);
    process.exit(1);
  }
  const t = p.trim().replace(/^\/*/, "/").replace(/\/+$/, "");
  return t === "/" ? "" : t;
});

// Widths straddle every band edge: 699/700 is covered by 430→768, and
// 1099/1100 explicitly, since the nav switch is where overflow shows first.
const LOCALES = args.quick ? ["ko"] : ["ja", "ko", "en"];
const WIDTHS = args.quick ? [390, 1100, 1440] : [320, 375, 390, 430, 768, 1024, 1099, 1100, 1440];
const PAGES = PATHS.length
  ? PATHS
  : args.quick
    ? ["", "/events"]
    : ["", "/events", "/artists/1/hasunosora", "/albums/459/s-memorial-cd-box-complete-best-box", "/privacy"];

const results = [];
// The section a check() call runs in (see section()). A timed-out section's
// body is not cancellable and may still settle later; its late results are
// dropped so they do not land among the next section's.
const sectionScope = new AsyncLocalStorage();
const late = () => sectionScope.getStore()?.abandoned === true;
function check(name, ok, detail = "") {
  if (late()) return;
  results.push({ name, ok: !!ok, detail });
  if (ok && args.summary) return;
  console.log("%s %s%s", ok ? "PASS" : "FAIL", name, detail ? ` — ${detail}` : "");
}
// A check whose subject is absent from the page (no event art, no <time>).
// Counted as not failing, but kept apart from PASS so a page that renders
// nothing is not mistaken for one that renders correctly.
function notApplicable(name, detail) {
  if (late()) return;
  results.push({ name, ok: true, na: true, detail });
  if (!args.summary) console.log("N/A  %s — %s", name, detail);
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

// One section throwing (a selector that no longer exists, a timeout) is a
// FAIL for that section, not the end of the run. On a timeout the section is
// abandoned: its later check() calls are dropped and the contexts it opened
// are closed, which also makes its hung Playwright calls throw and stop.
// Returns false then, so a caller that lent the section a page replaces it.
async function section(name, fn, ms = SECTION_MS) {
  const scope = { abandoned: false, contexts: new Set() };
  try {
    await withTimeout(sectionScope.run(scope, fn), ms);
  } catch (e) {
    const timedOut = e instanceof CheckTimeout;
    check(`${name} (${timedOut ? "timeout" : "threw"})`, false, String(e.message ?? e).split("\n")[0].slice(0, 300));
    if (timedOut) {
      scope.abandoned = true;
      for (const ctx of scope.contexts) await withTimeout(ctx.close(), 5000).catch(() => {});
      return false;
    }
  }
  return true;
}

// Navigate and wait for what the geometry checks read: the `load` event (the
// stylesheets), the page's <main> with content in it, and web fonts, whose
// swap changes text widths. Every page here renders its content on the
// server, so <main> is complete at `load`; content a page fetched on the
// client afterwards would not be waited for, and its checks would show N/A.
async function open(page, url) {
  const resp = await page.goto(url, { waitUntil: "load" });
  // Error pages may have no <main>; their status is reported by the caller.
  if (resp?.ok()) await page.locator("main > *").first().waitFor({ state: "attached" });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return resp;
}
// Interaction checks also need React to have hydrated the shell, or a key
// press on the toggle lands on inert server HTML. React tags every hydrated
// host node with a `__reactFiber$…` property; wait for it on the banner.
async function openHydrated(page, url) {
  const resp = await open(page, url);
  await page.waitForFunction(
    (sel) => {
      const h = document.querySelector(sel);
      return !!h && Object.keys(h).some((k) => k.startsWith("__reactFiber$"));
    },
    BANNER,
  );
  return resp;
}
async function newContext(opts) {
  const ctx = await browser.newContext(opts);
  sectionScope.getStore()?.contexts.add(ctx);
  ctx.setDefaultTimeout(CHECK_MS);
  ctx.setDefaultNavigationTimeout(CHECK_MS);
  return ctx;
}

// Outline of the focused element plus a short label of what has focus, so a
// FAIL says which element the ring was read from.
const readFocusRing = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    const s = getComputedStyle(a);
    return {
      ring: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor} ${s.outlineOffset}`,
      el: `${a.tagName.toLowerCase()} "${(a.textContent ?? "").trim().slice(0, 30)}"`,
    };
  });

// Results first: Playwright's WebKit on Windows can hang in browser.close()
// (see redesign-capture.mjs), so the close is bounded and process.exit ends
// the run either way. The whole-run guard skips the close: the main flow is
// still running, and closing the browser under it would throw out of a
// top-level await and end the process before the summary prints.
// Playwright kills the browsers it launched when the process exits.
let finishing = false;
async function finish({ closeBrowser = true } = {}) {
  if (finishing) return;
  finishing = true;
  const file = path.join(outDir, `${args.browser}-qa.json`);
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
  if (closeBrowser) await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 10000))]);
  const fails = results.filter((r) => !r.ok);
  const na = results.filter((r) => r.na).length;
  console.log("");
  console.log(
    "%d/%d passed%s → %s",
    results.length - fails.length - na,
    results.length,
    na ? `, ${na} n/a` : "",
    file,
  );
  // --summary already printed each FAIL as it happened.
  if (!args.summary) for (const f of fails) console.log("FAIL %s — %s", f.name, f.detail);
  process.exit(fails.length ? 1 : 0);
}

const browser = await browserType.launch();
setTimeout(() => {
  check("run (timeout)", false, `whole run exceeded ${args["run-timeout"]} min; results so far kept`);
  finish({ closeBrowser: false });
}, RUN_MS);

// ---------------------------------------------------------------------------
// Page invariants (--path only). Runs in the page; returns one entry per
// check: { applicable, problems[], detail }.
// ---------------------------------------------------------------------------
function pageInvariants() {
  const main = document.querySelector("main");
  if (!main) return { missingMain: true };
  const vw = window.innerWidth;
  // A bare `div` names nothing, so an element with neither class nor text
  // falls back to its id and role (dnd-kit's live region is an id'd
  // `div[role=status]` with no class and, between announcements, no text).
  const label = (el) => {
    const tag = el.tagName.toLowerCase();
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "";
    const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
    if (cls || text) return `${tag}${cls ? "." + cls : ""}${text ? ` "${text}"` : ""}`;
    const role = el.getAttribute("role");
    return `${tag}${el.id ? "#" + el.id : ""}${role ? `[role=${role}]` : ""}`;
  };
  const visible = (el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.visibility !== "hidden" && s.display !== "none" && r.width > 0 && r.height > 0;
  };
  const HEADINGS = "h1, h2, h3, h4, h5, h6";

  // overflow — the element's box, clipped by every ancestor that clips
  // horizontally (overflow-x other than visible), must stay in [0, vw]. A
  // clipped or scrolled part is not on screen, so a carousel or a
  // decorative bleed inside an in-viewport wrapper is fine; a row whose
  // visible box ends past the viewport edge is not. Only the outermost
  // offender of a subtree is reported.
  //
  // Visually hidden helpers are skipped: they sit off-box on purpose and
  // nobody sees them. dnd-kit's DndLiveRegion (position fixed, 1×1px,
  // margin -1px, so its left edge is at -1) was reported as overflow on
  // every width of a page with a prediction editor. Skipped are a box of at
  // most 1px in both directions (the sr-only pattern), a positioned box
  // clipped away by `clip: rect(0 0 0 0)`-style or `clip-path: inset(≥50%)`,
  // and an aria-live region at most 1px in either direction. A box that is
  // 1px in one direction only is still checked: a hairline divider that
  // runs past the viewport edge is a real, visible overflow.
  //
  // Returns why a box is hidden — "clip" (nothing of it or its subtree
  // paints) or "box" (the box itself is too small to see) — or null.
  const srHidden = (el, r) => {
    const s = getComputedStyle(el);
    // `clip` applies only to absolutely/fixed positioned boxes; on any other
    // box the computed value still echoes what was specified, so check the
    // position too. A rect whose two edges meet shows nothing.
    const clip = /^rect\(\s*([-\d.]+)px,?\s*([-\d.]+)px,?\s*([-\d.]+)px,?\s*([-\d.]+)px\s*\)$/.exec(s.clip ?? "");
    if (clip && (s.position === "absolute" || s.position === "fixed")) {
      const [top, right, bottom, left] = clip.slice(1).map(Number);
      if (right <= left || bottom <= top) return "clip";
    }
    // inset(top right bottom left) with the shorthand's 1–4 values; only
    // percentages are read (a px inset depends on the box size, and
    // sr-only utilities use inset(50%)). Nothing shows once the two insets
    // of one axis add up to the whole box.
    const inset = /^inset\(([^)]*)\)/.exec(s.clipPath ?? "");
    if (inset) {
      const v = inset[1].split(/\s+round\s+/)[0].trim().split(/\s+/);
      const pct = (x) => (/^[\d.]+%$/.test(x ?? "") ? Number(x.slice(0, -1)) : 0);
      const [t, rt = t, b = t, l = rt] = v.map(pct);
      if (t + b >= 100 || l + rt >= 100) return "clip";
    }
    if (r.width <= 1 && r.height <= 1) return "box";
    if (el.hasAttribute("aria-live") && (r.width <= 1 || r.height <= 1)) return "box";
    return null;
  };
  // A hidden helper's subtree is skipped with it only when the helper clips
  // it: by clip/clip-path, or by its own overflow (sr-only sets
  // overflow: hidden, which would otherwise clip its children to the same
  // 1px box at -1px and report them). A 1×1 wrapper with overflow visible
  // hides nothing — its children are checked like any other box.
  const hidden = [];
  const overflow = [];
  for (const el of main.querySelectorAll("*")) {
    if (overflow.some((o) => o.contains(el))) continue;
    if (hidden.some((h) => h.contains(el))) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const why = srHidden(el, r);
    if (why) {
      const s = getComputedStyle(el);
      if (why === "clip" || s.overflowX !== "visible" || s.overflowY !== "visible") hidden.push(el);
      continue;
    }
    let left = r.left;
    let right = r.right;
    // Clippers between the element and <main> only: <main> or anything
    // above it (body, a layout wrapper) with overflow-x hidden would cut
    // the row off at the viewport edge — the very case to report.
    for (let a = el.parentElement; a && a !== main; a = a.parentElement) {
      if (getComputedStyle(a).overflowX !== "visible") {
        const ar = a.getBoundingClientRect();
        left = Math.max(left, ar.left);
        right = Math.min(right, ar.right);
      }
    }
    if (right <= left) continue;
    if (getComputedStyle(el).visibility === "hidden") continue;
    if (right > vw + 0.5 || left < -0.5) overflow.push(el);
  }

  // clamp
  const headings = [...main.querySelectorAll(HEADINGS)].filter(
    // Visually-hidden headings (sr-only: 1px box, overflow hidden) are
    // clipped on purpose.
    (h) => visible(h) && h.getBoundingClientRect().width > 2,
  );
  // A heading styled to truncate counts even when its text happens to fit
  // at this width: a longer name (or another locale) will be cut. `cut`
  // counts the ones whose text is cut right now, horizontally (ellipsis,
  // nowrap) or vertically (line clamp).
  const withDescendants = (h) => [h, ...h.querySelectorAll("*")];
  const horizontallyCut = (el) => {
    // CJK punctuation may hang visibly outside the text box. It is cut
    // only at a clipping boundary; viewport overflow is checked separately.
    // Include <main> and layout wrappers in the ancestor clip intersection.
    const r = el.getBoundingClientRect();
    let clipLeft = -Infinity;
    let clipRight = Infinity;
    let visibleLeft = -Infinity;
    let visibleRight = Infinity;
    let reachableByScroll = false;
    for (let a = el.parentElement; a; a = a.parentElement) {
      const s = getComputedStyle(a);
      // Overflow does not clip a non-replaced inline's text box.
      if (s.overflowX === "visible" || (s.display === "inline" && !a.clientWidth)) continue;
      const left = a.getBoundingClientRect().left + a.clientLeft;
      visibleLeft = Math.max(visibleLeft, left);
      visibleRight = Math.min(visibleRight, left + a.clientWidth);
      // A partially visible card in a scrollable rail can be revealed.
      // Clipping inside its content remains a defect; the rail viewport
      // and its outer wrappers must not count as title truncation.
      if (/^(auto|scroll)$/.test(s.overflowX) && a.scrollWidth > a.clientWidth + 1) reachableByScroll = true;
      if (!reachableByScroll) {
        clipLeft = Math.max(clipLeft, left);
        clipRight = Math.min(clipRight, left + a.clientWidth);
      }
    }
    // A fully off-canvas/scroll-hidden heading does not paint. Its own
    // overflow must not turn a closed drawer into a truncation failure.
    if (Math.min(r.right, visibleRight) <= Math.max(r.left, visibleLeft)) return false;
    const clipsSelf = el.clientWidth > 0 && getComputedStyle(el).overflowX !== "visible";
    if (clipsSelf && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) return true;
    if (clipsSelf) {
      clipLeft = Math.max(clipLeft, r.left + el.clientLeft);
      clipRight = Math.min(clipRight, r.left + el.clientLeft + el.clientWidth);
    }
    // Text can fit its own 200px heading yet be cut by a 100px parent.
    // Conversely, that oversized heading's empty box is not lost text.
    // Measure each direct text node's line fragments; withDescendants
    // handles nested inline nodes without comparing their empty box area.
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const text of range.getClientRects()) {
        if (text.width > 0 && (text.left < clipLeft - 1 || text.right > clipRight + 1)) return true;
      }
    }
    return false;
  };
  const isCut = (h) =>
    withDescendants(h).some(
      (el) =>
        horizontallyCut(el) ||
        (el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY !== "visible"),
    );
  const clamped = headings.filter(
    (h) =>
      isCut(h) ||
      withDescendants(h).some((el) => {
        const s = getComputedStyle(el);
        const lc = s.webkitLineClamp ?? s.getPropertyValue("-webkit-line-clamp");
        return (s.textOverflow === "ellipsis" && s.overflowX !== "visible") || (lc && lc !== "none");
      }),
  );

  // art
  // The card is the nearest ancestor (below <main>) that holds a heading,
  // so art in its own link next to a title link still pairs with the title.
  let artInRow = 0;
  let artStacked = 0;
  let artUnpaired = 0;
  const artWrong = [];
  for (const art of main.querySelectorAll('[data-testid="event-art"]')) {
    if (!visible(art)) continue;
    let h = null;
    for (let a = art.parentElement; a && a !== main && !h; a = a.parentElement) h = a.querySelector(HEADINGS);
    if (!h || !visible(h)) {
      artUnpaired++;
      continue;
    }
    const ar = art.getBoundingClientRect();
    const hr = h.getBoundingClientRect();
    if (ar.top < hr.bottom && hr.top < ar.bottom) {
      artInRow++;
      if (ar.right > hr.left + 1) artWrong.push(h);
    } else artStacked++;
  }

  // year
  // Visible ones only (a responsive pair hides one form per width), and not
  // those showing only a clock time ("18:00") for a full datetime.
  const times = [...main.querySelectorAll("time[datetime]")].filter(
    (t) =>
      visible(t) &&
      /^\d{4}-\d{2}-\d{2}/.test(t.getAttribute("datetime")) &&
      !/^\s*\d{1,2}:\d{2}(:\d{2})?\s*$/.test(t.textContent ?? ""),
  );
  const noYear = times.filter((t) => !/\d{4}/.test(t.textContent ?? ""));

  const list = (els) => els.slice(0, 3).map(label).join(", ") + (els.length > 3 ? ` +${els.length - 3}` : "");
  return {
    overflow: {
      applicable: true,
      problems: overflow.length ? [`${overflow.length} past viewport: ${list(overflow)}`] : [],
    },
    clamp: {
      applicable: headings.length > 0,
      problems: clamped.length
        ? [`${clamped.length}/${headings.length} clamped (${clamped.filter(isCut).length} cut now): ${list(clamped)}`]
        : [],
      detail: `${headings.length} headings`,
    },
    art: {
      applicable: artInRow > 0,
      problems: artWrong.length ? [`${artWrong.length}/${artInRow} art right of heading: ${list(artWrong)}`] : [],
      detail: `${artInRow} art beside a heading, ${artStacked} stacked, ${artUnpaired} without a heading`,
    },
    year: {
      applicable: times.length > 0,
      problems: noYear.length ? [`${noYear.length}/${times.length} without year: ${list(noYear)}`] : [],
      detail: `${times.length} full-date <time>`,
    },
  };
}

// ---------------------------------------------------------------------------
// Layout matrix — one context per locale × width, reused across pages.
// ---------------------------------------------------------------------------
for (const locale of LOCALES) {
  for (const w of WIDTHS) {
    // Context setup sits outside any section; a throw or hang here would
    // otherwise end the run without the summary.
    let ctx;
    let page;
    try {
      ctx = await withTimeout(newContext({ viewport: { width: w, height: 900 } }), CHECK_MS);
      page = await withTimeout(ctx.newPage(), CHECK_MS);
    } catch (e) {
      check(`layout ${locale}@${w} (setup)`, false, String(e.message ?? e).split("\n")[0].slice(0, 300));
      if (ctx) await withTimeout(ctx.close(), 5000).catch(() => {});
      continue;
    }
    for (const p of PAGES) {
      const key = `${locale}${p || "/"}@${w}`;
      const finished = await section(`layout ${key}`, async () => {
        // An error page still renders the shell and would pass every check
        // below, so a non-200 (e.g. a record gone from the dev DB) is a FAIL.
        const resp = await open(page, `${BASE}/${locale}${p}`);
        const m = await page.evaluate(
          ([bannerSel, toggleSel]) => {
            const header = document.querySelector(bannerSel);
            if (!header) return null;
            const r = header.getBoundingClientRect();
            const navLinks = [...header.querySelectorAll("nav a")].filter((a) => a.offsetParent);
            const toggle = document.querySelector(toggleSel);
            // Any visible header descendant poking past either viewport edge
            // means the header row overflows at this width.
            let headerOverflow = false;
            header.querySelectorAll("*").forEach((el) => {
              const b = el.getBoundingClientRect();
              if (b.width && (b.right > window.innerWidth + 0.5 || b.left < -0.5)) headerOverflow = true;
            });
            return {
              h: Math.round(r.height),
              scrollW: document.documentElement.scrollWidth,
              innerW: window.innerWidth,
              links: navLinks.length,
              toggle: !!toggle && toggle.offsetParent !== null,
              lang: document.documentElement.lang,
              font: getComputedStyle(document.body).fontFamily,
              headerOverflow,
              footer: !!document.querySelector("footer p")?.textContent?.trim(),
            };
          },
          [BANNER, TOGGLE],
        );
        if (!m) {
          check(`layout ${key}`, false, `HTTP ${resp?.status()}; no site <header>`);
          return;
        }
        const desktop = w >= NAV_BREAKPOINT;
        const fontOk =
          locale === "ko"
            ? /Noto Sans KR(?: Variable)?.*Noto Sans JP/.test(m.font)
            : /Noto Sans JP.*Noto Sans KR/.test(m.font);
        const problems = [
          resp?.status() !== 200 && `HTTP ${resp?.status()}`,
          m.h !== expectedHeaderHeight(w) && `header ${m.h}px, want ${expectedHeaderHeight(w)}`,
          m.scrollW > m.innerW && `page overflow ${m.scrollW}>${m.innerW}`,
          m.headerOverflow && "header child outside viewport",
          m.lang !== locale && `lang=${m.lang}`,
          desktop && (m.links !== DESKTOP_NAV_LINKS || m.toggle) && `desktop nav: ${m.links} links, toggle ${m.toggle}`,
          !desktop && (m.links !== 0 || !m.toggle) && `menu nav: ${m.links} links, toggle ${m.toggle}`,
          !fontOk && `font order: ${m.font.slice(0, 80)}`,
          !m.footer && "footer statement missing",
        ].filter(Boolean);
        check(`layout ${key}`, problems.length === 0, problems.join("; "));

        if (!PATHS.length) return;
        const inv = await page.evaluate(pageInvariants);
        if (inv.missingMain) {
          check(`page ${key}`, false, "no <main>");
          return;
        }
        for (const [name, r] of Object.entries(inv)) {
          const label = `page ${key} ${name}`;
          if (!r.applicable) notApplicable(label, `nothing to check (${r.detail})`);
          else check(label, r.problems.length === 0, r.problems.join("; ") || r.detail || "");
        }
      });
      if (!finished) {
        // The hung check may still hold the page; continue on a fresh one.
        await withTimeout(page.close(), 5000).catch(() => {});
        page = await withTimeout(ctx.newPage(), CHECK_MS).catch(() => null);
        if (!page) {
          check(`layout ${locale}@${w} (setup)`, false, "no new page after a timeout; rest of this width skipped");
          break;
        }
      }
    }
    await withTimeout(ctx.close(), 10000).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Toggle selector fixture: in-page <header> toggles must not reach the
// banner-scoped selector — one per arm of BANNER's :not() list (a bare
// header in <main>; a section/article/aside/nav header outside <main>). The
// unscoped selector is the positive control: it must find the banner toggle
// plus every injected one, or the fixture did not take and the scoped count
// proves nothing.
// ---------------------------------------------------------------------------
await section("toggle selector fixture", async () => {
  const ctx = await newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await ctx.newPage();
    // Hydration can replace these injected siblings. Wait for the shell
    // before setting up the selector's positive control, as the keyboard
    // section below already does before interacting with the menu.
    await openHydrated(page, `${BASE}/ja/events`);
    const injected = await page.evaluate(() => {
      const toggle = (i) =>
        `<header><h2>fixture ${i}</h2><button aria-controls="qa-fixture-${i}">toggle</button></header>` +
        `<div id="qa-fixture-${i}"></div>`;
      const main = document.querySelector("main");
      main.insertAdjacentHTML("afterbegin", toggle(0));
      const outside = ["section", "article", "aside", "nav"];
      main.insertAdjacentHTML(
        "afterend",
        outside.map((tag, i) => `<${tag}>${toggle(i + 1)}</${tag}>`).join(""),
      );
      return 1 + outside.length;
    });
    const unscoped = await page.locator("header button[aria-controls]").count();
    const scoped = page.locator(TOGGLE);
    const scopedCount = await scoped.count();
    const scopedIsFixture =
      scopedCount === 1 && (await scoped.evaluate((b) => b.getAttribute("aria-controls").startsWith("qa-fixture-")));
    check(
      "banner toggle selector ignores in-page <header> toggles",
      unscoped === injected + 1 && scopedCount === 1 && !scopedIsFixture,
      `${injected} injected; unscoped matches ${unscoped}, scoped matches ${scopedCount}${scopedIsFixture ? " (a fixture toggle)" : ""}`,
    );
  } finally {
    await ctx.close();
  }
});

// ---------------------------------------------------------------------------
// Overflow fixture: the page overflow check must skip visually hidden
// helpers and still report real offenders. Injected into <main> at 390:
// hidden ones (a dnd-kit-style fixed 1×1 live region at -1px, an sr-only
// clip-rect box with a 900px child, a clip-path: inset(50%) box hanging off
// the left edge) and real ones (a 1px-tall hairline 2000px wide, a 2000px
// child of a 1×1 overflow-visible wrapper, a static box whose `clip` does
// not apply). The real ones are the positive control: unless exactly those
// three are reported, the skip proves nothing. The page must not overflow
// before the injection, or its own offenders would crowd the list.
// ---------------------------------------------------------------------------
await section("overflow fixture", async () => {
  const ctx = await newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await ctx.newPage();
    await open(page, `${BASE}/ja/events`);
    const before = (await page.evaluate(pageInvariants)).overflow.problems;
    await page.evaluate(() => {
      const hidden =
        '<div id="qa-ov-live" role="status" aria-live="assertive" style="position:fixed;left:0;top:0;width:1px;height:1px;margin:-1px;overflow:hidden;white-space:nowrap"></div>' +
        '<span id="qa-ov-sronly" style="position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0,0,0,0)"><b style="display:inline-block;width:900px">sr</b></span>' +
        '<div id="qa-ov-clippath" style="position:relative;left:-50px;width:600px;height:20px;clip-path:inset(50%)">x</div>';
      const real =
        '<hr id="qa-ov-hairline" style="width:2000px;height:1px;border:0;margin:0;background:#000">' +
        '<div style="width:1px;height:1px"><div id="qa-ov-child" style="width:2000px;height:20px"></div></div>' +
        '<div id="qa-ov-static" style="width:2000px;height:20px;clip:rect(0,0,0,0)"></div>';
      document.querySelector("main").insertAdjacentHTML("beforeend", hidden + real);
    });
    const after = (await page.evaluate(pageInvariants)).overflow.problems.join("; ");
    const want = ["hr#qa-ov-hairline", "div#qa-ov-child", "div#qa-ov-static"];
    check(
      "overflow check skips hidden helpers, reports real offenders",
      // Exactly three reported and all three named: a leaked hidden helper
      // would make it four (or push a real one out of the 3-name list).
      before.length === 0 && after.startsWith("3 past viewport:") && want.every((w) => after.includes(w)),
      before.length ? `page overflows before injection: ${before.join("; ")}` : after || "nothing reported",
    );
  } finally {
    await ctx.close();
  }
});

// ---------------------------------------------------------------------------
// Skip link + menu keyboard behaviour at 390.
// ---------------------------------------------------------------------------
await section(
  "menu keyboard",
  async () => {
    const ctx = await newContext({ viewport: { width: 390, height: 844 } });
    try {
      const page = await ctx.newPage();
      await openHydrated(page, `${BASE}/ja/events`);

      if (WEBKIT) {
        await page.keyboard.press("Shift");
        await page.locator(".skip-link").focus();
      } else {
        await page.keyboard.press("Tab");
      }
      const skipVisible = await page.evaluate(() => {
        const a = document.activeElement;
        return !!a?.classList.contains("skip-link") && a.getBoundingClientRect().top >= 0;
      });
      check(
        WEBKIT ? "skip link visible on keyboard focus" : "skip link is first tab stop and becomes visible",
        skipVisible,
      );
      await page.keyboard.press("Enter");
      const focused = await page.evaluate(
        () => `${document.activeElement?.tagName}#${document.activeElement?.id ?? ""}`,
      );
      check("skip link moves focus to page <main>", /^MAIN#|#main-content$/.test(focused), focused);

      const toggle = page.locator(TOGGLE);
      const expanded = () => toggle.getAttribute("aria-expanded");
      await toggle.focus();
      await page.keyboard.press("Enter");
      check("menu opens via keyboard", (await expanded()) === "true");
      await page.screenshot({ path: path.join(outDir, `${args.browser}-ja-390-menu.png`) });
      const toggleRing = await readFocusRing(page);
      check("focus ring on toggle is 3px #174FAF offset 4px", FOCUS_RING.test(toggleRing.ring), toggleRing.ring);

      const menuId = await toggle.getAttribute("aria-controls");
      // Attribute selector, not #id: React's useId ids contain colons.
      const menuLinks = page.locator(`[id="${menuId}"] a`);
      if (WEBKIT) await menuLinks.first().focus();
      else await page.keyboard.press("Tab");
      const inMenu = await page.evaluate(
        (id) => document.activeElement?.tagName === "A" && !!document.activeElement.closest(`[id="${id}"]`),
        menuId,
      );
      check(WEBKIT ? "menu links are focusable" : "Tab from toggle enters menu links", inMenu);

      await page.keyboard.press("Escape");
      const back = await toggle.evaluate((t) => t === document.activeElement);
      check("Escape closes menu and returns focus to toggle", back && (await expanded()) === "false");

      // Each "closes" check below first confirms the click opened the menu;
      // otherwise a toggle that stopped opening would pass them all.
      await toggle.click();
      const openedForOutside = (await expanded()) === "true";
      await page.mouse.click(200, 800);
      check(
        "outside click closes menu",
        openedForOutside && (await expanded()) === "false",
        `opened: ${openedForOutside}`,
      );

      await toggle.click();
      const openedForResize = (await expanded()) === "true";
      await page.setViewportSize({ width: NAV_BREAKPOINT + 100, height: 844 });
      await page.waitForTimeout(200);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(200);
      check(
        `widening past ${NAV_BREAKPOINT}px clears the open menu`,
        openedForResize && (await expanded()) === "false",
        `opened: ${openedForResize}`,
      );

      await toggle.click();
      const openedForRoute = (await expanded()) === "true";
      await menuLinks.and(page.locator('[href$="/artists"]')).click();
      await page.waitForURL(/\/ja\/artists$/, { waitUntil: "load" });
      check(
        "route selection closes menu",
        openedForRoute && (await expanded()) === "false",
        `opened: ${openedForRoute}`,
      );
    } finally {
      await ctx.close();
    }
  },
  CHECK_MS * 4,
);

// ---------------------------------------------------------------------------
// Locale switch keeps the query; desktop keyboard focus shows the ring.
// ---------------------------------------------------------------------------
await section(
  "locale switch",
  async () => {
    const ctx = await newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await ctx.newPage();
      await openHydrated(page, `${BASE}/ko/events?filter=upcoming`);
      await page.getByRole("button", { name: "English" }).first().click();
      await page.waitForURL(/\/en\/events/, { waitUntil: "load" });
      check("locale switch keeps query", new URL(page.url()).search === "?filter=upcoming", page.url());

      // Fresh load, so Tab starts from the top of the document rather than
      // from wherever the client-side locale navigation left focus.
      await openHydrated(page, `${BASE}/en/events`);
      // Chromium: Tab, Tab = skip link, then the logo link. WebKit skips
      // links on Tab, so one Tab lands on the first header button instead.
      // A programmatic focus() on a link would not do here: with no key
      // pressed after it, :focus-visible does not match and the ring is
      // legitimately absent. The full ring (style, width, colour, offset) is
      // compared, since an outline-width alone also reads 3px under
      // `outline: none`.
      await page.keyboard.press("Tab");
      if (!WEBKIT) await page.keyboard.press("Tab");
      const { ring, el } = await readFocusRing(page);
      check(
        "desktop keyboard focus shows 3px #174FAF ring",
        !!el && !el.startsWith("body") && FOCUS_RING.test(ring),
        `${el}: ${ring}`,
      );
      await page.screenshot({ path: path.join(outDir, `${args.browser}-en-1440-focus.png`) });
    } finally {
      await ctx.close();
    }
  },
  CHECK_MS * 4,
);

// ---------------------------------------------------------------------------
// Reduced motion: nothing on the page transitions or animates. The same
// page without the preference is the positive control: it must show some
// motion, or a blank or error page would pass the reduced run vacuously.
// ---------------------------------------------------------------------------
async function countAnimated(reducedMotion) {
  const ctx = await newContext({ viewport: { width: 1440, height: 900 }, reducedMotion });
  try {
    const page = await ctx.newPage();
    const resp = await open(page, `${BASE}/ko`);
    const animated = await page.evaluate(
      () =>
        [...document.querySelectorAll("*")].filter((e) => {
          const s = getComputedStyle(e);
          return s.transitionDuration.split(",").some((d) => parseFloat(d) > 0) || s.animationName !== "none";
        }).length,
    );
    return { status: resp?.status(), animated };
  } finally {
    await ctx.close();
  }
}
await section(
  "reduced motion",
  async () => {
    const normal = await countAnimated("no-preference");
    const reduced = await countAnimated("reduce");
    check(
      "reduced motion removes transitions/animations",
      normal.status === 200 && reduced.status === 200 && normal.animated > 0 && reduced.animated === 0,
      `animated elements: ${normal.animated} normally → ${reduced.animated} reduced (HTTP ${reduced.status})`,
    );
  },
  CHECK_MS * 4,
);

await finish();
