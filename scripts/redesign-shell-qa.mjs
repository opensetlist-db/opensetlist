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
//                      does not (an ancestor's overflow-x: hidden masks it)
//            clamp     no visible h1–h6 in <main> is truncated: text-overflow
//                      ellipsis or -webkit-line-clamp on it or inside it, or
//                      its content wider than its box
//            art       every [data-testid=event-art] lies left of its card's
//                      first heading when the two share a row (same link /
//                      li / article, overlapping vertically) — CSS grid
//                      auto-placement can push the art into the last column
//            year      every <time> in <main> whose datetime is a full date
//                      (YYYY-MM-DD…) shows a 4-digit year in its text
//            A page with no matching elements reports N/A, not PASS.
//   selector the banner-scoped menu-toggle selector finds exactly one toggle
//            on a page with in-page <header> toggles injected (positive
//            control: the unscoped selector must find more than one there)
//   keyboard skip link → page <main>; menu opens by keyboard, Tab enters its
//            links, Escape closes and returns focus to the toggle, outside
//            click closes, widening past the nav breakpoint clears it, a
//            route selection closes it; 3px #174FAF focus ring
//   locale   switching locale keeps the query string
//   motion   prefers-reduced-motion → no transitions/animations anywhere
//
// Usage (from the repo root, against a running production build — see
// scripts/serve-build.sh):
//   node scripts/redesign-shell-qa.mjs --base http://localhost:3110 --out <dir>
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
//
// Timeouts. Navigations wait for `load`, then for what the check reads
// (fonts for geometry, React hydration before driving the menu) — never
// `networkidle`, which never settled in one WebKit run and hung it for 30
// minutes. Every Playwright action and navigation is capped at --timeout;
// each check (one layout page, or one multi-step section, which gets 3×) is
// also raced against it, so a check that hangs outside Playwright's own
// timeouts records "<name> (timeout)" as a FAIL and the run moves on. If the
// whole run exceeds --run-timeout, it records "run (timeout)", writes what it
// has, and exits 1.
//
// Writes <out>/<browser>-qa.json (every check with ok/na/detail) and two
// screenshots (open menu at 390, desktop focus ring). Exits 1 if any check
// FAILs.
//
// WebKit: Playwright's WebKit follows Safari's default, where plain Tab skips
// links (only form controls and buttons are tab stops). The keyboard checks
// therefore focus links directly in WebKit instead of tabbing to them, and
// press a key first so :focus-visible still matches as it would for a
// keyboard user who enabled "Press Tab to highlight each item".
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
// @playwright/test is the declared dependency and re-exports the browser types.
import { chromium, webkit } from "@playwright/test";

const { values: args } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:3110" },
    out: { type: "string" },
    browser: { type: "string", default: "chromium" },
    quick: { type: "boolean", default: false },
    path: { type: "string", multiple: true, default: [] },
    timeout: { type: "string", default: "30" },
    "run-timeout": { type: "string", default: "60" },
  },
});

const BASE = args.base.replace(/\/+$/, "");
const BROWSERS = { chromium, webkit };
const browserType = BROWSERS[args.browser];
if (!browserType) {
  console.error(`--browser must be one of: ${Object.keys(BROWSERS).join(", ")}`);
  process.exit(1);
}
if (!args.out) {
  console.error("--out <dir> is required");
  process.exit(1);
}
const CHECK_MS = Number(args.timeout) * 1000;
const RUN_MS = Number(args["run-timeout"]) * 60_000;
if (!(CHECK_MS > 0) || !(RUN_MS > 0)) {
  console.error("--timeout and --run-timeout must be positive numbers");
  process.exit(1);
}
const WEBKIT = args.browser === "webkit";
const outDir = path.resolve(args.out);
fs.mkdirSync(outDir, { recursive: true });

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
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log("%s %s%s", ok ? "PASS" : "FAIL", name, detail ? ` — ${detail}` : "");
}
// A check whose subject is absent from the page (no event art, no <time>).
// Counted as not failing, but kept apart from PASS so a page that renders
// nothing is not mistaken for one that renders correctly.
function notApplicable(name, detail) {
  results.push({ name, ok: true, na: true, detail });
  console.log("N/A  %s — %s", name, detail);
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
// FAIL for that section, not the end of the run. Returns false when the
// section timed out, so a caller reusing a page can replace it — the hung
// work keeps running in the background and may still hold that page.
async function section(name, fn, ms = CHECK_MS) {
  try {
    await withTimeout(fn(), ms);
  } catch (e) {
    const timedOut = e instanceof CheckTimeout;
    check(`${name} (${timedOut ? "timeout" : "threw"})`, false, String(e.message ?? e).split("\n")[0].slice(0, 300));
    return !timedOut;
  }
  return true;
}

// Navigate and wait for what the geometry checks read: the `load` event (the
// stylesheets) and web fonts, whose swap changes text widths.
async function open(page, url) {
  const resp = await page.goto(url, { waitUntil: "load" });
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
  for (const f of fails) console.log("FAIL %s — %s", f.name, f.detail);
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
  const label = (el) => {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "";
    const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
    return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}${text ? ` "${text}"` : ""}`;
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
  const overflow = [];
  for (const el of main.querySelectorAll("*")) {
    if (overflow.some((o) => o.contains(el))) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
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
  // counts the ones whose text is cut right now.
  const isCut = (h) =>
    [h, ...h.querySelectorAll("*")].some((el) => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1);
  const clamped = headings.filter((h) => {
    for (const el of [h, ...h.querySelectorAll("*")]) {
      const s = getComputedStyle(el);
      if (s.textOverflow === "ellipsis" && s.overflowX !== "visible") return true;
      const lc = s.webkitLineClamp ?? s.getPropertyValue("-webkit-line-clamp");
      if (lc && lc !== "none") return true;
    }
    return h.clientWidth > 0 && h.scrollWidth > h.clientWidth + 1;
  });

  // art
  let artInRow = 0;
  let artStacked = 0;
  const artWrong = [];
  for (const art of main.querySelectorAll('[data-testid="event-art"]')) {
    if (!visible(art)) continue;
    const card = art.closest("a, li, article");
    const h = card?.querySelector(HEADINGS);
    if (!h || !visible(h)) continue;
    const ar = art.getBoundingClientRect();
    const hr = h.getBoundingClientRect();
    if (ar.top < hr.bottom && hr.top < ar.bottom) {
      artInRow++;
      if (ar.right > hr.left + 1) artWrong.push(h);
    } else artStacked++;
  }

  // year
  const times = [...main.querySelectorAll("time[datetime]")].filter((t) =>
    /^\d{4}-\d{2}-\d{2}/.test(t.getAttribute("datetime")),
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
      detail: `${artInRow} art beside a heading, ${artStacked} stacked`,
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
    const ctx = await newContext({ viewport: { width: w, height: 900 } });
    let page = await ctx.newPage();
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
            ? /Noto Sans KR Variable.*Noto Sans JP/.test(m.font)
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
        page = await ctx.newPage();
      }
    }
    await withTimeout(ctx.close(), 10000).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Toggle selector fixture: in-page <header> toggles inside <main> must not
// reach the banner-scoped selector. The unscoped selector is the positive
// control — if it does not find the injected toggles, the fixture did not
// take and the scoped count proves nothing.
// ---------------------------------------------------------------------------
await section("toggle selector fixture", async () => {
  const ctx = await newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await ctx.newPage();
    await open(page, `${BASE}/ja/events`);
    await page.evaluate(() => {
      const main = document.querySelector("main");
      main.insertAdjacentHTML(
        "afterbegin",
        ["section", "article", "section"]
          .map(
            (tag, i) =>
              `<${tag}><header><h2>fixture ${i}</h2><button aria-controls="qa-fixture-${i}">toggle</button></header>` +
              `<div id="qa-fixture-${i}"></div></${tag}>`,
          )
          .join(""),
      );
    });
    const unscoped = await page.locator("header button[aria-controls]").count();
    const scoped = page.locator(TOGGLE);
    const scopedCount = await scoped.count();
    const scopedInMain = scopedCount === 1 && (await scoped.evaluate((b) => !!b.closest("main")));
    check(
      "banner toggle selector ignores in-page <header> toggles",
      unscoped > 1 && scopedCount === 1 && !scopedInMain,
      `unscoped matches ${unscoped}, scoped matches ${scopedCount}${scopedInMain ? " (inside <main>)" : ""}`,
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
  CHECK_MS * 3,
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
  CHECK_MS * 3,
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
  CHECK_MS * 2,
);

await finish();
