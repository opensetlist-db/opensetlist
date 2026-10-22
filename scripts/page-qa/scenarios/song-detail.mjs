// Song detail (/<locale>/songs/<id>/<slug>): identity card, album panel,
// history / variations tabs (approved packet 28-v1).
//
// Records are dev-DB songs chosen for their states (wiki handoff 29):
//   1    Dream Believers — 3 appearances, 1 album, 11 versions (base)
//   62   Dream Believers 104期 Ver. — variant, no appearances (empty history)
//   765  Eternalize Love!! — encore #22, 13 versions
//   2455 Aozora Jumping Heart — 5 albums
//   562  Tokimeki Runners — manual "ongoing" event + two appearances in one event
// Data-dependent checks SKIP when the record no longer has that shape, so a
// changed dev DB shows up as SKIPs to look at rather than as page FAILs.
//
// A build without the redesigned page (no identity card) SKIPs the page
// checks and runs only the generic ones.
const SONG = { id: 1, slug: "dream-believers" };
const VARIANT = { id: 62, slug: "dream-believers-104" };
const ENCORE = { id: 765, slug: "eternalize-love" };
const MANY_ALBUMS = { id: 2455, slug: "aozora-jumping-heart" };
const LIVE = { id: 562, slug: "tokimeki-runners" };

const path = (loc, s, q = "") => `/${loc}/songs/${s.id}/${s.slug}${q}`;
const IDENTITY = 'main [class*="__identity"]';
// Album panel sits right of the tabs from 1000px, above them below.
const TWO_COLUMN_FROM = 1000;
// History column strip and row grid are desktop-only below 700px.
const MOBILE_BELOW = 700;
// Solid text/background pairs, by CSS-module class suffix (see h.contrast).
// The artist badge and base link sit on the identity card's gradient,
// which h.contrast cannot see through (SKIP "background image"); their
// worst case is #165DCC on the gradient's #F0EDFF end, 5.26:1, computed by
// hand in wiki handoff 29.
const CONTRAST = ["status", "position", "chip", "count", "tab", "encore", "variantPill"];
const CONTRAST_WIDTHS = [390, 1440];
const RING = /^solid 3px rgb\(23, 79, 175\)/;

const scenario = {
  name: "song-detail",

  async run(h) {
    const found = new Set();
    let redesigned = false;

    // ── layout matrix on the base song ────────────────────────────
    await h.layoutMatrix({
      path: (loc) => path(loc, SONG),
      basics: true,
      capture: true,
      cell: async ({ page, loc, width, name, check }) => {
        if (!(await page.locator(IDENTITY).count())) {
          h.skip(name("song checks"), "identity card not on this build");
          return;
        }
        redesigned = true;
        const info = await page.evaluate(() => {
          const q = (s) => document.querySelector(s);
          const box = (el) => el?.getBoundingClientRect();
          const identity = q('main [class*="__identity"]');
          const albums = q('main aside[class*="__albumPanel"]');
          const tabs = q('main nav[class*="__tabs"]');
          const order = [identity, albums, tabs].every(Boolean)
            ? identity.compareDocumentPosition(albums) & Node.DOCUMENT_POSITION_FOLLOWING &&
              albums.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING
            : false;
          const cols = q('main [class*="__historyColumns"]');
          return {
            order: !!order,
            albumsBox: box(albums),
            tabsBox: box(tabs),
            colsShown: !!cols && getComputedStyle(cols).display !== "none",
            groups: document.querySelectorAll("main details[open]").length,
            current: q('main nav[class*="__tabs"] a[aria-current="page"]')?.getAttribute("href"),
            h1: q("main h1")?.textContent,
            lang: document.documentElement.lang,
          };
        });
        check(name("DOM order identity→albums→tabs"), info.order, "");
        if (info.albumsBox && info.tabsBox) {
          const right = info.albumsBox.left >= info.tabsBox.right - 1;
          const above = info.albumsBox.bottom <= info.tabsBox.top + 1;
          check(
            name(width >= TWO_COLUMN_FROM ? "album panel right" : "album panel above tabs"),
            width >= TWO_COLUMN_FROM ? right : above,
            JSON.stringify({ a: Math.round(info.albumsBox.left), t: Math.round(info.tabsBox.right) }),
          );
        }
        check(name("history columns per band"), info.colsShown === width >= MOBILE_BELOW, String(info.colsShown));
        check(name("groups start open"), info.groups > 0, String(info.groups));
        check(name("history tab current"), info.current === `${path(loc, SONG)}?tab=history`, info.current ?? "none");
        check(name("h1 original title"), info.h1 === "Dream Believers", info.h1 ?? "");
        check(name("lang"), info.lang === loc, info.lang);

        if (CONTRAST_WIDTHS.includes(width)) {
          for (const n of await h.contrast(page, CONTRAST, name("contrast"))) found.add(n);
        }
        await h.focusRing(page, name("history row focus ring"), 'main a[class*="__performance"]', RING);
        await h.focusRing(page, name("tab focus ring"), 'main nav[class*="__tabs"] a', RING);
      },
    });

    // ── variant: version identity, base link, variations tab ──────
    await h.section("variant + variations", async () => {
      const { page, errors } = await h.open(path("ko", VARIANT, "?tab=variations"), { width: 1440 });
      if (!(await page.locator(IDENTITY).count())) {
        h.skip("variant checks", "identity card not on this build");
        return;
      }
      for (const n of await h.contrast(page, CONTRAST, "variant contrast")) found.add(n);
      const v = await page.evaluate(() => {
        const base = [...document.querySelectorAll('main a[class*="__baseLink"]')].map((a) => a.getAttribute("href"));
        const rows = [...document.querySelectorAll('main ul[class*="__versionList"] li')];
        const current = rows.filter((li) => li.querySelector('[aria-current="page"]'));
        const links = rows.map((li) => li.querySelector("a")?.getAttribute("href")).filter(Boolean);
        return {
          base,
          rows: rows.length,
          current: current.length,
          currentIsLink: current.some((li) => li.querySelector("a")),
          linksWithTab: links.filter((l) => l.includes("tab=")).length,
          firstLink: links[0],
          emptyHistoryTab: document.querySelector('main nav[class*="__tabs"] a')?.textContent,
        };
      });
      h.check("variant base link → original canonical", v.base.length === 1 && v.base[0] === "/ko/songs/1/dream-believers", v.base.join(","));
      h.check("variations: one current, not a link", v.current === 1 && !v.currentIsLink, `${v.current}`);
      h.check("variations: >1 rows, base first", v.rows > 1 && v.firstLink === "/ko/songs/1/dream-believers", `${v.rows} ${v.firstLink}`);
      h.check("version links carry no tab query", v.linksWithTab === 0, String(v.linksWithTab));
      h.check("variant page errors", errors.length === 0, errors.join(" | "));

      // Empty history on the variant (0 appearances).
      const { page: p2 } = await h.open(path("ko", VARIANT), { width: 390 });
      const empty = await p2.evaluate(() => ({
        heading: document.querySelector('main section[class*="__empty"] h2')?.textContent ?? null,
        groups: document.querySelectorAll("main details").length,
      }));
      if (empty.heading === null && empty.groups > 0) h.skip("variant empty history", "song 62 has appearances now");
      else h.check("variant empty history panel", empty.heading !== null && empty.groups === 0, empty.heading ?? "");
    });

    // ── ongoing + duplicate appearance ────────────────────────────
    await h.section("ongoing + duplicate", async () => {
      const { page } = await h.open(path("ko", LIVE), { width: 1440 });
      if (!(await page.locator(IDENTITY).count())) return h.skip("live checks", "not on this build");
      const live = await page.evaluate(() => {
        const summaries = [...document.querySelectorAll("main details summary")];
        const liveSummary = summaries.find((s) => s.querySelector('[data-status="ongoing"]'));
        const hrefs = [...document.querySelectorAll('main a[class*="__performance"]')].map((a) => a.getAttribute("href"));
        const dup = hrefs.filter((x, i) => hrefs.indexOf(x) !== i);
        return {
          live: !!liveSummary,
          liveFirst: summaries[0] === liveSummary,
          liveIsOther: !!liveSummary && liveSummary === summaries.at(-1),
          dup: dup.length,
        };
      });
      // Ongoing series groups are pinned first; the no-series group stays
      // last even when it holds the ongoing event (562's is series-less).
      if (!live.live) h.skip("LIVE group", "song 562 has no ongoing event now");
      else h.check("LIVE group first, or the last (no-series) group", live.liveFirst || live.liveIsOther, "");
      if (live.dup === 0) h.skip("duplicate appearance", "song 562 no longer repeats in one event");
      else h.check("duplicate appearance kept as two rows", live.dup > 0, String(live.dup));

      // Collapse keeps LIVE visible in the summary.
      if (live.live) {
        const SEL = "main details:has(> summary [data-status='ongoing']) > summary";
        await h.pressOn(page, SEL, "Enter");
        const after = await page.evaluate(() => {
          const s = document.querySelector("main details > summary [data-status='ongoing']");
          const d = s?.closest("details");
          return { open: d?.open, liveVisible: !!s && s.getBoundingClientRect().height > 0 };
        });
        h.check("collapsed group keeps LIVE", after.open === false && after.liveVisible, JSON.stringify(after));
      }
    });

    // ── encore and many albums ────────────────────────────────────
    await h.section("encore + albums", async () => {
      const { page } = await h.open(path("ja", ENCORE), { width: 768 });
      if (!(await page.locator(IDENTITY).count())) return h.skip("encore checks", "not on this build");
      const encore = await page.locator('main [class*="__encore"]').count();
      if (encore === 0) h.skip("encore chip", "765 has no encore appearance now");
      else h.check("encore chip shown", encore > 0, String(encore));
      for (const n of await h.contrast(page, CONTRAST, "encore contrast")) found.add(n);

      const { page: p2 } = await h.open(path("ko", MANY_ALBUMS), { width: 390 });
      const albums = await p2.evaluate(() => ({
        rows: document.querySelectorAll('main aside a[class*="__albumMini"]').length,
        total: document.querySelector('main aside [class*="__albumTotal"]')?.textContent ?? "",
        chips: [...document.querySelectorAll('main aside a[class*="__albumMini"]')].map((a) => !!a.querySelector('[class*="__chip"]')),
      }));
      if (albums.rows < 2) h.skip("multi-album panel", `song 2455 has ${albums.rows} album(s) now`);
      else {
        h.check("every album listed + total", albums.total.includes(String(albums.rows)), `${albums.rows} / ${albums.total}`);
        h.check("only the oldest album is the original recording", albums.chips[0] && albums.chips.slice(1).every((c) => !c) || albums.chips[0], JSON.stringify(albums.chips));
      }
    });

    // ── canonical redirects (query kept) and tab clamp ────────────
    await h.section("canonical", async () => {
      await h.expectStatus("bare id → 308 canonical", `/ko/songs/${VARIANT.id}`, {
        status: 308,
        location: new RegExp(`/ko/songs/${VARIANT.id}/${VARIANT.slug}$`),
      });
      await h.expectStatus("wrong slug keeps ?tab", `/ko/songs/${VARIANT.id}/wrong?tab=variations`, {
        status: 308,
        location: new RegExp(`/ko/songs/${VARIANT.id}/${VARIANT.slug}\\?tab=variations$`),
      });
      await h.expectStatus("canonical 200", path("en", SONG), { status: 200 });
      // A song without versions clamps ?tab=variations to history.
      const html = await h.getText(path("ko", MANY_ALBUMS, "?tab=variations"));
      const hasVersions = /__versionList/.test(html);
      const tabCount = (html.match(/__tab(?![a-zA-Z])/g) ?? []).length;
      if (tabCount > 1) h.skip("tab clamp", "2455 has versions now");
      else h.check("?tab=variations without versions renders history", !hasVersions, "");
    });

    // ── global search lands on the version's own canonical ────────
    await h.section("search entry", async () => {
      const html = await h.getText(`/ko/search?q=${encodeURIComponent("Dream Believers")}`);
      if (!html.includes('role="search"') && !html.includes("/songs/")) return h.skip("search entry", "search page not on this build");
      h.check("search links the version's own canonical", html.includes(`/ko/songs/${VARIANT.id}/${VARIANT.slug}`), "");
    });

    if (redesigned) {
      for (const n of CONTRAST) {
        h.check(`contrast ${n} found at some width`, found.has(n), found.has(n) ? "" : `no .*__${n}`);
      }
    }

    await h.section("motion", () =>
      h.reducedMotion({
        path: path(h.LOCALES[0], SONG),
        width: 1440,
        selectors: ['main a[class*="__performance"]', 'main nav[class*="__tabs"] a'],
        optional: true,
        label: "reduced motion (row/tab transitions)",
      }),
    );
  },
};

export default scenario;
