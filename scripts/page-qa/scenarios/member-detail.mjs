// Member detail page (redesign ticket 31, approved packet 30-v1): identity
// card, overview / songs / history tabs, history <details> groups,
// canonical slug, empty and white-colour members.
//
// Selectors are CSS-module class substrings (`[class*="identity"]`): the
// module class names keep their source name as a prefix in builds.
//
// Data expectations are the shared dev DB as of 2026-10-22. Counts are not
// hard-coded: the metrics are checked against the tab labels and the row
// counts, so a new setlist row does not break the run.
//   ceras-yanagida  >3 songs and >3 events (both view-alls), VA, unit
//   sonoda-umi      no songs, no events (empty state)
//   sasaki-shion    personal colour #ffffff (rim must stay visible)
//
// States no dev record shows (missing translations, no colour/VA/unit, VA
// periods, mixed statuses) are covered by
// src/__tests__/unit/member-detail-page.test.tsx.
const CERAS = "/members/37d5f9a8-9132-4993-9610-5ae861dca76d/ceras-yanagida";
const UMI = "/members/ea68f46d-7e4a-4ab9-bb83-a5599f9bf45d/sonoda-umi";
const SHION = "/members/f5816244-dcca-496e-bce7-241b7b53927e/sasaki-shion";
const TABS = 'nav[class*="tabs"] a';
// Solid text/background pairs by CSS-module class suffix (h.contrast).
const CONTRAST = ["eyebrow", "subtitle", "unitLink", "voiceLabel", "unitTag", "status", "more", "eventSeries"];
const CONTRAST_WIDTHS = [390, 1440];

const scenario = {
  name: "member-detail",

  async run(h) {
    const found = new Set();

    // 1) Layout matrix — Ceras overview. Identity: VA column beside the
    // name from 768, stacked below. Overview: two panels from 768.
    await h.layoutMatrix({
      path: (loc) => `/${loc}${CERAS}`,
      basics: true,
      capture: true,
      cell: async ({ page, width, name, check }) => {
        const l = await page.evaluate((tabs) => {
          const cols = (s) => {
            const el = document.querySelector(s);
            return el ? getComputedStyle(el).gridTemplateColumns.split(" ").length : 0;
          };
          const h1 = document.querySelector("main h1");
          return {
            identity: cols('section[class*="identity"]'),
            overview: cols('div[class*="overview"]'),
            h1Clamp: h1 ? getComputedStyle(h1).textOverflow : "",
            tabs: [...document.querySelectorAll(tabs)].map((a) => ({
              cur: a.getAttribute("aria-current"),
              h: Math.round(a.getBoundingClientRect().height),
            })),
          };
        }, TABS);
        const exp = width >= 768 ? 2 : 1;
        check(name(`identity + overview columns ${exp}`), l.identity === exp && l.overview === exp, `identity ${l.identity} overview ${l.overview}`);
        check(name("h1 not clamped"), l.h1Clamp !== "ellipsis", l.h1Clamp);
        check(
          name("tabs ≥44px, overview current"),
          l.tabs.length === 3 && l.tabs.every((t) => t.h >= 44) && l.tabs[0].cur === "page",
          JSON.stringify(l.tabs.map((t) => t.h)),
        );
        if (CONTRAST_WIDTHS.includes(width)) {
          for (const n of await h.contrast(page, CONTRAST, name("contrast"))) found.add(n);
        }
      },
    });
    // Positive control for contrast SKIPs (status/eventSeries live on the
    // overview, so every pair should be found at some width).
    for (const n of CONTRAST) {
      h.check(`contrast ${n} found at some width`, found.has(n), found.has(n) ? "" : `no .*__${n} — typo or renamed class?`);
    }

    // 2) Overview inventory: metrics agree with the tabs, three rows per
    // panel, two view-alls with distinct accessible names.
    await h.section("overview", async () => {
      const { page } = await h.open(`/ko${CERAS}`, { hydrate: null });
      const inv = await page.evaluate((tabs) => {
        const all = (s) => [...document.querySelectorAll(s)];
        const num = (s) => Number((s.match(/\d+/) ?? ["-1"])[0]);
        return {
          stats: all('dl[class*="metrics"] dd').map((d) => Number(d.textContent)),
          tabCounts: all(tabs).map((a) => num(a.textContent)),
          songs: all('a[class*="songRow"]').length,
          events: all('a[class*="eventRow"]').length,
          more: all('a[class*="more"]').map((a) => [a.getAttribute("aria-label"), a.textContent, a.getAttribute("href")]),
          unitHref: document.querySelector('a[class*="unitLink"]')?.getAttribute("href"),
          crumbs: all('main nav[aria-label] a').map((a) => a.getAttribute("href")),
          avatar: document.querySelector('[class*="avatar"]')?.textContent,
          ellipsis: all("main *").filter((el) => getComputedStyle(el).textOverflow === "ellipsis").length,
        };
      }, TABS);
      h.check(
        "overview: metrics = tab counts (events, songs)",
        inv.stats.length === 3 && inv.stats[0] === inv.tabCounts[2] && inv.stats[2] === inv.tabCounts[1] && inv.stats[1] <= inv.stats[0],
        JSON.stringify([inv.stats, inv.tabCounts]),
      );
      h.check("overview: 3 songs + 3 events", inv.songs === 3 && inv.events === 3, JSON.stringify([inv.songs, inv.events]));
      h.check(
        "overview: two view-alls, distinct names containing the visible text",
        inv.more.length === 2 &&
          inv.more[0][0] !== inv.more[1][0] &&
          inv.more.every(([label, text]) => label.includes(text.replace("›", "").trim())) &&
          /tab=songs$/.test(inv.more[0][2]) &&
          /tab=history$/.test(inv.more[1][2]),
        JSON.stringify(inv.more),
      );
      h.check("overview: unit link canonical", /^\/ko\/artists\/\d+\/[a-z0-9-]+$/.test(inv.unitHref ?? ""), inv.unitHref);
      h.check("breadcrumb: home + group", inv.crumbs.length === 2 && /^\/ko\/artists\/\d+\/[a-z0-9-]+$/.test(inv.crumbs[1]), inv.crumbs.join(" "));
      h.check("avatar: original-script initial", inv.avatar === "セ", inv.avatar);
      h.check("no ellipsis in main", inv.ellipsis === 0, inv.ellipsis);
    });

    // 3) Tabs + history groups: canonical links, keyboard, <details> toggle,
    // inset focus ring on the last row.
    await h.section("tabs + history", async () => {
      const { page } = await h.open(`/ko${CERAS}`, { hydrate: 'nav[class*="tabs"]' });
      const hrefs = await page.$$eval(TABS, (as) => as.map((a) => a.getAttribute("href")));
      h.check(
        "tabs: canonical ?tab links",
        hrefs.join() === ["overview", "songs", "history"].map((t) => `/ko${CERAS}?tab=${t}`).join(),
        hrefs.join(),
      );
      await Promise.all([page.waitForURL(/tab=history/), h.pressOn(page, `${TABS}:nth-child(3)`)]);
      await page.waitForSelector('details[class*="historyGroup"]');
      const g = await page.evaluate(() => {
        const groups = [...document.querySelectorAll('details[class*="historyGroup"]')];
        return {
          n: groups.length,
          open: groups.every((d) => d.open),
          rows: groups.reduce((s, d) => s + d.querySelectorAll('a[class*="eventRow"]').length, 0),
          title: document.querySelector('h2[class*="historyTitle"]')?.textContent ?? "",
        };
      });
      h.check("history: groups open, rows = header count", g.n >= 2 && g.open && g.title.includes(String(g.rows)), JSON.stringify(g));
      const summary = page.locator('summary[class*="groupSummary"]').first();
      await summary.focus();
      await page.keyboard.press("Enter");
      const closed = await page.locator('details[class*="historyGroup"]').first().evaluate((d) => d.open);
      await page.keyboard.press("Enter");
      const reopened = await page.locator('details[class*="historyGroup"]').first().evaluate((d) => d.open);
      h.check("history: summary toggles via keyboard", closed === false && reopened === true, JSON.stringify([closed, reopened]));
      const lastRow = page.locator('details[class*="historyGroup"]').last().locator('a[class*="eventRow"]').last();
      await lastRow.focus();
      await page.keyboard.press("Shift");
      const ring = await lastRow.evaluate((a) => {
        const cs = getComputedStyle(a);
        return { off: cs.outlineOffset, w: cs.outlineWidth, style: cs.outlineStyle };
      });
      h.check("history: last row focus ring inset", ring.off === "-5px" && ring.w === "3px" && ring.style !== "none", JSON.stringify(ring));
      // Locale switch keeps ?tab (06 LanguageSwitcher reads location.search).
      await Promise.all([page.waitForURL(/\/ja\/members\/.*tab=history/), h.pressOn(page, 'header button[lang="ja"]')]);
      h.check("locale switch keeps ?tab=history", /\/ja\/members\/.*\?tab=history$/.test(page.url()), page.url());
    });

    // 4) Empty member and white personal colour.
    await h.section("empty + white colour", async () => {
      let { page } = await h.open(`/ko${UMI}`, { width: 390, hydrate: null });
      const empty = await page.evaluate(() => ({
        stats: [...document.querySelectorAll('dl[class*="metrics"] dd')].map((d) => d.textContent),
        empties: document.querySelectorAll('p[class*="empty"]').length,
        more: document.querySelectorAll('a[class*="more"]').length,
      }));
      h.check("empty: 0/0/0, both panels empty, no view-all", empty.stats.join() === "0,0,0" && empty.empties === 2 && empty.more === 0, JSON.stringify(empty));
      ({ page } = await h.open(`/ko${UMI}?tab=history`, { width: 390, hydrate: null }));
      const hist = await page.$$eval('p[class*="empty"]', (p) => p.length);
      h.check("empty: history tab message", hist === 1, hist);

      ({ page } = await h.open(`/ko${SHION}`, { width: 390, hydrate: null }));
      const rim = await page.$eval('[class*="avatar"]', (a) => getComputedStyle(a).borderTopColor);
      h.check("white colour: avatar rim stays visible", rim !== "rgb(255, 255, 255)" && !/rgba?\(255, 255, 255/.test(rim), rim);
    });

    await h.section("canonical + 404", async () => {
      await h.expectStatus("canonical: bare id → 308 to slug, query kept", "/ko/members/37d5f9a8-9132-4993-9610-5ae861dca76d?tab=history", {
        status: 308,
        location: /\/ko\/members\/37d5f9a8-9132-4993-9610-5ae861dca76d\/ceras-yanagida\?tab=history$/,
      });
      await h.expectStatus("canonical: wrong slug → 308", "/ko/members/37d5f9a8-9132-4993-9610-5ae861dca76d/wrong", { status: 308 });
      await h.expectStatus("missing member → 404", "/ko/members/00000000-0000-4000-8000-000000000000/x", { status: 404 });
      const html = await h.getText(`/ja${CERAS}`);
      h.check(
        "metadata: canonical + x-default",
        /rel="canonical" href="[^"]*\/ja\/members\/37d5f9a8-9132-4993-9610-5ae861dca76d\/ceras-yanagida"/.test(html) && /hreflang="x-default"/i.test(html),
      );
    });

    await h.section("motion + dates", async () => {
      await h.reducedMotion({ path: `/ko${CERAS}`, selectors: ['a[class*="songRow"]', 'a[class*="unitLink"]'] });
      // Event.date is a UTC calendar date; Seoul (UTC+9) sees the same day.
      const { page } = await h.open(`/ko${CERAS}`, { width: 390, timezoneId: "Asia/Seoul", hydrate: null });
      const d = await page.$eval('a[class*="eventRow"] time', (t) => [t.textContent, t.getAttribute("datetime")]);
      h.check("dates: UTC date unchanged in Seoul TZ", d[0].replace(/\D/g, "") === d[1].replace(/\D/g, ""), d.join(" "));
    });
  },
};

export default scenario;
