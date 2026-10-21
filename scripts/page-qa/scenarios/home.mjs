// Home (/<locale>): hero with search, ongoing / upcoming / recent sections,
// the upcoming rail.
//
// Everything page-specific hangs off the hero search input: a build
// without the redesigned home (no #hero-search) reports those checks as
// SKIP and runs only the generic ones (overflow, lang, raw keys, errors,
// one h1, 24px targets). On a build that has it, a run should show no
// "home checks" SKIP — if every cell SKIPs there, the id was renamed.
//
// Data-dependent parts SKIP rather than fail: the ongoing section and the
// LIVE dot exist only while a show is on, and the rail needs at least two
// upcoming shows to scroll.
const HERO_SEARCH = "#hero-search";
const RAIL = 'main [role="region"][aria-labelledby="upcoming-title"]';
// The home's mobile/desktop switch: the hero swaps its art-directed crop
// and the upcoming rail turns from a scroller into a static row here.
const MOBILE_BELOW = 700;
// Solid text/background pairs, by CSS-module class suffix (see
// h.contrast). Measured at one phone and one desktop width.
const CONTRAST = ["badge", "badgeWish", "liveBadge", "liveCta", "day", "heroCaption"];
const CONTRAST_WIDTHS = [390, 1440];

const scenario = {
  name: "home",

  async run(h) {
    const found = new Set();
    let redesigned = false;

    await h.layoutMatrix({
      path: (loc) => `/${loc}`,
      basics: true,
      capture: true,
      cell: async ({ page, loc, width, name, check }) => {
        if (!(await page.locator(HERO_SEARCH).count())) {
          h.skip(name("home checks"), `${HERO_SEARCH} not on this build`);
          return;
        }
        redesigned = true;

        const info = await page.evaluate(() => {
          const main = document.querySelector("main");
          const form = main.querySelector('form[role="search"]');
          const input = form?.querySelector('input[name="q"]');
          const hero = main.querySelector("picture img");
          return {
            order: [...main.querySelectorAll("h2")].map((x) => x.id),
            heroSrc: hero?.currentSrc ?? "",
            heroLoaded: !!hero && hero.complete && hero.naturalWidth > 0,
            action: form?.getAttribute("action"),
            method: form?.getAttribute("method"),
            maxLength: input?.maxLength,
            labelled: !!input && !!document.querySelector(`label[for="${input.id}"]`)?.textContent.trim(),
          };
        });
        const iu = info.order.indexOf("upcoming-title");
        const ip = info.order.indexOf("past-title");
        const io = info.order.indexOf("ongoing-title");
        check(name("section order"), iu >= 0 && ip > iu && (io === -1 || io < iu), info.order.join(">"));
        const img = info.heroSrc.split("/").pop();
        check(name("hero image loaded"), info.heroLoaded, img);
        check(
          name("hero art direction"),
          width < MOBILE_BELOW ? /hero-mobile-/.test(info.heroSrc) : /hero-desktop-/.test(info.heroSrc),
          img,
        );
        check(
          name("search form"),
          info.action === `/${loc}/search` && info.method === "get" && info.maxLength === 120 && info.labelled,
          `${info.method} ${info.action}, maxlength ${info.maxLength}, label ${info.labelled}`,
        );
        // The rail renders only when there are upcoming shows; when it
        // does, it holds 1–5 cards (an empty rail is a bug, not "no data").
        if (await page.locator(RAIL).count()) {
          const cards = await page.locator(`${RAIL} a`).count();
          check(name("rail 1–5 cards"), cards > 0 && cards <= 5, String(cards));
        }

        // Contrast before any focus step; the capture is already taken.
        if (CONTRAST_WIDTHS.includes(width)) {
          for (const n of await h.contrast(page, CONTRAST, name("contrast"))) found.add(n);
        }

        // White ring on the dark hero, not the shell's #174FAF.
        await h.focusRing(page, name("hero search focus ring"), HERO_SEARCH, /^solid 3px rgb\(255, 255, 255\)/);
        await h.scrollRegion(page, {
          name: name("upcoming rail"),
          selector: RAIL,
          scrollBelow: MOBILE_BELOW,
          width,
          path: `/${loc}`,
        });
      },
    });

    // Positive control for the contrast SKIPs: on the redesigned home every
    // pair must be found at some width, or a typo or a renamed class would
    // SKIP forever.
    if (redesigned) {
      for (const n of CONTRAST) {
        h.check(`contrast ${n} found at some width`, found.has(n), found.has(n) ? "" : `no .*__${n} — typo or renamed class?`);
      }
    }

    await h.section("motion", () =>
      h.reducedMotion({
        path: `/${h.LOCALES[0]}`,
        width: 1440,
        selectors: ['main [class*="__liveDot"]'],
        // Stopped, the dot rests fully opaque rather than frozen mid-fade.
        rest: { opacity: "1" },
        optional: true,
        label: "reduced motion (LIVE dot)",
      }),
    );
  },
};

export default scenario;
