// Artist list (/<locale>/artists, redesign ticket 25 on the 24-v1 packet):
// category pills, one panel per group, one grid row per top-level artist.
//
// Selectors are CSS-module class substrings (`[class*="__row"]`): the page
// carries no test ids, and production module class names keep their source
// name as a prefix.
//
// Data expectations are the shared dev DB as of 2026-10-21: three panels
// (Love Live! 12 rows, the synthetic animegame bucket 1, the null-category
// bucket 1), filters all + animegame, no k-pop artist (so ?category=kpop is
// a valid but empty filter). A dev DB change shows up as a FAIL with the
// counts in the detail; update the numbers, not the checks.
//
// Row order inside a group is not asserted: the list service reads group
// links without an ORDER BY, so the order is whatever Postgres returns.
const ROW = 'main a[class*="__row"]';
const FILTER = 'main nav a[class*="__filter"]';
const COUNTS = { groups: 3, rows: 14, filters: ["all", "animegame"] };
// Layout bands of the packet: five columns from 1100, a two-line stack with
// count + chevron on the right from 700, a three-line stack below.
const COLUMNS_FROM = 1100;
const STACK_BELOW = 700;
const CONTRAST = ["filter", "badge", "teamCount", "artistTitle", "originalName", "unitChip", "noUnits", "live"];
const CONTRAST_WIDTHS = [390, 1440];

const scenario = {
  name: "artist-list",

  async run(h) {
    const found = new Set();

    await h.layoutMatrix({
      path: (loc) => `/${loc}/artists`,
      basics: true,
      capture: true,
      cell: async ({ page, loc, width, name, check }) => {
        const l = await page.evaluate(
          ({ ROW, FILTER }) => {
            const rows = [...document.querySelectorAll(ROW)];
            const head = document.querySelector('main [class*="__columnHead"]');
            const first = rows[0];
            const cell = (sel) => first?.querySelector(sel)?.getBoundingClientRect();
            const titles = [...document.querySelectorAll('main [class*="__artistTitle"], main [class*="__groupTitle"]')];
            return {
              groups: document.querySelectorAll('main section[class*="__group"]').length,
              hrefs: rows.map((a) => a.getAttribute("href")),
              nested: rows.filter((a) => a.querySelector("a")).length,
              filters: [...document.querySelectorAll(FILTER)].map((a) => ({
                q: new URL(a.href).searchParams.get("category") ?? "all",
                cur: a.getAttribute("aria-current"),
                h: Math.round(a.getBoundingClientRect().height),
              })),
              columnHead: !!head && getComputedStyle(head).display !== "none",
              cols: first ? getComputedStyle(first).gridTemplateColumns.split(" ").length : 0,
              countBelowName: (() => {
                const n = cell('[class*="__name"]');
                const c = cell('[class*="__eventCount"]');
                return !!n && !!c && c.top >= n.bottom - 1;
              })(),
              clipped: titles
                .filter((t) => {
                  const s = getComputedStyle(t);
                  return s.textOverflow === "ellipsis" || s.webkitLineClamp !== "none" || t.scrollWidth > t.clientWidth + 1;
                })
                .map((t) => t.textContent.slice(0, 40)),
              listStyle: getComputedStyle(document.querySelector('main ul[class*="__list"]') ?? document.body).listStyleType,
              h2Weight: getComputedStyle(document.querySelector("main h2") ?? document.body).fontWeight,
            };
          },
          { ROW, FILTER },
        );

        check(name(`groups ${COUNTS.groups}, rows ${COUNTS.rows}`), l.groups === COUNTS.groups && l.hrefs.length === COUNTS.rows, `${l.groups} / ${l.hrefs.length}`);
        // Canonical row links: /<loc>/artists/<id>/<slug>, one link per row,
        // unit chips not linked.
        // Prefix by string compare: CI Semgrep blocks RegExps built from
        // variables.
        const prefix = `/${loc}/artists/`;
        const bad = l.hrefs.filter((x) => !x?.startsWith(prefix) || !/^\d+\/[a-z0-9-]+$/.test(x.slice(prefix.length)));
        check(name("rows link canonical id/slug"), l.hrefs.length > 0 && bad.length === 0, bad.slice(0, 3).join(" ") || `${l.hrefs.length} rows`);
        check(name("no nested links in a row"), l.nested === 0, String(l.nested));
        check(
          name("filters ≥44px, all current"),
          JSON.stringify(l.filters.map((f) => f.q)) === JSON.stringify(COUNTS.filters) &&
            l.filters.every((f) => f.h >= 44) &&
            l.filters.filter((f) => f.cur === "page").map((f) => f.q).join() === "all",
          JSON.stringify(l.filters),
        );
        const expCols = width >= COLUMNS_FROM ? 5 : width >= STACK_BELOW ? 4 : 3;
        check(
          name(`row grid ${expCols} columns, column head ${width >= COLUMNS_FROM ? "shown" : "hidden"}`),
          l.cols === expCols && l.columnHead === width >= COLUMNS_FROM,
          `cols ${l.cols} head ${l.columnHead}`,
        );
        if (width < STACK_BELOW) check(name("event count below the name"), l.countBelowName, String(l.countBelowName));
        check(name("names wrap, never clipped"), l.clipped.length === 0, l.clipped.join(" | "));
        check(name("preflight restated (list-style, h2 weight)"), l.listStyle === "none" && Number(l.h2Weight) >= 700, `${l.listStyle} / ${l.h2Weight}`);

        if (CONTRAST_WIDTHS.includes(width)) {
          for (const n of await h.contrast(page, CONTRAST, name("contrast"))) found.add(n);
        }

        await h.focusRing(page, name("row focus ring"), ROW, /^solid 3px rgb\(23, 79, 175\) -4px/);
        await h.focusRing(page, name("filter focus ring"), FILTER, /^solid 3px rgb\(23, 79, 175\) 3px/);
      },
    });

    // Positive control for the contrast SKIPs; `live` exists only while a
    // show is on, so it is exempt.
    for (const n of CONTRAST.filter((x) => x !== "live")) {
      h.check(`contrast ${n} found at some width`, found.has(n), found.has(n) ? "" : `no .*__${n} — typo or renamed class?`);
    }

    await h.section("filters + empty", async () => {
      const loc = h.LOCALES[0];
      // Keyboard: Enter on the animegame pill navigates and moves aria-current.
      const { page } = await h.open(`/${loc}/artists`, { width: 390 });
      await Promise.all([page.waitForURL(/category=animegame/), h.pressOn(page, `${FILTER}[href*="animegame"]`)]);
      const after = await page.evaluate((F) => {
        const cur = [...document.querySelectorAll(F)].filter((a) => a.getAttribute("aria-current") === "page");
        return { cur: cur.map((a) => a.textContent), rows: document.querySelectorAll('main a[class*="__row"]').length };
      }, FILTER);
      // The null-category bucket drops out under a real category.
      h.check("filter: Enter on animegame → current + 13 rows", after.cur.length === 1 && after.rows === COUNTS.rows - 1, JSON.stringify(after));

      // Valid category with no artists: empty panel, filters still shown.
      const empty = await h.open(`/${loc}/artists?category=kpop`, { width: 1440 });
      const e = await empty.page.evaluate(() => ({
        panel: !!document.querySelector('main [class*="__empty"]'),
        rows: document.querySelectorAll('main a[class*="__row"]').length,
        filters: document.querySelectorAll('main nav a[class*="__filter"]').length,
      }));
      h.check("empty: valid absent category → empty panel", e.panel && e.rows === 0 && e.filters === COUNTS.filters.length, JSON.stringify(e));

      // Invalid / repeated category: first value wins, unknown → all.
      const rep = await h.open(`/${loc}/artists?category=bogus&category=kpop`, { width: 1440 });
      const r = await rep.page.locator(ROW).count();
      h.check("query: unknown first value → all", r === COUNTS.rows, String(r));
    });

    await h.section("motion", () =>
      h.reducedMotion({ path: `/${h.LOCALES[0]}/artists`, width: 1440, selectors: [ROW, FILTER] }),
    );
  },
};

export default scenario;
