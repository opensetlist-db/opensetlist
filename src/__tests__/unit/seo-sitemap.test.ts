import { describe, it, expect } from "vitest";
import { BASE_URL } from "@/lib/config";
import { buildSitemap, type SitemapInput } from "@/lib/seo/sitemap";

const d = new Date("2026-09-01T00:00:00Z");

function input(overrides: Partial<SitemapInput> = {}): SitemapInput {
  return {
    events: [],
    songs: [],
    artists: [],
    members: [],
    series: [],
    albums: [],
    ...overrides,
  };
}

const localeOf = (url: string) => new URL(url).pathname.split("/")[1];

describe("buildSitemap", () => {
  it("emits every static page in all three locales", () => {
    const entries = buildSitemap(input());
    const homes = entries.filter((e) => /^\/[a-z]{2}$/.test(new URL(e.url).pathname));
    expect(homes.map((e) => localeOf(e.url)).sort()).toEqual(["en", "ja", "ko"]);
  });

  it("emits each entity once per locale on its DB-slug URL, with hreflang alternates", () => {
    const entries = buildSitemap(
      input({
        events: [{ id: BigInt(8), slug: "hasunosora-6th-saitama-day2", lastModified: d }],
        members: [{ id: "uuid-1", slug: "kaho", lastModified: d }],
        albums: [{ id: "42", slug: "some-album", lastModified: d }],
      }),
    );
    const events = entries.filter((e) => e.url.includes("/events/8/"));
    expect(events.map((e) => e.url).sort()).toEqual([
      `${BASE_URL}/en/events/8/hasunosora-6th-saitama-day2`,
      `${BASE_URL}/ja/events/8/hasunosora-6th-saitama-day2`,
      `${BASE_URL}/ko/events/8/hasunosora-6th-saitama-day2`,
    ]);
    for (const e of events) {
      expect(e.lastModified).toBe(d);
      expect(e.priority).toBe(0.9);
      expect(e.alternates?.languages).toMatchObject({
        ko: `${BASE_URL}/ko/events/8/hasunosora-6th-saitama-day2`,
        ja: `${BASE_URL}/ja/events/8/hasunosora-6th-saitama-day2`,
        en: `${BASE_URL}/en/events/8/hasunosora-6th-saitama-day2`,
        "x-default": `${BASE_URL}/ja/events/8/hasunosora-6th-saitama-day2`,
      });
    }
    // Members and albums were missing from the old sitemap entirely.
    expect(entries.filter((e) => e.url.includes("/members/uuid-1/kaho"))).toHaveLength(3);
    expect(entries.filter((e) => e.url.includes("/albums/42/some-album"))).toHaveLength(3);
  });

  it("keeps locale counts balanced (the old sitemap was ~99% /ko/)", () => {
    const entries = buildSitemap(
      input({
        songs: [
          { id: BigInt(1), slug: "a", lastModified: d },
          { id: BigInt(2), slug: "b", lastModified: d },
        ],
        artists: [{ id: BigInt(3), slug: "c", lastModified: d }],
      }),
    );
    const counts: Record<string, number> = {};
    for (const e of entries) counts[localeOf(e.url)] = (counts[localeOf(e.url)] ?? 0) + 1;
    expect(counts.ko).toBe(counts.ja);
    expect(counts.ja).toBe(counts.en);
  });

  it("never stamps lastModified with the request time", () => {
    const before = Date.now();
    const entries = buildSitemap(input());
    for (const e of entries) {
      expect((e.lastModified as Date).getTime()).toBeLessThan(before - 1000);
    }
  });
});
