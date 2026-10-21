#!/usr/bin/env node
// Redesign shared-shell QA (header, menu, footer, focus, motion).
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
//   keyboard skip link → page <main>; menu opens by keyboard, Tab enters its
//            links, Escape closes and returns focus to the toggle, outside
//            click closes, widening past the nav breakpoint clears it, a
//            route selection closes it; 3px #174FAF focus ring
//   locale   switching locale keeps the query string
//   motion   prefers-reduced-motion → no transitions/animations anywhere
//
// Usage (from the repo root, against a running production build — see
// redesign-capture.mjs for the build command):
//   node scripts/redesign-shell-qa.mjs --base http://localhost:3110 --out <dir>
//     [--browser chromium|webkit]   default chromium
//     [--quick]                      layout matrix limited to ko × 390/1100/
//                                    1440 × home/events (a full WebKit run
//                                    takes over 25 minutes on Windows)
//
// Writes <out>/<browser>-qa.json (every check with ok/detail) and two
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
const WEBKIT = args.browser === "webkit";
const outDir = path.resolve(args.out);
fs.mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------------------
// Shell geometry. Mirrors src/styles/tokens.ts — `layout.navHeight`
// ({ mobile: 64, tablet: 68, desktop: 80 }) and `breakpoint.nav` (1100); the
// tablet band starts at 700 per the comment on `layout`. A plain .mjs cannot
// import the .ts module, so when a token changes, change it here too.
// ---------------------------------------------------------------------------
const NAV_HEIGHT = { mobile: 64, tablet: 68, desktop: 80 };
const NAV_TABLET_MIN = 700;
const NAV_BREAKPOINT = 1100;
const DESKTOP_NAV_LINKS = 4;
// Focus ring: 3px solid #174FAF (rgb 23, 79, 175), offset 4px.
const FOCUS_RING = /solid 3px rgb\(23, 79, 175\) 4px/;

const expectedHeaderHeight = (w) =>
  w >= NAV_BREAKPOINT ? NAV_HEIGHT.desktop : w >= NAV_TABLET_MIN ? NAV_HEIGHT.tablet : NAV_HEIGHT.mobile;

// Widths straddle every band edge: 699/700 is covered by 430→768, and
// 1099/1100 explicitly, since the nav switch is where overflow shows first.
const LOCALES = args.quick ? ["ko"] : ["ja", "ko", "en"];
const WIDTHS = args.quick ? [390, 1100, 1440] : [320, 375, 390, 430, 768, 1024, 1099, 1100, 1440];
const PAGES = args.quick
  ? ["", "/events"]
  : ["", "/events", "/artists/1/hasunosora", "/albums/459/s-memorial-cd-box-complete-best-box", "/privacy"];

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log("%s %s%s", ok ? "PASS" : "FAIL", name, detail ? ` — ${detail}` : "");
}
// One section throwing (a selector that no longer exists, a timeout) is a
// FAIL for that section, not the end of the run.
async function section(name, fn) {
  try {
    await fn();
  } catch (e) {
    check(`${name} (threw)`, false, String(e.message ?? e).split("\n")[0].slice(0, 300));
  }
}

const browser = await browserType.launch();

// ---------------------------------------------------------------------------
// Layout matrix — one context per locale × width, reused across pages.
// ---------------------------------------------------------------------------
for (const locale of LOCALES) {
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    const page = await ctx.newPage();
    for (const p of PAGES) {
      const key = `${locale}${p || "/"}@${w}`;
      await section(`layout ${key}`, async () => {
        await page.goto(`${BASE}/${locale}${p}`, { waitUntil: "networkidle" });
        const m = await page.evaluate(() => {
          const header = document.querySelector("header");
          const r = header.getBoundingClientRect();
          const navLinks = [...document.querySelectorAll("header nav a")].filter((a) => a.offsetParent);
          const toggle = document.querySelector("button[aria-controls]");
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
        });
        const desktop = w >= NAV_BREAKPOINT;
        const fontOk =
          locale === "ko"
            ? /Noto Sans KR Variable.*Noto Sans JP/.test(m.font)
            : /Noto Sans JP.*Noto Sans KR/.test(m.font);
        const problems = [
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
      });
    }
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// Skip link + menu keyboard behaviour at 390.
// ---------------------------------------------------------------------------
await section("menu keyboard", async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/ja/events`, { waitUntil: "networkidle" });

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

    const toggle = page.locator("button[aria-controls]");
    await toggle.focus();
    await page.keyboard.press("Enter");
    check("menu opens via keyboard", (await toggle.getAttribute("aria-expanded")) === "true");
    await page.screenshot({ path: path.join(outDir, `${args.browser}-ja-390-menu.png`) });
    const ring = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement);
      return `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor} ${s.outlineOffset}`;
    });
    check("focus ring on toggle is 3px #174FAF offset 4px", FOCUS_RING.test(ring), ring);

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
    const back = await page.evaluate(
      () => document.activeElement?.tagName === "BUTTON" && document.activeElement.hasAttribute("aria-controls"),
    );
    check(
      "Escape closes menu and returns focus to toggle",
      back && (await toggle.getAttribute("aria-expanded")) === "false",
    );

    await toggle.click();
    await page.mouse.click(200, 800);
    check("outside click closes menu", (await toggle.getAttribute("aria-expanded")) === "false");

    await toggle.click();
    await page.setViewportSize({ width: NAV_BREAKPOINT + 100, height: 844 });
    await page.waitForTimeout(200);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    check(
      `widening past ${NAV_BREAKPOINT}px clears the open menu`,
      (await toggle.getAttribute("aria-expanded")) === "false",
    );

    await toggle.click();
    await menuLinks.and(page.locator('[href$="/artists"]')).click();
    await page.waitForURL(/\/ja\/artists$/);
    check(
      "route selection closes menu",
      (await page.locator("button[aria-controls]").getAttribute("aria-expanded")) === "false",
    );
  } finally {
    await ctx.close();
  }
});

// ---------------------------------------------------------------------------
// Locale switch keeps the query; desktop keyboard focus shows the ring.
// ---------------------------------------------------------------------------
await section("locale switch", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/ko/events?filter=upcoming`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "English" }).first().click();
    await page.waitForURL(/\/en\/events/);
    check("locale switch keeps query", new URL(page.url()).search === "?filter=upcoming", page.url());

    // Chromium: Tab, Tab = skip link, then the logo link. WebKit skips
    // links on Tab, so focus the first header link after a key press.
    if (WEBKIT) {
      await page.keyboard.press("Shift");
      await page.locator("header a").first().focus();
    } else {
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
    }
    const ring = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement);
      return `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor} ${s.outlineOffset}`;
    });
    check("desktop keyboard focus shows 3px #174FAF ring", FOCUS_RING.test(ring), ring);
    await page.screenshot({ path: path.join(outDir, `${args.browser}-en-1440-focus.png`) });
  } finally {
    await ctx.close();
  }
});

// ---------------------------------------------------------------------------
// Reduced motion: nothing on the page transitions or animates.
// ---------------------------------------------------------------------------
await section("reduced motion", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  try {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/ko`, { waitUntil: "networkidle" });
    const animated = await page.evaluate(
      () =>
        [...document.querySelectorAll("*")].filter((e) => {
          const s = getComputedStyle(e);
          return s.transitionDuration.split(",").some((d) => parseFloat(d) > 0) || s.animationName !== "none";
        }).length,
    );
    check("reduced motion removes transitions/animations", animated === 0, `animated elements: ${animated}`);
  } finally {
    await ctx.close();
  }
});

// Results first: Playwright's WebKit on Windows can hang in browser.close()
// (see redesign-capture.mjs), so the close is bounded and process.exit ends
// the run either way.
const file = path.join(outDir, `${args.browser}-qa.json`);
fs.writeFileSync(file, JSON.stringify(results, null, 2));
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 10000))]);
const fails = results.filter((r) => !r.ok);
console.log("");
console.log("%d/%d passed → %s", results.length - fails.length, results.length, file);
for (const f of fails) console.log("FAIL %s — %s", f.name, f.detail);
process.exit(fails.length ? 1 : 0);
