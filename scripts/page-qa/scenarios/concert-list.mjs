// Concert-list regression boundary. Reads the app; optional new-row fixtures
// are created/removed separately under the shared dev-DB slot protocol.
const ROW = "main a[data-status]";
const FILTER = "main header + nav a";

async function markContrast(page) {
  // The page uses Tailwind rather than CSS modules. Add inert diagnostic
  // class names so the shared contrast helper can read the original styles.
  await page.evaluate(() => {
    const mark = (sel, name) => document.querySelectorAll(sel).forEach((el) => el.classList.add(`qa__${name}`));
    mark("main h1, main h3, main h4", "title");
    mark("main a[data-status] p", "metadata");
    mark("main a[data-status] time", "date");
    mark("main header + nav a", "filter");
    mark('main a[data-status] time + div > span', "status");
  });
}

async function rowState(page) {
  return page.locator(ROW).evaluateAll((rows) => rows.map((row) => ({
    href: row.getAttribute("href"), status: row.dataset.status,
    iso: row.querySelector("time").dateTime, date: row.querySelector("time").textContent,
  })));
}

const scenario = {
  name: "concert-list",
  async run(h) {
    await h.layoutMatrix({
      path: (loc) => `/${loc}/events`, basics: true, capture: true,
      cell: async ({ page, loc, width, name, check }) => {
        const rows = await rowState(page);
        check(name("canonical single row links"), rows.length > 0 && rows.every((r) =>
          r.href.startsWith(`/${loc}/events/`) && /^\d+\/[a-z0-9_-]+$/.test(r.href.split("/events/")[1])), `${rows.length} rows`);
        const cut = await h.clipped(page, ["main h1", "main h3", "main h4", `${ROW} p`]);
        check(name("titles and metadata wrap"), cut.length === 0, JSON.stringify(cut));
        const layout = await page.evaluate(() => {
          const rows = [...document.querySelectorAll("main a[data-status]")];
          return {
            artLeft: rows.every((r) => r.querySelector('[data-testid="event-art"]').getBoundingClientRect().right <= r.querySelector("h4").getBoundingClientRect().left + 1),
            title: getComputedStyle(document.querySelector("main h1")).fontSize,
            filters: [...document.querySelectorAll("main header + nav a")].map((a) => ({ h: a.getBoundingClientRect().height, current: a.getAttribute("aria-current") })),
            liveGroups: [...document.querySelectorAll("main section[data-live]")].map((s) => ({ rows: s.querySelectorAll('a[data-status="ongoing"]').length, toggles: s.querySelectorAll("button").length })),
          };
        });
        check(name("art left, full UTC year, title scale"), layout.artLeft && rows.every((r) => /\d{4}/.test(r.date)) && layout.title === (width < 700 ? "26px" : "32px"), JSON.stringify(layout));
        check(name("four 44px filters, one selected"), layout.filters.length === 4 && layout.filters.every((f) => f.h >= 44) && layout.filters.filter((f) => f.current === "page").length === 1, JSON.stringify(layout.filters));
        if (layout.liveGroups.length) check(name("LIVE groups stay expanded"), layout.liveGroups.every((g) => g.rows > 0 && g.toggles === 0), JSON.stringify(layout.liveGroups));
        else h.skip(name("LIVE group"), "no ongoing event in current data");
        if ([390, 1440].includes(width)) {
          await markContrast(page);
          await h.contrast(page, ["title", "metadata", "date", "filter", "status"], name("contrast"));
          await h.focusRing(page, name("row focus"), ROW, /solid 3px rgb\(23, 79, 175\)/);
          await h.focusRing(page, name("filter focus"), FILTER, /solid 3px rgb\(23, 79, 175\)/);
        }
      },
    });

    for (const loc of h.LOCALES) {
      await h.section(`${loc} filters, pages, history`, async () => {
        const { page } = await h.open(`/${loc}/events?pastPage=2`, { width: 390 });
        await h.afterNav(page, {
          url: (u) => u.search === "?filter=completed",
          ready: `${FILTER}[aria-current="page"][href$="filter=completed"]`.replace("main ", ""),
          action: () => h.pressOn(page, `${FILTER}[href$="filter=completed"]`),
        });
        // afterNav's filter marker alone may precede the final rows; the
        // active heading disappearing confirms the completed-page content.
        await page.waitForFunction(() => document.querySelectorAll("main h2").length === 1);
        h.check(`${loc} completed past only`, (await rowState(page)).every((r) => ["completed", "cancelled"].includes(r.status)), "");
        const next = page.locator('main nav a[href*="pastPage=2"]').last();
        if (await next.count()) {
          await h.afterNav(page, { url: /pastPage=2/, ready: 'nav a[aria-current="page"][href*="pastPage=2"]', action: () => next.click() });
          const hrefs = await page.locator('main nav a[href*="pastPage="]').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
          h.check(`${loc} pagination preserves filter`, hrefs.length > 0 && hrefs.every((x) => x.includes("filter=completed")), hrefs.join(" "));
        } else h.skip(`${loc} past pagination`, "only one page of past groups");
        await h.afterNav(page, { url: (u) => u.search === "?filter=upcoming", ready: 'header + nav a[aria-current="page"][href$="filter=upcoming"]', action: () => h.pressOn(page, `${FILTER}[href$="filter=upcoming"]`) });
        await page.waitForFunction(() => [...document.querySelectorAll("main a[data-status]")].every((a) => a.dataset.status === "upcoming"));
        const upcoming = await rowState(page);
        h.check(`${loc} upcoming filter and page reset`, !new URL(page.url()).searchParams.has("pastPage") && upcoming.every((r) => r.status === "upcoming"), String(upcoming.length));
        await h.afterNav(page, { url: /filter=completed/, ready: 'header + nav a[aria-current="page"][href$="filter=completed"]', action: () => page.goBack() });
        h.check(`${loc} browser history restores filter`, new URL(page.url()).searchParams.get("filter") === "completed", page.url());
        const bound = await h.open(`/${loc}/events?filter=completed&pastPage=999999`, { width: 1440 });
        const current = bound.page.locator('main nav a[aria-current="page"][href*="pastPage="]');
        if (await current.count()) {
          const n = Number(await current.textContent());
          h.check(`${loc} excessive page clamps last`, n > 0 && await bound.page.locator(`main nav a[href*="pastPage=${n + 1}"]`).count() === 0, String(n));
          const invalid = await h.open(`/${loc}/events?pastPage=abc`, { width: 390 });
          h.check(`${loc} invalid page is first`, await invalid.page.locator('main nav a[aria-current="page"][href*="pastPage="]').textContent() === "1", "");
        } else h.skip(`${loc} page bounds`, "single past page");
        const canonical = await bound.page.locator('link[rel="canonical"]').getAttribute("href");
        h.check(`${loc} filter URL canonical consolidates`, new URL(canonical).pathname === `/${loc}/events` && !new URL(canonical).search, canonical);
      });
    }

    await h.section("collapse and date timezone", async () => {
      const { page } = await h.open("/ko/events", { width: 390 });
      const toggle = page.locator("main section:not([data-live]) button[aria-controls]").first();
      if (await toggle.count()) {
        h.check("collapse positive control", await toggle.getAttribute("aria-expanded") === "true", "");
        await h.pressOn(page, "main section:not([data-live]) button[aria-controls]", "Enter");
        h.check("keyboard collapse hides rows", await toggle.getAttribute("aria-expanded") === "false" && await page.locator(`[id=${JSON.stringify(await toggle.getAttribute("aria-controls"))}]`).isHidden(), "");
        await toggle.press("Space");
        h.check("Space expands group", await toggle.getAttribute("aria-expanded") === "true", "");
      } else h.skip("collapse", "no non-LIVE groups");
      const utc = await rowState(page);
      for (const timezoneId of ["America/Los_Angeles", "Asia/Tokyo"]) {
        const other = await h.open("/ko/events", { width: 390, timezoneId });
        h.check(`UTC row dates invariant in ${timezoneId}`, JSON.stringify(await rowState(other.page)) === JSON.stringify(utc), "ISO/status/date/href sequence");
      }
    });
    await h.section("motion", () => h.reducedMotion({ path: "/ko/events", width: 390, selectors: [`${FILTER}`, "main section button svg"] }));
  },

  fixture: {
    needs: ["live", "future", "cancel", "pastcancel", "broken", "plain"],
    about: "new Consistency06 rows: mixed LIVE/upcoming/cancelled, past cancelled, inherited failed logo, typography; no real record changed",
    async run(h, fx) {
      for (const loc of h.LOCALES) for (const width of [390, 1440]) {
        await h.section(`fixture ${loc}/${width}`, async () => {
          const { page } = await h.open(`/${loc}/events`, { width });
          const find = (id) => page.locator(`main a[data-status][href*="/events/${id}/"]`);
          const live = find(fx.live);
          await live.waitFor();
          h.check(`${loc}/${width} LIVE fixture and mixed root`, await live.getAttribute("data-status") === "ongoing" && await live.locator("xpath=ancestor::section").locator(`a[href*="/events/${fx.future}/"]`).count() === 1, "");
          h.check(`${loc}/${width} future cancelled in All`, await find(fx.cancel).getAttribute("data-status") === "cancelled", "");
          await page.locator(`a[href*="/events/${fx.broken}/"] [data-testid="event-art"][data-state="fallback"]`).waitFor();
          h.check(`${loc}/${width} failed selected logo falls back`, await find(fx.broken).locator("img").count() === 0, "selected invalid URL, no ancestor retry");
          h.check(`${loc}/${width} explicit typography reserves slot`, await find(fx.plain).locator('[data-testid="event-art"][data-state="fallback"]').count() === 1, "");
          const cut = await h.clipped(page, ["main h4", "main h3"]);
          h.check(`${loc}/${width} fixture long names wrap`, cut.length === 0, JSON.stringify(cut));
          await h.shot(page, `fixture-${loc}-${width}`);
          const upcoming = await h.open(`/${loc}/events?filter=upcoming`, { width });
          h.check(`${loc}/${width} Upcoming excludes LIVE/cancelled with positive controls`, await upcoming.page.locator(`a[href*="/events/${fx.future}/"]`).count() === 1 && await upcoming.page.locator(`a[href*="/events/${fx.live}/"],a[href*="/events/${fx.cancel}/"]`).count() === 0, "");
          const completed = await h.open(`/${loc}/events?filter=completed`, { width });
          h.check(`${loc}/${width} past cancellation retained`, await completed.page.locator(`a[data-status="cancelled"][href*="/events/${fx.pastcancel}/"]`).count() === 1, "fixture past group first");
        });
      }
    },
  },
};
export default scenario;
