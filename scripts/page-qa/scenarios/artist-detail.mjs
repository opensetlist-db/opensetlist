// Artist detail page (redesign ticket 21): overview / albums / history
// tabs, unit and member grids, original-language name, canonical slug.
//
// Selectors are CSS-module class substrings (`[class*="overview"]`): the
// page carries no test ids beyond the cover image, and the module class
// names keep their source name as a prefix in production builds.
//
// Data expectations are the shared dev DB as of 2026-10-21:
//   1  蓮ノ空 (hasunosora)   9 units, 11 members, 31 albums, 49 events,
//                            47 songs; has an en translation
//   2  its first unit card   (breadcrumb back to 1)
//   4  kozue-solo            no albums
//   23 teseuteuatiseuteu     no events; no en name (falls back to ja)
//   24 nijigasaki            ja name is the original language
// A dev DB change to these rows shows up here as a FAIL with the counts in
// the detail; update the numbers, not the checks.
//
// Fixture (--fixture <json>, keys below): an artist made for this run with
// two albums, one with a cover that loads and one whose cover URL is
// broken. Create and delete it yourself while holding the dev DB slot.
const A1 = "/artists/1/hasunosora";
const TABS = 'nav[class*="tabs"] a';

const scenario = {
  name: "artist-detail",

  async run(h) {
    // 1) Layout matrix — artist 1 overview. Overview: one column below 768,
    // two from 768 with a 310px side column, 360px from 1100. Members: two
    // columns on phones, one in the narrow tablet side column, two again at
    // 1100+.
    await h.layoutMatrix({
      path: (loc) => `/${loc}${A1}`,
      cell: async ({ page, width, name, check }) => {
        const l = await page.evaluate((tabs) => {
          const overview = document.querySelector('[class*="overview"]');
          const grid = document.querySelector('ul[class*="memberGrid"]');
          return {
            cols: overview ? getComputedStyle(overview).gridTemplateColumns.split(" ").length : 0,
            side: Math.round(overview?.children[1]?.getBoundingClientRect().width ?? 0),
            memberCols: grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 0,
            tabs: [...document.querySelectorAll(tabs)].map((a) => ({
              cur: a.getAttribute("aria-current"),
              h: Math.round(a.getBoundingClientRect().height),
            })),
          };
        }, TABS);
        const expCols = width >= 768 ? 2 : 1;
        const expSide = width >= 1100 ? 360 : width >= 768 ? 310 : null;
        const expMember = width >= 1100 ? 2 : width >= 768 ? 1 : 2;
        check(name(`overview columns ${expCols}`), l.cols === expCols && (expSide === null || l.side === expSide), `cols ${l.cols} side ${l.side}`);
        check(name(`member columns ${expMember}`), l.memberCols === expMember, l.memberCols);
        check(
          name("tabs ≥44px, overview current"),
          l.tabs.length === 3 && l.tabs.every((t) => t.h >= 44) && l.tabs[0].cur === "page",
          JSON.stringify(l.tabs.map((t) => t.h)),
        );
      },
    });

    // 2) Tabs: canonical links, keyboard navigation, history alignment and
    // focus, group toggle.
    await h.section("tabs + history", async () => {
      const { page } = await h.open(`/ko${A1}`, { hydrate: 'nav[class*="tabs"]' });
      const hrefs = await page.$$eval(TABS, (as) => as.map((a) => a.getAttribute("href")));
      h.check(
        "tabs: canonical ?tab links",
        hrefs.join() === ["overview", "albums", "history"].map((t) => `/ko${A1}?tab=${t}`).join(),
        hrefs.join(),
      );
      await Promise.all([page.waitForURL(/tab=history/), h.pressOn(page, `${TABS}:nth-child(3)`)]);
      await page.waitForSelector('[class*="historyGroup"]');
      const cur = await page.$eval(`${TABS}[aria-current="page"]`, (a) => a.textContent);
      h.check("tabs: Enter navigates, aria-current moves", /49/.test(cur), cur);
      const scrollY = await page.evaluate(() => scrollY);
      h.check("tabs: scroll=false keeps position near top", scrollY < 400, scrollY);
      const align = await page.evaluate(() => {
        const g = document.querySelector('[class*="historyGroup"]');
        const heads = g.querySelectorAll('[class*="historyColumns"] span');
        const row = g.querySelector('a[class*="eventRow"]');
        const x = (el) => el.getBoundingClientRect().left;
        return {
          d: Math.round(x(heads[0]) - x(row.querySelector('[class*="eventMeta"]'))),
          s: Math.round(x(heads[2]) - x(row.querySelector('[class*="songCount"]'))),
        };
      });
      h.check("history: column heading aligns with row (date, songs)", Math.abs(align.d) <= 1 && Math.abs(align.s) <= 1, JSON.stringify(align));
      // Last row of the last group: the inset focus ring stays inside the card.
      const lastRow = page.locator('[class*="historyGroup"]').last().locator('a[class*="eventRow"]').last();
      await lastRow.focus();
      await page.keyboard.press("Shift");
      const ring = await lastRow.evaluate((a) => {
        const cs = getComputedStyle(a);
        return { off: cs.outlineOffset, w: cs.outlineWidth, style: cs.outlineStyle };
      });
      h.check("history: last row focus ring inset", ring.off === "-3px" && ring.w === "3px" && ring.style !== "none", JSON.stringify(ring));
      const btn = page.locator('[class*="groupToggle"]').first();
      await btn.focus();
      await page.keyboard.press("Enter");
      const collapsed = await btn.evaluate((b) => [b.getAttribute("aria-expanded"), document.getElementById(b.getAttribute("aria-controls")).hidden]);
      await page.keyboard.press("Enter");
      const expanded = await btn.getAttribute("aria-expanded");
      h.check(
        "history: group toggle via keyboard",
        collapsed[0] === "false" && collapsed[1] === true && expanded === "true",
        JSON.stringify([collapsed, expanded]),
      );
      const groups = await page.$$eval('[class*="historyGroup"] [class*="groupName"]', (s) => s.length);
      h.check("history: groups rendered", groups >= 2, groups);
    });

    // 3) Overview inventory and interactions.
    await h.section("overview", async () => {
      const { page } = await h.open(`/ko${A1}`, { hydrate: 'button[class*="toggle"]' });
      const inv = await page.evaluate(() => {
        const all = (s) => [...document.querySelectorAll(s)];
        return {
          units: all('a[class*="unitCard"]').length,
          unitsVisible: all('a[class*="unitCard"]').filter((a) => a.offsetParent).length,
          members: all('a[class*="member"][href*="/members/"]').length,
          albums: all('a[class*="albumRow"]').length,
          events: all('a[class*="eventRow"]').length,
          more: all('a[class*="more"]').map((a) => [a.getAttribute("aria-label"), a.getAttribute("href")]),
          stats: all('dl[class*="stats"] dd').map((d) => d.textContent),
          unitHref: document.querySelector('a[class*="unitCard"]')?.getAttribute("href"),
          memberHref: document.querySelector('a[href*="/members/"]')?.getAttribute("href"),
          coverHidden: document.querySelector('[data-testid="cover-image"]')?.getAttribute("aria-hidden"),
          initials: all('[class*="initial"]').map((s) => s.textContent).slice(0, 3),
        };
      });
      h.check(
        "overview: 9 units (4 visible), 11 members, 3 albums, 3 events",
        inv.units === 9 && inv.unitsVisible === 4 && inv.members === 11 && inv.albums === 3 && inv.events === 3,
        JSON.stringify([inv.units, inv.unitsVisible, inv.members, inv.albums, inv.events]),
      );
      h.check("overview: stats 49/47/9", inv.stats.join() === "49,47,9", inv.stats.join());
      h.check(
        "overview: distinct view-all names",
        inv.more.length === 2 && inv.more[0][0] !== inv.more[1][0] && /tab=albums/.test(inv.more[0][1]) && /tab=history/.test(inv.more[1][1]),
        JSON.stringify(inv.more),
      );
      h.check(
        "overview: canonical unit/member links",
        /^\/ko\/artists\/\d+\/[a-z0-9-]+$/.test(inv.unitHref ?? "") && /^\/ko\/members\/[0-9a-f-]+\/[a-z0-9-]+$/.test(inv.memberHref ?? ""),
        `${inv.unitHref} ${inv.memberHref}`,
      );
      h.check("overview: cover decorative", inv.coverHidden === "true", inv.coverHidden);
      h.check(
        "overview: initials single grapheme",
        inv.initials.every((s) => [...new Intl.Segmenter().segment(s)].length === 1),
        inv.initials.join(),
      );
      await h.pressOn(page, 'button[class*="toggle"]');
      const vis = await page.$$eval('a[class*="unitCard"]', (as) => as.filter((a) => a.offsetParent).length);
      const exp = await page.getAttribute('button[class*="toggle"]', "aria-expanded");
      h.check("overview: other units toggle opens all 9", vis === 9 && exp === "true", `${vis} ${exp}`);
      // Unit card → its own page, with the parent in the breadcrumb.
      await Promise.all([page.waitForURL(/artists\/2\//), page.locator('a[class*="unitCard"]').first().click()]);
      const crumbs = await page.$$eval("nav[aria-label] a", (as) => as.map((a) => a.getAttribute("href")));
      h.check("unit page: breadcrumb has parent", crumbs.includes(`/ko${A1}`), crumbs.join());
    });

    // 4) Albums tab, empty states, original-language name, canonical/404.
    await h.section("albums + empty + names", async () => {
      let { page } = await h.open(`/ko${A1}?tab=albums`, { hydrate: null });
      const n = await page.$$eval('a[class*="albumRow"]', (a) => a.length);
      const tabLabel = await page.$eval(`${TABS}[aria-current="page"]`, (a) => a.textContent);
      h.check("albums tab: 30 rows (cap), label shows 31", n === 30 && /31/.test(tabLabel), `${n} ${tabLabel}`);

      ({ page } = await h.open("/ko/artists/4/kozue-solo?tab=albums", { width: 390, hydrate: null }));
      const empty = await page.evaluate((tabs) => ({
        msg: document.querySelector('p[class*="empty"]')?.textContent,
        tabs: [...document.querySelectorAll(tabs)].map((a) => a.getAttribute("aria-current")),
        overflow: document.documentElement.scrollWidth <= innerWidth,
      }), TABS);
      h.check(
        "albums deep link with 0 albums: empty message, tab hidden",
        empty.msg === "표시할 앨범이 없습니다" && empty.tabs.length === 2 && empty.tabs.every((c) => c === null) && empty.overflow,
        JSON.stringify(empty),
      );

      ({ page } = await h.open("/en/artists/23/teseuteuatiseuteu", { width: 390, hydrate: null }));
      const fb = await page.evaluate(() => ({
        h1Lang: document.querySelector("h1")?.getAttribute("lang"),
        h1: document.querySelector("h1")?.textContent,
        empty: [...document.querySelectorAll('p[class*="empty"]')].map((p) => p.textContent),
        overflow: document.documentElement.scrollWidth <= innerWidth,
      }));
      h.check("fallback: en page without en name marks lang=ja", fb.h1Lang === "ja", JSON.stringify(fb));
      h.check("empty artist: no-events message, no overflow", fb.empty.length >= 1 && fb.overflow, JSON.stringify(fb.empty));

      ({ page } = await h.open("/ja/artists/24/nijigasaki", { width: 390, hydrate: null }));
      const ja = await page.evaluate(() => ({
        lang: document.querySelector("h1")?.getAttribute("lang"),
        sub: document.querySelector('p[class*="original"]')?.textContent ?? null,
      }));
      h.check("ja page, original-language name: no lang override, no duplicate line", ja.lang === null && ja.sub === null, JSON.stringify(ja));

      ({ page } = await h.open(`/en${A1}`, { hydrate: null }));
      const en = await page.evaluate(() => ({
        lang: document.querySelector("h1")?.getAttribute("lang"),
        subLang: document.querySelector('p[class*="original"]')?.getAttribute("lang"),
      }));
      h.check("en page with translation: original line lang=ja", en.lang === null && en.subLang === "ja", JSON.stringify(en));
    });

    await h.section("canonical + 404", async () => {
      await h.expectStatus("canonical: bare id → 308 to slug, query kept", "/ko/artists/1?tab=history", {
        status: 308,
        location: /\/ko\/artists\/1\/hasunosora\?tab=history$/,
      });
      await h.expectStatus("canonical: wrong slug → 308", "/ko/artists/1/wrong-slug", { status: 308 });
      await h.expectStatus("missing artist → 404", "/ko/artists/999999/x", { status: 404 });
      const html = await h.getText(`/ja${A1}`);
      h.check(
        "metadata: canonical + x-default",
        /rel="canonical" href="[^"]*\/ja\/artists\/1\/hasunosora"/.test(html) && /hreflang="x-default"/i.test(html),
      );
    });

    // 5) Reduced motion (with positive control) and dates in a non-UTC zone.
    await h.section("motion + dates", async () => {
      await h.reducedMotion({ path: `/ko${A1}`, selectors: ['a[class*="unitCard"]', 'button[class*="toggle"]'] });
      // Event.date is a UTC calendar date; a viewer in Seoul (UTC+9) must
      // see the same day, not the next one.
      const { page } = await h.open(`/ko${A1}`, { width: 390, timezoneId: "Asia/Seoul", hydrate: null });
      const date = await page.$eval('a[class*="eventRow"] time', (t) => [t.textContent, t.getAttribute("datetime")]);
      h.check(
        "dates: UTC date rendered in Seoul TZ unchanged",
        /^\d{4}년 \d{1,2}월 \d{1,2}일$/.test(date[0]) && date[0].includes(`${Number(date[1].slice(8, 10))}일`),
        date.join(" "),
      );
    });
  },

  fixture: {
    needs: ["artistId", "slug"],
    about: "artist with one album whose cover loads and one whose cover URL is broken",
    async run(h, fx) {
      for (const width of [1440, 390]) {
        await h.section(`fixture ${width}`, async () => {
          const { page } = await h.open(`/en/artists/${fx.artistId}/${fx.slug}?tab=albums`, { width, hydrate: null });
          // Covers load (or fail and swap to the fallback) on the client
          // after `load`; the ticket 21 run settled within this wait.
          await page.waitForTimeout(1500);
          const st = await page.$$eval('[data-testid="cover-image"]', (cs) =>
            cs.map((c) => [c.dataset.state, Math.round(c.getBoundingClientRect().width), c.querySelector("img")?.referrerPolicy ?? null]),
          );
          const ok = st.find((s) => s[0] === "image");
          h.check(`fixture ${width}: success cover renders, no-referrer`, ok?.[2] === "no-referrer", JSON.stringify(st));
          h.check(
            `fixture ${width}: broken cover → fallback, same geometry`,
            st.some((s) => s[0] === "fallback") && new Set(st.map((s) => s[1])).size === 1,
            JSON.stringify(st),
          );
          h.check(`fixture ${width}: no overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await h.shot(page, `en-${width}-fixture-covers`);
        });
      }
    },
  },
};

export default scenario;
