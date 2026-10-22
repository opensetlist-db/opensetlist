// Album list (/<locale>/albums, redesign ticket 27 on the 26-v1 packet):
// heading panel, artist pills, one white panel of rows per release year.
//
// Selectors match CSS-module class names by exact suffix (`__row`,
// `__year`, …): the page carries no test ids, production module class
// names keep their source name as the last `__` segment, and a substring
// match would also hit `__rowTitle` / `__yearGroup`.
//
// Data expectations are the shared dev DB as of 2026-10-21: 474 albums,
// none undated and none with a cover, 12 artist filters, album 135 the
// only one with active bonuses. A dev DB change shows up as a FAIL with
// the numbers in the detail; update the numbers, not the checks.
//
// Fixture (--fixture <json>, keys below): three albums made for this run,
// dated 2099 / undated so they sit first and last — one cover that loads,
// one whose cover URL is broken, one with no release date. Create and
// delete them yourself while holding the dev DB slot.
const COUNTS = { albums: 474, filters: 12 };
const BONUS_ALBUM = "135";
// Packet bands: the year moves under the title below 768; the cover steps
// 72 → 64px below 700 and → 56px (chevron hidden) below 360.
const YEAR_RIGHT_FROM = 768;
const COVER = (w) => (w < 360 ? 56 : w < 700 ? 64 : 72);
// `coverLabel` is left out: it sits on the cover's gradient, which
// h.contrast cannot measure. #52617a on the two stops is 5.57:1 (#eaf2ff)
// and 5.43:1 (#f1ecff), the same pair the 26-v1 packet measured.
const CONTRAST = ["filter", "type", "artist", "bonus", "rowTitle", "rowSub", "year", "yearCount", "arrow"];
const CONTRAST_WIDTHS = [390, 1440];
const ROW = 'main a[class$="__row"], main a[class*="__row "]';
const FILTER = 'main nav a[class$="__filter"], main nav a[class*="__filter "]';

// In-page helper (repeated inside each evaluate — a page function cannot
// close over Node scope): elements whose class list has a token ending
// `__<s>`.

const scenario = {
  name: "album-list",

  async run(h) {
    const found = new Set();

    await h.layoutMatrix({
      path: (loc) => `/${loc}/albums`,
      basics: true,
      capture: true,
      cell: async ({ page, loc, width, name, check }) => {
        const l = await page.evaluate(
          ({ ROW, FILTER }) => {
            const by = (s, root = document) => [...root.querySelectorAll("[class]")].filter((e) => [...e.classList].some((c) => c.endsWith("__" + s)));
            const vis = (e) => !!e && getComputedStyle(e).display !== "none";
            const rows = [...document.querySelectorAll(ROW)];
            const first = rows[0];
            const titles = [...by("rowTitle"), ...by("artist"), ...by("filter"), ...by("title")];
            return {
              years: [...document.querySelectorAll("main section h2")].map((x) => x.textContent),
              counts: by("yearCount").map((x) => Number(x.textContent.replace(/\D/g, ""))),
              sectionRows: [...document.querySelectorAll("main section")].map((s) => s.querySelectorAll("li").length),
              hrefs: rows.map((a) => a.getAttribute("href")),
              nested: rows.filter((a) => a.querySelector("a")).length,
              filters: [...document.querySelectorAll(FILTER)].map((a) => ({
                q: new URL(a.href).searchParams.get("artist") ?? "all",
                cur: a.getAttribute("aria-current"),
                h: Math.round(a.getBoundingClientRect().height),
              })),
              cover: first ? Math.round(by("cover", first)[0]?.getBoundingClientRect().width ?? 0) : 0,
              coverState: first ? by("cover", first)[0]?.dataset.state : null,
              yearRight: first ? vis(by("year", first)[0]) : null,
              yearBelow: first ? vis(by("mobileYear", first)[0]) : null,
              arrow: first ? vis(by("arrow", first)[0]) : null,
              clipped: titles
                .filter((t) => {
                  const s = getComputedStyle(t);
                  // Overflow only counts where it is cut off: a trailing
                  // full-width "）" hangs ~2px past the box (Chrome trims
                  // end-of-line punctuation) and still paints in full.
                  const cut = s.overflowX !== "visible" && t.scrollWidth > t.clientWidth + 1;
                  return s.textOverflow === "ellipsis" || s.webkitLineClamp !== "none" || cut;
                })
                .map((t) => t.textContent.slice(0, 40)),
              listStyle: getComputedStyle(document.querySelector("main ul") ?? document.body).listStyleType,
              h1Weight: getComputedStyle(document.querySelector("main h1") ?? document.body).fontWeight,
              h2Weight: getComputedStyle(document.querySelector("main h2") ?? document.body).fontWeight,
              bonus: [...document.querySelectorAll('main [role="img"]')].map((b) => ({
                album: b.closest("a")?.getAttribute("href")?.split("/")[3],
                label: b.getAttribute("aria-label"),
              })),
            };
          },
          { ROW, FILTER },
        );

        const total = l.hrefs.length;
        check(name(`${COUNTS.albums} album rows`), total === COUNTS.albums, String(total));
        check(
          name("year headings descend, counts match rows"),
          l.years.length > 0 &&
            l.years.every((y, i) => i === 0 || Number(y) < Number(l.years[i - 1]) || Number.isNaN(Number(y))) &&
            JSON.stringify(l.counts) === JSON.stringify(l.sectionRows),
          `${l.years.join(",")} / ${l.counts.join(",")} vs ${l.sectionRows.join(",")}`,
        );
        // Canonical row links: /<loc>/albums/<id>/<slug>. Prefix by string
        // compare: CI Semgrep blocks RegExps built from variables.
        const prefix = `/${loc}/albums/`;
        const bad = l.hrefs.filter((x) => !x?.startsWith(prefix) || !/^\d+(\/[a-z0-9-]+)?$/.test(x.slice(prefix.length)));
        check(name("rows link canonical id/slug"), total > 0 && bad.length === 0, bad.slice(0, 3).join(" ") || `${total} rows`);
        check(name("no nested links in a row"), l.nested === 0, String(l.nested));
        check(
          name(`filters all + ${COUNTS.filters}, ≥44px, all current`),
          l.filters.length === COUNTS.filters + 1 &&
            l.filters[0].q === "all" &&
            l.filters.every((f) => f.h >= 44) &&
            l.filters.filter((f) => f.cur === "page").map((f) => f.q).join() === "all",
          JSON.stringify(l.filters.slice(0, 3)),
        );
        check(name(`cover ${COVER(width)}px, no-image fallback`), l.cover === COVER(width) && l.coverState === "fallback", `${l.cover} ${l.coverState}`);
        check(
          name(`year ${width >= YEAR_RIGHT_FROM ? "right" : "under the title"}`),
          width >= YEAR_RIGHT_FROM ? l.yearRight && !l.yearBelow : !l.yearRight && l.yearBelow,
          `right ${l.yearRight} below ${l.yearBelow}`,
        );
        check(name(`chevron ${width < 360 ? "hidden" : "shown"}`), l.arrow === width >= 360, String(l.arrow));
        check(name("titles, artists, pills wrap — never clipped"), l.clipped.length === 0, l.clipped.join(" | "));
        check(
          name("preflight restated (list-style, h1/h2 weight)"),
          l.listStyle === "none" && Number(l.h1Weight) >= 700 && Number(l.h2Weight) >= 700,
          `${l.listStyle} / ${l.h1Weight} / ${l.h2Weight}`,
        );
        check(
          name(`bonus badge on album ${BONUS_ALBUM} only, labelled`),
          l.bonus.length === 1 && l.bonus[0].album === BONUS_ALBUM && !!l.bonus[0].label,
          JSON.stringify(l.bonus),
        );

        if (CONTRAST_WIDTHS.includes(width)) {
          for (const n of await h.contrast(page, CONTRAST, name("contrast"))) found.add(n);
        }

        await h.focusRing(page, name("row focus ring"), ROW, /^solid 3px rgb\(23, 79, 175\) -3px/);
        await h.focusRing(page, name("filter focus ring"), FILTER, /^solid 3px rgb\(23, 79, 175\) 3px/);
      },
    });

    // Positive control for the contrast SKIPs: every pair must be found at
    // some width, or a typo or a renamed class would SKIP forever.
    for (const n of CONTRAST) {
      h.check(`contrast ${n} found at some width`, found.has(n), found.has(n) ? "" : `no .*__${n} — typo or renamed class?`);
    }

    await h.section("filters + query", async () => {
      const loc = h.LOCALES[0];
      const { page } = await h.open(`/${loc}/albums`, { width: 390 });
      const all = await page.locator(ROW).count();
      // Keyboard: Enter on the first artist pill navigates and moves
      // aria-current; the filtered list is a non-empty subset.
      const target = page.locator(FILTER).nth(1);
      const id = new URL(await target.evaluate((a) => a.href)).searchParams.get("artist");
      await Promise.all([page.waitForURL((u) => u.searchParams.get("artist") === id), h.pressOn(page, `${FILTER.split(",")[0]}[href$="artist=${id}"]`)]);
      const after = await page.evaluate((F) => {
        const cur = [...document.querySelectorAll(F)].filter((a) => a.getAttribute("aria-current") === "page");
        return { cur: cur.map((a) => new URL(a.href).searchParams.get("artist")), rows: document.querySelectorAll("main li").length };
      }, FILTER);
      h.check(`filter: Enter on artist ${id} → current + subset`, after.cur.join() === id && after.rows > 0 && after.rows < all, JSON.stringify({ ...after, all }));

      // Unknown → all; repeated → first value wins.
      const unk = await h.open(`/${loc}/albums?artist=999999`, { width: 1440 });
      const u = await unk.page.locator(ROW).count();
      h.check("query: unknown artist → all", u === all, `${u} / ${all}`);
      const rep = await h.open(`/${loc}/albums?artist=${id}&artist=999999`, { width: 1440 });
      const r = await rep.page.locator(ROW).count();
      h.check("query: repeated artist → first wins", r === after.rows, `${r} / ${after.rows}`);
    });

    await h.section("motion", () =>
      h.reducedMotion({ path: `/${h.LOCALES[0]}/albums`, width: 1440, selectors: [ROW, FILTER] }),
    );
  },

  fixture: {
    needs: ["cover", "broken", "undated"],
    about: "three albums: a cover that loads (2099), a broken cover URL (2099), no release date",
    async run(h, fx) {
      for (const width of [1440, 390]) {
        await h.section(`fixture ${width}`, async () => {
          const { page } = await h.open(`/en/albums`, { width });
          // Covers load lazily; scroll the 2099 rows into view, then give
          // the client time to swap a failed image for the fallback.
          await page.waitForTimeout(1500);
          const st = await page.evaluate(
            (fx) => {
              const by = (s, root = document) => [...root.querySelectorAll("[class]")].filter((e) => [...e.classList].some((c) => c.endsWith("__" + s)));
              const row = (id) => document.querySelector(`main a[href^="/en/albums/${id}"]`);
              const cover = (id) => by("cover", row(id) ?? document.createElement("a"))[0];
              const info = (id) => {
                const c = cover(id);
                return c && [c.dataset.state, Math.round(c.getBoundingClientRect().width), c.querySelector("img")?.referrerPolicy ?? null];
              };
              const sections = [...document.querySelectorAll("main section")];
              return {
                cover: info(fx.cover),
                broken: info(fx.broken),
                undatedLast: !!sections.at(-1)?.querySelector(`a[href^="/en/albums/${fx.undated}"]`),
                lastHeading: sections.at(-1)?.querySelector("h2")?.textContent,
                firstHeading: sections[0]?.querySelector("h2")?.textContent,
              };
            },
            fx,
          );
          const size = width >= 700 ? 72 : 64;
          h.check(`fixture ${width}: external cover renders, no-referrer`, st.cover?.[0] === "image" && st.cover[2] === "no-referrer" && st.cover[1] === size, JSON.stringify(st.cover));
          h.check(`fixture ${width}: broken cover → fallback, same square`, st.broken?.[0] === "fallback" && st.broken[1] === size, JSON.stringify(st.broken));
          h.check(`fixture ${width}: undated group last`, st.undatedLast && st.firstHeading === "2099" && Number.isNaN(Number(st.lastHeading)), JSON.stringify(st));
          h.check(`fixture ${width}: no overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await h.shot(page, `en-${width}-fixture-covers`);
        });
      }
    },
  },
};

export default scenario;
