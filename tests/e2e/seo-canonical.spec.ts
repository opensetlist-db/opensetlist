import { test, expect, type APIRequestContext } from "@playwright/test";

/*
 * Technical-SEO floor: one URL per entity, canonical + hreflang in
 * <head>, locale-complete sitemap, and `ja` as the default locale.
 *
 * The sample event is discovered from /sitemap.xml rather than an env
 * var — that doubles as a check that the sitemap advertises exactly
 * the URL the page declares canonical (the sitemap and the page share
 * `entityPath`, so a mismatch here means they drifted).
 */

async function sitemapLocs(request: APIRequestContext): Promise<string[]> {
  const res = await request.get("/sitemap.xml");
  expect(res.ok()).toBeTruthy();
  const xml = await res.text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

async function sampleEventPath(request: APIRequestContext): Promise<string> {
  const loc = (await sitemapLocs(request)).find((u) =>
    /\/ja\/events\/\d+\/[^/]+$/.test(new URL(u).pathname),
  );
  test.skip(!loc, "no events in the sitemap — seed at least one event");
  return new URL(loc!).pathname;
}

test.describe("sitemap", () => {
  test("advertises every locale in roughly equal numbers", async ({
    request,
  }) => {
    const counts: Record<string, number> = {};
    for (const loc of await sitemapLocs(request)) {
      const locale = new URL(loc).pathname.split("/")[1];
      counts[locale] = (counts[locale] ?? 0) + 1;
    }
    expect(counts.ja).toBeGreaterThan(0);
    expect(counts.ko).toBe(counts.ja);
    expect(counts.en).toBe(counts.ja);
  });
});

test.describe("entity URL canonicalization", () => {
  test("bare id 308s to the DB-slug URL", async ({ request }) => {
    const canonical = await sampleEventPath(request);
    const bare = canonical.replace(/\/[^/]+$/, "");
    const res = await request.get(bare, { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    expect(new URL(res.headers().location, "http://x").pathname).toBe(
      canonical,
    );
  });

  test("wrong slug 308s to the DB-slug URL", async ({ request }) => {
    const canonical = await sampleEventPath(request);
    const wrong = canonical.replace(/\/[^/]+$/, `/wrong-slug-${Date.now()}`);
    const res = await request.get(wrong, { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    expect(new URL(res.headers().location, "http://x").pathname).toBe(
      canonical,
    );
  });

  test("canonical + hreflang links in <head> agree with the final URL", async ({
    page,
    request,
  }) => {
    const canonical = await sampleEventPath(request);
    const resp = await page.goto(canonical);
    expect(resp?.status()).toBe(200);

    const canonicalHref = await page
      .locator('head link[rel="canonical"]')
      .getAttribute("href");
    expect(new URL(canonicalHref!).pathname).toBe(canonical);

    const hreflangs = await page
      .locator('head link[rel="alternate"][hreflang]')
      .evaluateAll((els) =>
        els.map((el) => [
          el.getAttribute("hreflang"),
          el.getAttribute("href"),
        ]),
      );
    const map = Object.fromEntries(hreflangs);
    expect(Object.keys(map).sort()).toEqual(["en", "ja", "ko", "x-default"]);
    const rest = canonical.replace(/^\/ja/, "");
    expect(new URL(map.ko!).pathname).toBe(`/ko${rest}`);
    expect(new URL(map.en!).pathname).toBe(`/en${rest}`);
    expect(new URL(map["x-default"]!).pathname).toBe(canonical);
  });
});

test.describe("default locale", () => {
  test("/ without Accept-Language redirects to /ja", async ({ playwright }) => {
    // Fresh context: the project-level `locale: "ko-KR"` would
    // otherwise send `Accept-Language: ko-KR`.
    const ctx = await playwright.request.newContext({
      baseURL: test.info().project.use.baseURL,
      extraHTTPHeaders: { "Accept-Language": "" },
    });
    const res = await ctx.get("/", { maxRedirects: 0 });
    expect([307, 308]).toContain(res.status());
    expect(new URL(res.headers().location, "http://x").pathname).toBe("/ja");
    await ctx.dispose();
  });

  test("/ with Accept-Language: ko redirects to /ko", async ({
    playwright,
  }) => {
    const ctx = await playwright.request.newContext({
      baseURL: test.info().project.use.baseURL,
      extraHTTPHeaders: { "Accept-Language": "ko" },
    });
    const res = await ctx.get("/", { maxRedirects: 0 });
    expect([307, 308]).toContain(res.status());
    expect(new URL(res.headers().location, "http://x").pathname).toBe("/ko");
    await ctx.dispose();
  });
});
