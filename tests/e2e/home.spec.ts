import { test, expect } from "@playwright/test";

/*
 * Home (ticket 15) — real browser journeys on the approved 14-v1.3
 * layout: Hero search into the search overview, the browse/past entry
 * points, section order, and the mobile rail as the only horizontal
 * scroller. Read-only; data-light: assertions key on roles, landmarks
 * and URLs, so any dev catalog state passes (an empty upcoming list
 * renders the empty notice instead of the rail).
 */

test.describe("home", () => {
  test("Hero search submits q only to the search overview", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/ko");
    const hero = page.getByRole("main").getByRole("search");
    await hero.getByRole("searchbox").fill("  Dream  ");
    await hero.getByRole("searchbox").press("Enter");
    await page.waitForURL(/\/ko\/search\?/);
    const params = new URL(page.url()).searchParams;
    expect(params.get("q")?.trim()).toBe("Dream");
    expect(params.get("type")).toBeNull();
    expect(params.get("page")).toBeNull();
  });

  test("Hero actions and section order", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/en");
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(
      "The live story we keep together",
    );
    await expect(main.getByRole("link", { name: "Explore events" }).first()).toHaveAttribute(
      "href",
      "/en/events",
    );
    await expect(main.getByRole("link", { name: "Past setlists" }).first()).toHaveAttribute(
      "href",
      "/en/events?filter=completed",
    );
    await expect(main.getByText("Fictional live music scene")).toBeVisible();

    // Hero → (ongoing) → upcoming → past, by document order of h2s.
    const h2 = await main.getByRole("heading", { level: 2 }).allTextContents();
    const upcoming = h2.indexOf("Upcoming events");
    const past = h2.findIndex((t) =>
      ["Recent events", "From the setlist archive"].includes(t),
    );
    expect(upcoming).toBeGreaterThanOrEqual(0);
    expect(past).toBeGreaterThan(upcoming);
    const live = h2.indexOf("Live now");
    if (live >= 0) expect(live).toBeLessThan(upcoming);
  });

  test("mobile: only the upcoming rail scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/ja");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // Test ids, not copy: a translation change must not silently route
    // the test into the empty branch.
    const rail = page.getByTestId("home-upcoming-rail");
    if ((await rail.count()) === 0) {
      // No upcoming concerts in this catalog: the empty notice keeps a
      // browse link instead.
      await expect(
        page.getByTestId("home-empty-notice").first().getByRole("link"),
      ).toBeVisible();
      return;
    }
    const cards = rail.getByRole("link");
    const n = await cards.count();
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(5);
    if (n > 1) {
      const scrollable = await rail.evaluate((el) => el.scrollWidth > el.clientWidth);
      expect(scrollable).toBe(true);
      // Keyboard: focusing the last card scrolls it into the rail.
      await cards.nth(n - 1).focus();
      await expect(cards.nth(n - 1)).toBeInViewport();
    }
  });
});
