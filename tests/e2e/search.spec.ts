import { test, expect, type Page } from "@playwright/test";

/*
 * Global search (ticket 13) — the real browser journeys: header entry,
 * mobile icon, type change / pagination / "more" URL rules, locale
 * switch keeping the query, canonical result links, and the empty /
 * no-results / too-long / out-of-range states. Read-only against the
 * catalog.
 *
 * Data-light on purpose: "a" matches far more than 20 songs and at least
 * one row in several groups on any seeded catalog, and a random token
 * matches nothing. Assertions key on URLs, roles and landmarks rather
 * than specific records.
 */

const NO_MATCH = "zzq-no-match-e2e";

function params(page: Page) {
  return new URL(page.url()).searchParams;
}

test.describe("search entry points", () => {
  test("header form submits q to the overview", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/ko/events");
    const header = page.getByRole("banner").getByRole("search");
    await header.getByRole("searchbox").fill("Dream");
    await header.getByRole("searchbox").press("Enter");
    await page.waitForURL(/\/ko\/search\?/);
    expect(params(page).get("q")).toBe("Dream");
    expect(params(page).get("type")).toBeNull();
    // The header field mirrors the current query on the search page.
    await expect(header.getByRole("searchbox")).toHaveValue("Dream");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
  });

  test("mobile header icon opens the empty search page", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/en/artists");
    await page.getByRole("banner").getByRole("link", { name: "Search" }).click();
    await page.waitForURL(/\/en\/search$/);
    await expect(page.getByRole("status")).toBeVisible();
    // No whole-page horizontal overflow at phone width.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("search URL state", () => {
  test("type change keeps q and resets page; more link opens the type", async ({ page }) => {
    await page.goto("/ko/search?q=a");
    const groups = page.locator("#search-results section");
    await expect(groups).toHaveCount(4);
    const more = page.locator("#search-results a[href*='type=songs']");
    await more.click();
    await page.waitForURL(/type=songs/);
    expect(params(page).get("page")).toBeNull();

    const pager = page.getByRole("navigation", { name: "검색 결과 페이지 이동" });
    await pager.getByRole("link", { name: /다음/ }).click();
    await page.waitForURL(/page=2/);
    expect(params(page).get("q")).toBe("a");

    await page
      .getByRole("navigation", { name: "검색 유형" })
      .getByRole("link", { name: "앨범" })
      .click();
    await page.waitForURL(/type=albums/);
    expect(params(page).get("page")).toBeNull();
    expect(params(page).get("q")).toBe("a");
  });

  test("main form requery keeps the type and resets the page", async ({ page }) => {
    await page.goto("/ko/search?q=a&type=songs&page=2");
    const form = page.getByRole("main").getByRole("search");
    await form.getByRole("searchbox").fill("Dream");
    await form.getByRole("searchbox").press("Enter");
    await page.waitForURL(/q=Dream/);
    expect(params(page).get("type")).toBe("songs");
    expect(params(page).get("page")).toBeNull();
  });

  test("locale switch keeps q/type/page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/ko/search?q=a&type=songs&page=2");
    await page.getByRole("banner").getByRole("button", { name: "English" }).click();
    await page.waitForURL(/\/en\/search/);
    expect(params(page).get("q")).toBe("a");
    expect(params(page).get("type")).toBe("songs");
    expect(params(page).get("page")).toBe("2");
  });

  test("result rows link to canonical entity URLs", async ({ page }) => {
    await page.goto("/ja/search?q=a");
    const hrefs = await page
      .locator("#search-results ul a")
      .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toMatch(/^\/ja\/(events|artists|songs|albums)\/\d+\/[a-z0-9-]+$/);
    }
    const first = hrefs[0]!;
    const res = await page.request.get(first, { maxRedirects: 0 });
    expect(res.status()).toBe(200);
  });
});

test.describe("search states", () => {
  test("empty query shows the invitation, not the catalog", async ({ page }) => {
    await page.goto("/ko/search?q=%20%20");
    await expect(page.getByRole("status")).toBeVisible();
    await expect(page.locator("#search-results ul")).toHaveCount(0);
  });

  test("no results", async ({ page }) => {
    await page.goto(`/ko/search?q=${NO_MATCH}`);
    await expect(page.getByRole("status")).toBeVisible();
    await expect(page.locator("#search-results ul")).toHaveCount(0);
  });

  test("over-long direct URL keeps the text and offers editing", async ({ page }) => {
    const long = "長".repeat(121);
    await page.goto(`/ko/search?q=${encodeURIComponent(long)}`);
    const field = page.getByRole("main").getByRole("searchbox");
    await expect(field).toHaveValue(long);
    await page.getByRole("button", { name: "검색어 수정" }).click();
    await expect(field).toBeFocused();
  });

  test("out-of-range page links back to page 1", async ({ page }) => {
    await page.goto("/ko/search?q=Dream&type=songs&page=999");
    await page.getByRole("link", { name: "첫 페이지로" }).click();
    await page.waitForURL(/type=songs$/);
    await expect(page.locator("#search-results ul li").first()).toBeVisible();
  });

  test("a later page of a type with no matches at all is plain no-results", async ({ page }) => {
    // Positive control: the range panel exists for a type that has matches.
    await page.goto("/ko/search?q=Dream&type=songs&page=999");
    await expect(page.getByRole("link", { name: "첫 페이지로" })).toBeVisible();
    await page.goto(`/ko/search?q=${NO_MATCH}&type=artists&page=2`);
    await expect(page.getByRole("status")).toBeVisible();
    await expect(page.getByRole("link", { name: "첫 페이지로" })).toHaveCount(0);
  });

  test("malformed page and type fall back safely", async ({ page }) => {
    const res = await page.goto("/ko/search?q=a&type=bogus&page=-1");
    expect(res?.status()).toBe(200);
    await expect(page.locator("#search-results section")).toHaveCount(4);
  });
});
