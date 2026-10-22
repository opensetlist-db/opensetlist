// Privacy and terms (/<locale>/privacy, /<locale>/terms): 34-v1 layout.
//
// ≥1024px a sticky sidebar holds the page switcher + section TOC; below
// it the sidebar is gone and a two-choice route switcher plus a collapsed
// "Contents" <details> take over. Both TOCs link the source section ids,
// and a TOC jump moves focus onto the target <section tabindex="-1">.
//
// A build without the redesigned legal layout (no `__sidebar` class)
// reports the page checks as SKIP and runs only the generic ones.
const PAGES = {
  privacy: ["collection", "purpose", "cookies", "thirdparty", "retention", "rights", "contact"],
  terms: ["intro", "conditions", "copyright", "disclaimer", "contact"],
};
// Each page's own `lastUpdated` (src/content/<page>/*.ts), so a swap fails.
const REVISED = { privacy: "2026-04-22T00:00:00Z", terms: "2026-04-17T00:00:00Z" };
// The packet's single layout switch for page grids (06: breakpoint.desktop).
const SIDEBAR_FROM = 1024;
// Text/background pairs by CSS-module class suffix (see h.contrast).
const CONTRAST = ["eyebrow", "updated", "tocTitle", "paragraph", "note", "contact", "intro", "sectionTitle", "subTitle"];
const CONTRAST_WIDTHS = [390, 1440];
// Text the design says must wrap, never truncate.
const NEVER_CLIPPED = [
  'main [class*="__title"]',
  'main [class*="__sectionTitle"]',
  'main [class*="__subTitle"]',
  'main [class*="__toc"] a',
  'main [class*="__pageNav"] a',
  'main [class*="__paragraph"]',
  'main [class*="__list"] li',
];

const scenario = {
  name: "legal",

  async run(h) {
    const found = new Set();
    let redesigned = false;

    for (const [key, ids] of Object.entries(PAGES)) {
      await h.layoutMatrix({
        path: (loc) => `/${loc}/${key}`,
        prefix: key,
        basics: true,
        capture: true,
        cell: async ({ page, width, name, check }) => {
          if (!(await page.locator('main [class*="__sidebar"]').count())) {
            h.skip(name("legal checks"), "no __sidebar on this build");
            return;
          }
          redesigned = true;

          const info = await page.evaluate(() => {
            const main = document.querySelector("main");
            const shown = (sel) => {
              const el = main.querySelector(sel);
              return !!el && getComputedStyle(el).display !== "none";
            };
            const current = [...main.querySelectorAll('a[aria-current="page"]')].filter(
              (a) => a.getClientRects().length > 0,
            );
            return {
              sections: [...main.querySelectorAll("article section")].map((s) => s.id),
              sidebar: shown('[class*="__sidebar"]'),
              mobilePages: shown('[class*="__mobilePages"]'),
              mobileToc: shown('[class*="__mobileToc"]'),
              current: current.map((a) => a.getAttribute("href")),
              time: main.querySelector("time")?.getAttribute("datetime") ?? "",
              mailto: !!main.querySelector('a[href="mailto:help@opensetlist.com"]'),
              bottom: main.querySelector('[class*="__bottomSwitch"] a')?.getAttribute("href") ?? "",
            };
          });
          check(name("source sections in order"), info.sections.join() === ids.join(), info.sections.join());
          const desktop = width >= SIDEBAR_FROM;
          check(
            name(desktop ? "sidebar shown, mobile nav hidden" : "mobile nav shown, sidebar hidden"),
            desktop
              ? info.sidebar && !info.mobilePages && !info.mobileToc
              : !info.sidebar && info.mobilePages && info.mobileToc,
            `sidebar ${info.sidebar}, pages ${info.mobilePages}, toc ${info.mobileToc}`,
          );
          check(
            name("current page marked once, visible"),
            info.current.length === 1 && info.current[0].endsWith(`/${key}`),
            info.current.join(" "),
          );
          check(name("revision date"), info.time === REVISED[key], info.time);
          check(name("mailto contact"), info.mailto);
          check(name("cross-page CTA"), info.bottom.endsWith(key === "privacy" ? "/terms" : "/privacy"), info.bottom);
          const c = await h.clipped(page, NEVER_CLIPPED);
          check(name("never clipped"), c.length === 0, c.map((x) => `${x.text} (${x.why})`).join(" | "));

          if (CONTRAST_WIDTHS.includes(width)) {
            for (const n of await h.contrast(page, CONTRAST, name("contrast"))) found.add(n);
          }

          // Keyboard: (mobile) Enter on the Contents summary opens it, then
          // Enter on the 3rd TOC link jumps there and focuses the section.
          if (!desktop) {
            await h.pressOn(page, 'main [class*="__mobileToc"] summary');
            const open = await page.evaluate(() => document.querySelector('main [class*="__mobileToc"]')?.open === true);
            check(name("Contents opens with Enter"), open);
          }
          const toc = desktop ? 'main [class*="__sidebar"] nav[class*="__toc"] a' : 'main [class*="__mobileToc"] a';
          const target = ids[2];
          await h.focusRing(page, name("TOC focus ring"), `${toc}[href="#${target}"]`, /^solid 3px rgb\(23, 79, 175\)/);
          await page.keyboard.press("Enter");
          await page.waitForFunction((id) => document.activeElement?.id === id, target, { timeout: 3000 }).catch(() => {});
          const jump = await page.evaluate((id) => {
            const el = document.getElementById(id);
            return { focused: document.activeElement === el, top: Math.round(el?.getBoundingClientRect().top ?? -1), hash: location.hash };
          }, target);
          check(
            name("TOC jump focuses section at 24px"),
            jump.focused && jump.hash === `#${target}` && Math.abs(jump.top - 24) <= 2,
            `focused ${jump.focused}, top ${jump.top}, ${jump.hash}`,
          );
        },
      });
    }

    // Everything below tests the redesigned layout only; on an older build
    // it would fail for the missing redesign, not for a defect.
    if (!redesigned) {
      h.skip("contrast / deep link / motion", "no __sidebar on this build");
      return;
    }
    for (const n of CONTRAST) {
      h.check(`contrast ${n} found at some width`, found.has(n), found.has(n) ? "" : `no .*__${n} — typo or renamed class?`);
    }

    // A deep link (/ko/privacy#retention) lands with the section 24px from
    // the top: native fragment scrolling, after the self-hosted fonts load
    // (a late font swap would shift the target down).
    await h.section("deep link", async () => {
      for (const width of [390, 1440]) {
        const { ctx, page } = await h.open(`/${h.LOCALES[0]}/privacy#retention`, { width });
        const top = await page.evaluate(() => Math.round(document.getElementById("retention")?.getBoundingClientRect().top ?? -1));
        h.check(`deep link #retention ${width}: section at 24px`, Math.abs(top - 24) <= 2, String(top));
        await ctx.close();
      }
    });

    // The legal pages themselves animate nothing; under reduce, the
    // packet's rule must leave no transition or animation anywhere in
    // <main>. Positive control: the selector set is non-empty.
    await h.section("motion", async () => {
      const { ctx, page } = await h.open(`/${h.LOCALES[0]}/privacy`, { width: 390, reducedMotion: "reduce" });
      const r = await page.evaluate(() => {
        const els = [...document.querySelectorAll("main *")];
        const moving = els.filter((el) => {
          const s = getComputedStyle(el);
          const pos = (v) => v.split(",").some((x) => parseFloat(x) > 0);
          return pos(s.transitionDuration) || (s.animationName !== "none" && pos(s.animationDuration));
        });
        return { total: els.length, moving: moving.slice(0, 3).map((e) => e.className || e.tagName) };
      });
      h.check("reduced motion: nothing moves in main", r.total > 0 && r.moving.length === 0, `${r.total} els; ${r.moving.join(", ")}`);
      await ctx.close();
    });
  },
};

export default scenario;
