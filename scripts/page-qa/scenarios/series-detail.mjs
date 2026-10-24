// Series detail (/<locale>/series/<id>/<slug>, redesign 32-v1).
//
// Real dev records (the 32-v1 baselines):
//   1  hasunosora-6th     — completed tour, 4 city groups, songs, units
//   11 hasunosora-5th     — completed tour, tour BD, no songs (empty tab)
//   27 lovelive-15th-fes  — organizer fallback (no artist), upcoming
// The fixture part (--fixture, rows from scripts/db-fixture-add.mjs) adds
// the states the dev data does not have: parent/child, LIVE banner,
// cancelled and missing-city rows, a long title, an empty series, and an
// all-cancelled series.
//
// A build without the redesigned page (no `#series-title` panel) SKIPs
// the page checks and keeps the generic ones.
const REC = {
  tour: "/series/1/hasunosora-6th",
  bd: "/series/11/hasunosora-5th",
  fes: "/series/27/lovelive-15th-fes",
};
const IDENTITY = 'main section[aria-labelledby="series-title"]';
// One column, progress/units moved above the schedule.
const STACK_BELOW = 768;
// Solid text/background pairs by CSS-module class suffix (h.contrast).
const CONTRAST = ["badge", "metaLabel", "legSub", "legCount", "status", "progressLabels", "eventName"];
const CONTRAST_WIDTHS = [390, 1440];

async function pageInfo(page) {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    const aside = main.querySelector("aside");
    const firstLeg = main.querySelector("details");
    const r = (el) => (el ? el.getBoundingClientRect() : null);
    return {
      metrics: [...main.querySelectorAll("dl dd")].map((d) => d.textContent.trim()),
      tabs: [...main.querySelectorAll('nav a[href*="tab="]')].map((a) => ({
        text: a.textContent.trim(),
        current: a.getAttribute("aria-current"),
      })),
      legs: main.querySelectorAll("details").length,
      legsOpen: main.querySelectorAll("details[open]").length,
      // Below 768 the aside renders above the first city group.
      asideAbove: aside && firstLeg ? r(aside).bottom <= r(firstLeg).top + 1 : null,
      asideBeside: aside && firstLeg ? r(aside).left > r(firstLeg).right - 1 : null,
      progress: (() => {
        const p = main.querySelector("progress");
        return p ? { value: p.value, max: p.max } : null;
      })(),
      h1Lang: main.querySelector("h1")?.getAttribute("lang"),
      summaryHeading: !!main.querySelector("summary > h2"),
    };
  });
}

const scenario = {
  name: "series-detail",

  async run(h) {
    const found = new Set();
    let redesigned = false;

    await h.layoutMatrix({
      path: (loc) => `/${loc}${REC.tour}`,
      basics: true,
      capture: true,
      cell: async ({ page, width, name, check }) => {
        if (!(await page.locator(IDENTITY).count())) {
          h.skip(name("series checks"), `${IDENTITY} not on this build`);
          return;
        }
        redesigned = true;
        const info = await pageInfo(page);
        check(name("four metrics"), info.metrics.length === 4, info.metrics.join(" | "));
        check(
          name("tabs: schedule current"),
          info.tabs.length === 2 && info.tabs[0].current === "page" && info.tabs[1].current === null,
          info.tabs.map((t) => `${t.text}:${t.current}`).join(", "),
        );
        check(name("city groups open"), info.legs > 0 && info.legs === info.legsOpen, `${info.legsOpen}/${info.legs}`);
        check(name("heading is summary's direct child"), info.summaryHeading, "");
        check(
          name("progress value/max"),
          !!info.progress && info.progress.max > 0 && info.progress.value <= info.progress.max,
          JSON.stringify(info.progress),
        );
        check(
          name(width < STACK_BELOW ? "aside above schedule" : "aside beside schedule"),
          width < STACK_BELOW ? info.asideAbove === true : info.asideBeside === true,
          `above=${info.asideAbove} beside=${info.asideBeside}`,
        );
        const cut = await h.clipped(page, ["main h1", 'main [class*="__eventName"]', 'main [class*="__legSub"]']);
        check(name("no clipped title/name"), cut.length === 0, cut.map((c) => `${c.text} (${c.why})`).join("; "));

        if (CONTRAST_WIDTHS.includes(width)) {
          for (const n of await h.contrast(page, CONTRAST, name("contrast"))) found.add(n);
        }

        await h.focusRing(page, name("summary focus ring"), "main summary", /solid 3px/);
        await h.focusRing(page, name("event row focus ring"), 'main [class*="__eventRow"]', /solid 3px/);
      },
    });

    if (redesigned) {
      for (const n of CONTRAST) {
        h.check(`contrast ${n} found at some width`, found.has(n), found.has(n) ? "" : `no .*__${n}`);
      }
    }

    // Other baselines: songs tab, BD + empty songs, organizer fallback.
    for (const loc of h.LOCALES) {
      await h.section(`records ${loc}`, async () => {
        const songs = await h.open(`/${loc}${REC.tour}?tab=songs`, { width: 390 });
        const s = await songs.page.evaluate(() => {
          const main = document.querySelector("main");
          return {
            rows: main.querySelectorAll('a[href*="/songs/"]').length,
            current: main.querySelector('nav a[aria-current="page"]')?.getAttribute("href") ?? "",
            counts: [...main.querySelectorAll('[class*="__songCount"]')].map((x) => parseInt(x.textContent, 10)),
          };
        });
        h.check(`${loc} songs tab rows`, s.rows > 0 && s.current.includes("tab=songs"), `${s.rows} rows`);
        h.check(
          `${loc} songs ordered by count`,
          s.counts.every((c, i) => i === 0 || s.counts[i - 1] >= c),
          s.counts.slice(0, 8).join(","),
        );
        h.check(`${loc} songs tab no errors`, songs.errors.length === 0, songs.errors.join("; "));

        const bd = await h.open(`/${loc}${REC.bd}`, { width: 390 });
        const b = await bd.page.evaluate(() => {
          const main = document.querySelector("main");
          return {
            bd: main.querySelectorAll('section[aria-labelledby="series-bd-title"] a[href*="/albums/"]').length,
            cover: main.querySelector('[data-testid="cover-image"]')?.getAttribute("data-state"),
          };
        });
        h.check(`${loc} tour BD card`, b.bd >= 1, `${b.bd} card(s), cover ${b.cover}`);
        const bdSongs = await h.open(`/${loc}${REC.bd}?tab=songs`, { width: 390 });
        const empty = await bdSongs.page.evaluate(
          () => !!document.querySelector('main [class*="__empty"]') && !document.querySelector('main a[href*="/songs/"]'),
        );
        h.check(`${loc} songs empty panel`, empty, "");

        const fes = await h.open(`/${loc}${REC.fes}`, { width: 1440 });
        const f = await fes.page.evaluate(() => {
          const id = document.querySelector('main section[aria-labelledby="series-title"]');
          return {
            artistLink: !!id?.querySelector('a[href*="/artists/"]'),
            meta: id?.querySelector('[class*="__metaValue"]')?.textContent.trim() ?? "",
            upcoming: document.querySelectorAll('main [data-status="upcoming"]').length,
          };
        });
        h.check(`${loc} organizer fallback`, !f.artistLink && f.meta.length > 0, f.meta);
        h.check(`${loc} upcoming pills`, f.upcoming > 0, String(f.upcoming));
      });
    }

    await h.section("keyboard", async () => {
      const { page } = await h.open(`/ko${REC.tour}`, { width: 1440 });
      const first = page.locator("main details").first();
      await h.pressOn(page, "main summary", "Enter");
      const closed = !(await first.evaluate((d) => d.open));
      await h.pressOn(page, "main summary", "Enter");
      const reopened = await first.evaluate((d) => d.open);
      h.check("city group toggles with Enter", closed && reopened, `closed=${closed} reopened=${reopened}`);

      await h.pressOn(page, 'main nav a[href*="tab=songs"]', "Enter");
      await page.waitForURL(/tab=songs/, { timeout: h.timeoutMs });
      const onSongs = await page.locator('main a[href*="/songs/"]').count();
      await page.goBack();
      await page.waitForURL((u) => !u.search.includes("tab=songs"), { timeout: h.timeoutMs });
      // The URL flips before the RSC payload re-renders the schedule.
      await page.locator("main details").first().waitFor({ timeout: h.timeoutMs });
      const back = await page.locator("main details").count();
      h.check("tab via keyboard, back returns", onSongs > 0 && back > 0, `songs=${onSongs} legs=${back}`);
    });

    await h.section("canonical / 404", async () => {
      await h.expectStatus("bare id 308", "/ko/series/1", {
        status: 308,
        location: /\/ko\/series\/1\/hasunosora-6th$/,
      });
      await h.expectStatus("wrong slug 308 keeps tab", "/ja/series/1/wrong?tab=songs", {
        status: 308,
        location: /\/ja\/series\/1\/hasunosora-6th\?tab=songs$/,
      });
      await h.expectStatus("extra segment 308", "/en/series/27/lovelive-15th-fes/extra", {
        status: 308,
        location: /\/en\/series\/27\/lovelive-15th-fes$/,
      });
      await h.expectStatus("canonical 200", "/ko/series/1/hasunosora-6th", { status: 200 });
      await h.expectStatus("unknown id 404", "/ko/series/999999999", { status: 404 });
      await h.expectStatus("non-numeric id 404", "/ko/series/abc", { status: 404 });
    });

    await h.section("motion", () =>
      h.reducedMotion({
        path: `/${h.LOCALES[0]}${REC.tour}`,
        width: 1440,
        selectors: ['main [class*="__chevron"]', 'main [class*="__eventRow"]'],
        label: "reduced motion (chevron, rows)",
      }),
    );
  },

  fixture: {
    needs: ["parent", "child", "empty", "cancelled", "live"],
    about:
      "db-fixture-add rows: series parent/child/empty/cancelled; child events live (ongoing), cancel, upcoming (long name), nocity; cancelled series events c1/c2",
    async run(h, fx) {
      // The fixture slug is `<tag>-<ms>-<key>`; the bare id 308s to it.
      const path = async (loc, id) => {
        const res = await h.open(`/${loc}/series/${id}`, { width: 390 });
        return res;
      };
      for (const loc of h.LOCALES) {
        await h.section(`fixture ${loc}`, async () => {
          const child = await path(loc, fx.child);
          const c = await child.page.evaluate(
            ({ parent, live }) => {
              const main = document.querySelector("main");
              const crumbs = [...main.querySelectorAll('nav a[href*="/series/"]')].map((a) => a.getAttribute("href"));
              return {
                parentCrumb: crumbs.some((h) => h.includes(`/series/${parent}/`)),
                banner: !!main.querySelector(`a[href*="/events/${live}/"][class*="__liveBanner"]`),
                cancelled: main.querySelectorAll('[data-status="cancelled"]').length,
                ongoing: main.querySelectorAll('[data-status="ongoing"]').length,
                cities: [...main.querySelectorAll('[class*="__legCity"]')].map((x) => x.textContent.trim()),
                ongoingFirst: main.querySelector('details [data-status]')?.getAttribute("data-status"),
                organizer: !!main.querySelector('[class*="__metaValue"]'),
                overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              };
            },
            { parent: fx.parent, live: fx.live },
          );
          h.check(`${loc} child: parent in breadcrumb`, c.parentCrumb, "");
          h.check(`${loc} child: LIVE banner → ongoing event`, c.banner, "");
          h.check(`${loc} child: ongoing group first`, c.ongoingFirst === "ongoing", String(c.ongoingFirst));
          h.check(`${loc} child: cancelled + LIVE pills`, c.cancelled > 0 && c.ongoing > 0, `cancelled=${c.cancelled} ongoing=${c.ongoing}`);
          h.check(`${loc} child: unknown city group`, c.cities.length >= 3, c.cities.join(" | "));
          h.check(`${loc} child: organizer row`, c.organizer, "");
          h.check(`${loc} child: no overflow at 390`, c.overflow <= 0, String(c.overflow));
          const cut = await h.clipped(child.page, ["main h1", 'main [class*="__eventName"]']);
          h.check(`${loc} child: long title/name wrap`, cut.length === 0, cut.map((x) => x.why).join("; "));
          await h.shot(child.page, `fixture-${loc}-390-child`);

          const parent = await path(loc, fx.parent);
          const p = await parent.page.evaluate(
            (childId) => !!document.querySelector(`main section[aria-labelledby="series-children-title"] a[href*="/series/${childId}/"]`),
            fx.child,
          );
          h.check(`${loc} parent: child series link`, p, "");

          const empty = await path(loc, fx.empty);
          const e = await empty.page.evaluate(() => ({
            empty: !!document.querySelector('main [class*="__empty"]'),
            progress: !!document.querySelector("main progress"),
            h1: document.querySelectorAll("main h1").length,
          }));
          h.check(`${loc} empty: panel, no progress`, e.empty && !e.progress && e.h1 === 1, JSON.stringify(e));
          await h.shot(empty.page, `fixture-${loc}-390-empty`);

          const cancelled = await path(loc, fx.cancelled);
          const x = await cancelled.page.evaluate(() => ({
            headerPill: !!document.querySelector("main summary [data-status]"),
            rowPills: document.querySelectorAll('main li [data-status="cancelled"]').length,
          }));
          h.check(`${loc} all cancelled: no header pill, row pills`, !x.headerPill && x.rowPills === 2, JSON.stringify(x));
        });
      }
    },
  },
};

export default scenario;
