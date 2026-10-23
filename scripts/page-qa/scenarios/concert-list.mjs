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
    for (const status of ["ongoing", "upcoming", "completed", "cancelled"]) {
      mark(`main a[data-status="${status}"] time + div > span:first-child`, `status-${status}`);
    }
  });
}

async function rowState(page) {
  return page.locator(ROW).evaluateAll((rows) => rows.map((row) => ({
    href: row.getAttribute("href"), status: row.dataset.status,
    iso: row.querySelector("time").dateTime, date: row.querySelector("time").textContent,
  })));
}

async function liveAppearance(h, page, name) {
  const styles = await page.locator(ROW).evaluateAll((rows) => rows.map((row) => {
    const css = getComputedStyle(row);
    const badge = row.querySelector("time + div > span:first-child");
    const dot = badge?.querySelector('[aria-hidden="true"]');
    return { status: row.dataset.status, bg: css.backgroundColor, border: css.borderBottomColor, shadow: css.boxShadow,
      badge: badge ? { bg: getComputedStyle(badge).backgroundColor, fg: getComputedStyle(badge).color, border: getComputedStyle(badge).borderTopColor, dot: dot ? getComputedStyle(dot).backgroundColor : null } : null };
  }));
  const live = styles.filter((s) => s.status === "ongoing");
  if (!live.length) { h.skip(`${name} LIVE appearance`, "no ongoing row"); return; }
  h.check(`${name} approved warm LIVE row and common badge`, live.every((s) =>
    s.bg === "rgb(255, 248, 246)" && s.border === "rgb(240, 196, 188)" && /inset/.test(s.shadow) && /3px 0px/.test(s.shadow) && s.shadow.includes("rgb(229, 71, 59)") &&
    s.badge?.bg === "rgb(255, 241, 238)" && s.badge.fg === "rgb(185, 50, 42)" && s.badge.border === "rgb(242, 184, 174)" && s.badge.dot === "rgb(229, 71, 59)"), JSON.stringify(live));
  const others = styles.filter((s) => s.status !== "ongoing");
  if (others.length) h.check(`${name} ordinary rows retain their surface`, others.every((s) => s.bg === "rgba(0, 0, 0, 0)" && s.border === "rgb(220, 227, 239)" && s.shadow === "none"), JSON.stringify(others.slice(0, 2)));
  else h.skip(`${name} ordinary row control`, "ongoing-only filter");
}

const scenario = {
  name: "concert-list",
  async run(h) {
    const measured = new Set();
    await h.layoutMatrix({
      path: (loc) => `/${loc}/events`, basics: true, capture: true,
      widths: h.quick ? h.WIDTHS : [...h.WIDTHS, 699, 700],
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
          await liveAppearance(h, page, name("visual contract"));
          await markContrast(page);
          for (const role of await h.contrast(page, ["title", "metadata", "date", "filter", "status"], name("contrast"))) measured.add(role);
          await h.focusRing(page, name("row focus"), ROW, /solid 3px rgb\(23, 79, 175\)/);
          await h.focusRing(page, name("filter focus"), FILTER, /solid 3px rgb\(23, 79, 175\)/);
        }
      },
    });
    for (const role of ["title", "metadata", "date", "filter", "status"]) {
      h.check(`contrast ${role} actually measured`, measured.has(role), "required role, not SKIP");
    }

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
        const firstRows = await rowState(page);
        h.check(`${loc} completed past only`, firstRows.length > 0 && firstRows.every((r) => ["completed", "cancelled"].includes(r.status)), "");
        const pageNumbers = await page.locator('main nav a[href*="pastPage="]').evaluateAll((as) => as.map((a) => Number(new URL(a.href).searchParams.get("pastPage"))));
        const lastPage = Math.max(1, ...pageNumbers);
        let priorRows = firstRows;
        let priorSearch = new URL(page.url()).search;
        const next = page.locator('main nav a[href$="pastPage=2"]').last();
        if (await next.count()) {
          await h.afterNav(page, { url: (u) => u.searchParams.get("pastPage") === "2", ready: 'nav a[aria-current="page"][href$="pastPage=2"]', action: () => next.click() });
          const hrefs = await page.locator('main nav:has(a[href*="pastPage="]) a').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
          h.check(`${loc} pagination preserves filter`, hrefs.length > 0 && hrefs.every((x) => x.includes("filter=completed")), hrefs.join(" "));
          priorRows = await rowState(page);
          priorSearch = new URL(page.url()).search;
          h.check(`${loc} page 2 changes actual rows without splitting past rows`, priorRows.length > 0 && priorRows.every((r) => !firstRows.some((f) => f.href === r.href)), JSON.stringify(priorRows.map((r) => r.href)));
        } else h.skip(`${loc} past pagination`, "only one page of past groups");
        await h.afterNav(page, { url: (u) => u.search === "?filter=upcoming", ready: 'header + nav a[aria-current="page"][href$="filter=upcoming"]', action: () => h.pressOn(page, `${FILTER}[href$="filter=upcoming"]`) });
        await page.waitForFunction(() => [...document.querySelectorAll("main a[data-status]")].every((a) => a.dataset.status === "upcoming"));
        const upcoming = await rowState(page);
        if (upcoming.length) h.check(`${loc} upcoming filter`, upcoming.every((r) => r.status === "upcoming"), String(upcoming.length));
        else h.skip(`${loc} upcoming populated control`, "no upcoming event in current data; fixture checks require one");
        if (lastPage > 1) h.check(`${loc} filter drops an existing pastPage`, priorSearch.includes("pastPage=2") && !new URL(page.url()).searchParams.has("pastPage"), `${priorSearch} -> ${new URL(page.url()).search}`);
        await h.afterNav(page, { url: /filter=completed/, ready: 'header + nav a[aria-current="page"][href$="filter=completed"]', action: () => page.goBack() });
        h.check(`${loc} browser history restores filter`, new URL(page.url()).searchParams.get("filter") === "completed", page.url());
        h.check(`${loc} history restores actual page and rows`, new URL(page.url()).search === priorSearch && JSON.stringify(await rowState(page)) === JSON.stringify(priorRows), "canonical ordered row sequence");
        const bound = await h.open(`/${loc}/events?filter=completed&pastPage=999999`, { width: 1440 });
        const current = bound.page.locator('main nav a[aria-current="page"][href*="pastPage="]');
        if (lastPage > 1) h.check(`${loc} clamped pagination remains present`, await current.count() === 1 && (await rowState(bound.page)).length > 0, "page 1 established multiple pages");
        if (await current.count()) {
          const n = Number(await current.textContent());
          const explicitLast = await h.open(`/${loc}/events?filter=completed&pastPage=${lastPage}`, { width: 1440 });
          h.check(`${loc} excessive page clamps actual last rows`, n === lastPage && JSON.stringify(await rowState(bound.page)) === JSON.stringify(await rowState(explicitLast.page)), `${n} expected ${lastPage}`);
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
    await h.section("LIVE dot motion", () => h.reducedMotion({ path: "/ko/events", width: 390, selectors: ['main a[data-status="ongoing"] time + div > span > span[aria-hidden="true"]'], rest: { opacity: "1" }, optional: true }));
  },

  fixture: {
    needs: ["live", "future", "cancel", "pastcancel", "broken", "plain"],
    about: "new Consistency06 rows: mixed LIVE/upcoming/cancelled, past cancelled, inherited failed logo, typography; no real record changed",
    async run(h, fx) {
      for (const loc of h.LOCALES) for (const width of [390, 1440]) {
        await h.section(`fixture ${loc}/${width}`, async () => {
          const failedRequests = [];
          const { page } = await h.open(`/${loc}/events`, { width, beforeNavigate: async ({ page }) => {
            await page.route("https://images.test.invalid/**", async (route) => {
              if (route.request().url().includes("consistency06-inherited")) {
                await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="white"/><text x="40" y="110" font-size="40">QA inherited logo</text></svg>' });
              } else {
                failedRequests.push(route.request().url());
                await route.abort("failed");
              }
            });
          } });
          const find = (id) => page.locator(`main a[data-status][href*="/events/${id}/"]`);
          const live = find(fx.live);
          await live.waitFor();
          h.check(`${loc}/${width} LIVE fixture and mixed root`, await live.getAttribute("data-status") === "ongoing" && await live.locator("xpath=ancestor::section").locator(`a[href*="/events/${fx.future}/"]`).count() === 1, "");
          h.check(`${loc}/${width} future cancelled in All`, await find(fx.cancel).getAttribute("data-status") === "cancelled", "");
          await page.locator(`a[href*="/events/${fx.broken}/"] [data-testid="event-art"][data-state="fallback"]`).waitFor();
          h.check(`${loc}/${width} failed selected logo falls back`, failedRequests.some((url) => url.includes("consistency06-broken")) && await find(fx.broken).locator("img").count() === 0, failedRequests.join(" "));
          // Hydration can replace the SSR image after the load event,
          // especially on WebKit. Await this selected image, not a sleep.
          await page.waitForFunction((id) => {
            const img = document.querySelector(`main a[href*="/events/${id}/"] [data-testid="event-art"] img`);
            return img?.complete && img.naturalWidth > 0;
          }, fx.live);
          const loadedLogo = await live.locator('[data-testid="event-art"][data-state="logo"] img').evaluate((img) => ({ complete: img.complete, width: img.naturalWidth, height: img.naturalHeight, alt: img.alt, src: img.currentSrc }));
          // WebKit reports this SVG's natural size at its rendered scale
          // (44×22 or 64×32), while Chromium reports 400×200. Both must
          // decode the selected URL and retain its 2:1 aspect ratio.
          h.check(`${loc}/${width} inherited selected logo loads (browser stub)`, loadedLogo.complete && loadedLogo.width > 0 && loadedLogo.width === loadedLogo.height * 2 && loadedLogo.src.includes("consistency06-inherited") && loadedLogo.alt === "", JSON.stringify(loadedLogo));
          h.check(`${loc}/${width} explicit typography reserves slot`, await find(fx.plain).locator('[data-testid="event-art"][data-state="fallback"]').count() === 1, "");
          const cut = await h.clipped(page, ["main h4", "main h3"]);
          h.check(`${loc}/${width} fixture long names wrap`, cut.length === 0, JSON.stringify(cut));
          await liveAppearance(h, page, `${loc}/${width} fixture`);
          await markContrast(page);
          const pairs = ["status-ongoing", "status-upcoming", "status-cancelled", "title", "metadata", "date"];
          const found = await h.contrast(page, pairs, `${loc}/${width} fixture contrast`);
          h.check(`${loc}/${width} all required fixture contrast roles measured`, pairs.every((role) => found.includes(role)), found.join(","));
          await h.shot(page, `fixture-${loc}-${width}`);
          const dot = live.locator('time + div > span > span[aria-hidden="true"]');
          const normalAnimation = await dot.evaluate((el) => getComputedStyle(el).animationName);
          await page.emulateMedia({ reducedMotion: "reduce" });
          const reduced = await dot.evaluate((el) => ({ animation: getComputedStyle(el).animationName, opacity: getComputedStyle(el).opacity }));
          h.check(`${loc}/${width} fixture LIVE pulse stops with positive control`, normalAnimation !== "none" && reduced.animation === "none" && reduced.opacity === "1", `${normalAnimation} -> ${JSON.stringify(reduced)}`);
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
