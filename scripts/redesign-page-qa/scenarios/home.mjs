// redesign-page-qa scenario: the redesigned home (/<locale>).
// The reference scenario — copy it as the starting point for another page.
//
// Everything page-specific hangs off the hero search input: a build
// without the redesigned home (dev until the redesign merges) reports
// these checks as SKIP and runs only the generic ones.
//
// Data-dependent parts SKIP rather than fail: the ongoing section and the
// LIVE dot exist only while a show is on, and the rail needs upcoming shows.
const RAIL = 'main [role="region"][aria-labelledby="upcoming-title"]';
// The home's mobile/desktop switch: the hero swaps its art-directed crop
// and the upcoming rail turns from a scroller into a static row here.
const MOBILE_BELOW = 700;

const scenario = {
  name: "home",
  path: "/",
  requires: "#hero-search",

  async checks({ page, locale, width, check, tag }) {
    const info = await page.evaluate(() => {
      const main = document.querySelector("main");
      const form = main.querySelector('form[role="search"]');
      const input = form?.querySelector('input[name="q"]');
      const hero = main.querySelector("picture img");
      return {
        order: [...main.querySelectorAll("h2")].map((h) => h.id),
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
    check(`${tag} section order`, iu >= 0 && ip > iu && (io === -1 || io < iu), info.order.join(">"));
    check(`${tag} hero image loaded`, info.heroLoaded, info.heroSrc.split("/").pop());
    // Art direction: the mobile crop below 700px, the desktop one above.
    check(
      `${tag} hero art direction`,
      width < MOBILE_BELOW ? /hero-mobile-/.test(info.heroSrc) : /hero-desktop-/.test(info.heroSrc),
      info.heroSrc.split("/").pop(),
    );
    check(
      `${tag} search form`,
      info.action === `/${locale}/search` && info.method === "get" && info.maxLength === 120 && info.labelled,
      `${info.method} ${info.action}, maxlength ${info.maxLength}, label ${info.labelled}`,
    );
    // The rail renders only when there are upcoming shows; when it does,
    // it holds 1–5 cards (an empty rail is a bug, not "no data").
    if (await page.locator(RAIL).count()) {
      const cards = await page.locator(`${RAIL} a`).count();
      check(`${tag} rail 1–5 cards`, cards > 0 && cards <= 5, String(cards));
    }
  },

  // White ring on the dark hero, not the shell's #174FAF.
  focusRings: [{ name: "hero search", selector: "#hero-search", ring: /^solid 3px rgb\(255, 255, 255\)/ }],

  scrollRegions: [{ name: "upcoming rail", selector: RAIL, scrollBelow: MOBILE_BELOW }],

  contrast: {
    widths: [390, 1440],
    pairs: ["badge", "badgeWish", "liveBadge", "liveCta", "day", "heroCaption"],
  },

  // Stopped, the dot rests fully opaque rather than frozen mid-fade.
  reducedMotion: { suffix: "liveDot", animation: "live-pulse", rest: { opacity: "1" } },
};

export default scenario;
