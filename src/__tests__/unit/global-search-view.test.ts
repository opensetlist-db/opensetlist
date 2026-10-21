import { describe, it, expect } from "vitest";
import { buildRowView, type RowLabels } from "@/lib/globalSearch/view";
import type { SearchHit } from "@/lib/globalSearch/service";

/*
 * Row display rules of the approved 12-v1.2 search results: viewer-locale
 * identity names vs original-primary titles, version chips, concert date
 * and Day chip, album type/date, canonical links and the matched-name
 * line.
 */

const labels: RowLabels = {
  artistType: (t) => `type:${t}`,
  albumType: (t) => `album:${t}`,
  base: "base",
  variant: "variant",
};

function eventHit(overrides: Partial<SearchHit<"events">> = {}): SearchHit<"events"> {
  return {
    type: "events",
    matchedName: "Colorful Dreams! Colorful Smiles!公演 Day.1",
    matchedLocale: null,
    entity: {
      id: BigInt(21),
      slug: "colorful-dreams-day1",
      date: new Date("2022-09-10T00:00:00Z"),
      startTime: new Date("2022-09-10T08:00:00Z"),
      originalName: "Colorful Dreams! Colorful Smiles!公演 Day.1",
      originalShortName: null,
      originalVenue: "東京ガーデンシアター",
      originalLanguage: "ja",
      translations: [
        { locale: "ko", name: "Colorful Dreams! Colorful Smiles! 공연 Day.1", shortName: null, venue: "도쿄 가든 시어터" },
      ],
    },
    ...overrides,
  };
}

describe("buildRowView", () => {
  it("renders a concert with the viewer-locale name, original subtitle, UTC date and Day chip", () => {
    const row = buildRowView(eventHit(), "ko", "Dream", labels);
    expect(row).toMatchObject({
      href: "/ko/events/21/colorful-dreams-day1",
      title: "Colorful Dreams! Colorful Smiles! 공연 Day.1",
      titleLang: "ko",
      sub: "Colorful Dreams! Colorful Smiles!公演 Day.1",
      subLang: "ja",
      date: "2022년 9월 10일",
      day: "Day.1",
      meta: "도쿄 가든 시어터",
      matched: null,
    });
  });

  it("formats a date-only column in UTC, never shifting the day", () => {
    const row = buildRowView(
      eventHit({
        entity: { ...eventHit().entity, date: new Date("2022-09-10T00:00:00Z") },
      }),
      "en",
      "Dream",
      labels,
    );
    expect(row.date).toBe("Sep 10, 2022");
  });

  it("shows the matched name when the visible title does not contain the query", () => {
    const hit: SearchHit<"artists"> = {
      type: "artists",
      matchedName: "하스노소라",
      matchedLocale: "ko",
      entity: {
        id: BigInt(1),
        slug: "hasunosora",
        type: "group",
        originalName: "蓮ノ空女学院スクールアイドルクラブ",
        originalShortName: "蓮ノ空",
        originalLanguage: "ja",
        translations: [{ locale: "ko", name: "하스노소라 여학원 스쿨 아이돌 클럽", shortName: "하스노소라" }],
      },
    };
    const ja = buildRowView(hit, "ja", "하스노소라", labels);
    expect(ja.title).toBe("蓮ノ空女学院スクールアイドルクラブ");
    expect(ja.matched).toEqual({ name: "하스노소라", lang: "ko" });
    expect(ja.initial).toBe("蓮");
    expect(ja.meta).toBe("type:group");
    // In ko the shown title already contains the query: no extra line.
    expect(buildRowView(hit, "ko", "하스노소라", labels).matched).toBeNull();
  });

  it("labels a song variant with its locale label and a base song with variants as base", () => {
    const base: SearchHit<"songs"> = {
      type: "songs",
      matchedName: "Dream Believers",
      matchedLocale: null,
      entity: {
        id: BigInt(1),
        slug: "dream-believers",
        originalTitle: "Dream Believers",
        originalLanguage: "ja",
        variantLabel: null,
        baseVersionId: null,
        translations: [],
        _count: { variants: 4 },
      },
    };
    expect(buildRowView(base, "ko", "Dream", labels).version).toEqual({
      label: "base",
      lang: "ko",
      base: true,
    });
    expect(
      buildRowView({ ...base, entity: { ...base.entity, _count: { variants: 0 } } }, "ko", "Dream", labels)
        .version,
    ).toBeNull();

    const variant: SearchHit<"songs"> = {
      ...base,
      entity: {
        ...base.entity,
        id: BigInt(62),
        slug: "dream-believers-104",
        variantLabel: "104期 Ver.",
        baseVersionId: BigInt(1),
        translations: [{ locale: "ko", title: "Dream Believers", variantLabel: "104기 Ver." }],
        _count: { variants: 0 },
      },
    };
    const row = buildRowView(variant, "ko", "Dream", labels);
    expect(row.href).toBe("/ko/songs/62/dream-believers-104");
    expect(row.version).toEqual({ label: "104기 Ver.", lang: "ko", base: false });
    expect(buildRowView(variant, "en", "Dream", labels).version).toEqual({
      label: "104期 Ver.",
      lang: "ja",
      base: false,
    });
  });

  it("gives albums a cover slot and a type · date meta line", () => {
    const hit: SearchHit<"albums"> = {
      type: "albums",
      matchedName: "Dream Believers",
      matchedLocale: null,
      entity: {
        id: BigInt(459),
        slug: "dream-believers-ep",
        type: "ep",
        originalTitle: "Dream Believers",
        originalLanguage: "ja",
        releaseDate: new Date("2023-03-29T00:00:00Z"),
        imageUrl: null,
        translations: [],
      },
    };
    const row = buildRowView(hit, "ko", "Dream", labels);
    expect(row.cover).toBeNull();
    expect(row.meta).toBe("album:ep · 2023년 3월 29일");
    expect(row.initial).toBeNull();
  });
});
