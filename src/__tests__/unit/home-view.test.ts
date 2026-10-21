import { describe, expect, it } from "vitest";
import type { HomeEvent } from "@/lib/homeEvents";
import { projectHomeCard, projectUpcomingCard } from "@/lib/homeView";

// Locale projection of a cached home row into card text (14-v1 contract):
// series full name as the title, the event's own name as the day label,
// "city · venue", a UTC-formatted date, and the resolved logo URL only.

const base: HomeEvent = {
  id: "109",
  slug: "lovelive-15th-fes-day1",
  startTime: "2026-11-14T07:30:00.000Z",
  engagementOpensAt: null,
  originalName: "Day.1",
  originalShortName: "Day.1",
  originalLanguage: "ja",
  originalCity: "名古屋",
  originalVenue: "バンテリンドーム ナゴヤ",
  translations: [
    { locale: "ko", name: "Day.1", shortName: "Day.1", city: "나고야", venue: "반테린 돔 나고야" },
  ],
  eventSeries: {
    originalName: "LoveLive! Series 15th Anniversary ラブライブ！フェス",
    originalShortName: "ラブライブ！フェス",
    originalLanguage: "ja",
    translations: [
      { locale: "ko", name: "러브라이브! 시리즈 15주년 러브라이브! 페스", shortName: "러브라이브! 페스" },
    ],
  },
  logo: { image: null, color: null },
  songCount: null,
};

describe("projectHomeCard", () => {
  it("titles a series event with the series and keeps the day as live text", () => {
    const v = projectHomeCard(base, "ko", "?");
    expect(v.title).toBe("러브라이브! 시리즈 15주년 러브라이브! 페스");
    expect(v.dayLabel).toBe("Day.1");
    expect(v.artTitle).toBe("러브라이브! 페스");
    expect(v.place).toBe("나고야 · 반테린 돔 나고야");
    expect(v.href).toBe("/ko/events/109/lovelive-15th-fes-day1");
    expect(v.logoUrl).toBeNull();
    expect(v.tint).toBeNull();
  });

  it("falls back to original-language names where a locale has no translation", () => {
    const v = projectHomeCard(base, "en", "?");
    expect(v.title).toBe("LoveLive! Series 15th Anniversary ラブライブ！フェス");
    expect(v.place).toBe("名古屋 · バンテリンドーム ナゴヤ");
  });

  it("formats the date from the UTC instant, not the server's local day", () => {
    // 2026-11-14T23:30Z is 11/15 in Seoul/Tokyo; the stored UTC day wins.
    const v = projectHomeCard(
      { ...base, startTime: "2026-11-14T23:30:00.000Z" },
      "ko",
      "?",
    );
    expect(v.dateLabel).toContain("11. 14.");
    expect(v.dateLabel).toContain("2026");
  });

  it("uses the event's own name as title for a standalone event, with no day label", () => {
    const v = projectHomeCard(
      {
        ...base,
        eventSeries: null,
        originalName: "리허설: 러브라이브! 페스 2020 Day.2",
        originalShortName: null,
        translations: [],
      },
      "ko",
      "?",
    );
    expect(v.title).toBe("리허설: 러브라이브! 페스 2020 Day.2");
    expect(v.dayLabel).toBeNull();
    expect(v.artTitle).toBe("리허설: 러브라이브! 페스 2020 Day.2");
  });

  it("omits a missing place part instead of printing a dangling separator", () => {
    const v = projectHomeCard(
      { ...base, originalCity: null, translations: [] },
      "ko",
      "?",
    );
    expect(v.place).toBe("バンテリンドーム ナゴヤ");
    const none = projectHomeCard(
      { ...base, originalCity: null, originalVenue: null, translations: [] },
      "ko",
      "?",
    );
    expect(none.place).toBeNull();
  });

  it("passes through only the resolved logo URL", () => {
    const v = projectHomeCard(
      {
        ...base,
        logo: {
          image: { url: "https://img.example/l.webp", width: 300, height: 100 },
          color: "#E50080",
        },
      },
      "ko",
      "?",
    );
    expect(v.logoUrl).toBe("https://img.example/l.webp");
    expect(v.tint).toBe("#E50080");
  });
});

describe("projectUpcomingCard", () => {
  const now = new Date("2026-10-21T01:35:00.000Z");

  it("counts whole 24h periods to start (D-N) from the bucket instant", () => {
    const v = projectUpcomingCard(base, "ko", "?", now);
    expect(v.daysLeft).toBe(24);
  });

  it("opens the prediction badge with the event's override and not before", () => {
    const open = projectUpcomingCard(
      { ...base, engagementOpensAt: "2026-10-11T23:12:00.000Z" },
      "ko",
      "?",
      now,
    );
    expect(open.showWishBadge).toBe(true);
    // Default window is D-7: 24 days out is still closed.
    expect(projectUpcomingCard(base, "ko", "?", now).showWishBadge).toBe(false);
  });
});
