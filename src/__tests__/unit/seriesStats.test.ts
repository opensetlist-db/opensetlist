import { describe, it, expect } from "vitest";
import { getSeriesStats } from "@/lib/seriesStats";
import type { SeriesEventInput } from "@/lib/seriesGrouping";

function ev(
  partial: Partial<SeriesEventInput> & {
    id: number;
    startTime: string;
    cityKo?: string;
  },
): SeriesEventInput {
  return {
    id: partial.id,
    slug: partial.slug ?? `event-${partial.id}`,
    status: partial.status ?? "scheduled",
    date: partial.date ?? partial.startTime.slice(0, 10),
    startTime: partial.startTime,
    originalName: partial.originalName ?? null,
    originalShortName: partial.originalShortName ?? null,
    originalLanguage: partial.originalLanguage ?? "ja",
    originalCity: partial.originalCity ?? null,
    originalVenue: partial.originalVenue ?? null,
    translations: partial.translations ?? [
      {
        locale: "ko",
        name: `Event ${partial.id}`,
        shortName: null,
        city: partial.cityKo ?? "Test City",
        venue: null,
      },
    ],
  };
}

describe("getSeriesStats", () => {
  it("counts completed/ongoing/upcoming via getEventStatus", () => {
    // Reference now anchored mid-2026; use far-past + far-future startTimes
    // so getEventStatus is unambiguous.
    const REF = new Date("2026-06-01T00:00:00Z");
    const stats = getSeriesStats(
      [
        ev({ id: 1, startTime: "2026-04-25T00:00:00Z", status: "completed" }),
        ev({ id: 2, startTime: "2026-06-01T00:00:00Z", status: "ongoing" }),
        ev({ id: 3, startTime: "2026-08-01T00:00:00Z", status: "scheduled" }),
        ev({ id: 4, startTime: "2026-09-01T00:00:00Z", status: "scheduled" }),
      ],
      "ko",
      REF,
    );
    expect(stats.total).toBe(4);
    expect(stats.completed).toBe(1);
    expect(stats.ongoing).toBe(1);
    expect(stats.upcoming).toBe(2);
  });

  it("counts distinct cities for the active locale", () => {
    const stats = getSeriesStats(
      [
        ev({ id: 1, startTime: "2026-04-25T00:00:00Z", cityKo: "후쿠오카" }),
        ev({ id: 2, startTime: "2026-04-26T00:00:00Z", cityKo: "후쿠오카" }),
        ev({ id: 3, startTime: "2026-05-23T00:00:00Z", cityKo: "고베" }),
        ev({ id: 4, startTime: "2026-06-28T00:00:00Z", cityKo: "가나가와" }),
      ],
      "ko",
      new Date("2099-01-01T00:00:00Z"),
    );
    expect(stats.totalCities).toBe(3);
  });

  it("ignores blank cities in totalCities count", () => {
    const stats = getSeriesStats(
      [
        ev({
          id: 1,
          startTime: "2026-04-25T00:00:00Z",
          translations: [],
        }),
        ev({ id: 2, startTime: "2026-04-26T00:00:00Z", cityKo: "후쿠오카" }),
      ],
      "ko",
      new Date("2099-01-01T00:00:00Z"),
    );
    expect(stats.totalCities).toBe(1);
  });

  it("handles empty events array", () => {
    const stats = getSeriesStats(
      [],
      "ko",
      new Date("2026-06-01T00:00:00Z"),
    );
    expect(stats.total).toBe(0);
    expect(stats.completed).toBe(0);
    expect(stats.ongoing).toBe(0);
    expect(stats.upcoming).toBe(0);
    expect(stats.totalCities).toBe(0);
  });
});
