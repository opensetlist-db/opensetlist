import { describe, it, expect } from "vitest";
import {
  groupByCity,
  type SeriesEventInput,
} from "@/lib/seriesGrouping";

function ev(
  partial: Partial<SeriesEventInput> & {
    id: number;
    startTime: string;
    status?: SeriesEventInput["status"];
    cityKo?: string;
    originalCity?: string | null;
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
        city: partial.cityKo ?? null,
        venue: null,
      },
    ],
  };
}

describe("groupByCity", () => {
  // referenceNow far in the future so all events are "completed" by default
  // unless their status flips classification.
  const FUTURE_REF = new Date("2099-01-01T00:00:00Z");

  it("buckets a single event under its locale-resolved city", () => {
    const legs = groupByCity(
      [ev({ id: 1, startTime: "2026-04-25T00:00:00Z", cityKo: "후쿠오카" })],
      "ko",
      FUTURE_REF,
    );
    expect(legs).toHaveLength(1);
    expect(legs[0].city).toBe("후쿠오카");
    expect(legs[0].events).toHaveLength(1);
  });

  it("groups multiple events of the same city into one leg", () => {
    const legs = groupByCity(
      [
        ev({ id: 1, startTime: "2026-04-25T00:00:00Z", cityKo: "후쿠오카" }),
        ev({ id: 2, startTime: "2026-04-26T00:00:00Z", cityKo: "후쿠오카" }),
      ],
      "ko",
      FUTURE_REF,
    );
    expect(legs).toHaveLength(1);
    expect(legs[0].events).toHaveLength(2);
    // `groupByCity` normalizes inputs to epoch ms then back to ISO via
    // `Date.toISOString()`, which always emits milliseconds even when
    // the input lacked them. Compare against the canonical form.
    expect(legs[0].dateRange.start).toBe("2026-04-25T00:00:00.000Z");
    expect(legs[0].dateRange.end).toBe("2026-04-26T00:00:00.000Z");
  });

  it("creates separate legs for distinct cities", () => {
    const legs = groupByCity(
      [
        ev({ id: 1, startTime: "2026-04-25T00:00:00Z", cityKo: "후쿠오카" }),
        ev({ id: 2, startTime: "2026-05-23T00:00:00Z", cityKo: "고베" }),
      ],
      "ko",
      FUTURE_REF,
    );
    expect(legs).toHaveLength(2);
    const cities = legs.map((l) => l.city).sort();
    expect(cities).toEqual(["고베", "후쿠오카"]);
  });

  it("falls back to originalCity when active locale has no translation", () => {
    const legs = groupByCity(
      [
        ev({
          id: 1,
          startTime: "2026-04-25T00:00:00Z",
          originalCity: "Fukuoka",
          translations: [
            {
              locale: "ja",
              name: "Event 1",
              shortName: null,
              city: null,
              venue: null,
            },
          ],
        }),
      ],
      "ko",
      FUTURE_REF,
    );
    expect(legs[0].city).toBe("Fukuoka");
  });

  it("returns empty-string city when both translation and originalCity are missing", () => {
    const legs = groupByCity(
      [
        ev({
          id: 1,
          startTime: "2026-04-25T00:00:00Z",
          translations: [],
        }),
      ],
      "ko",
      FUTURE_REF,
    );
    expect(legs[0].city).toBe("");
  });

  it("pins ongoing-bearing legs to the top regardless of date", () => {
    // Ongoing event must compare ongoing per getEventStatus — supply
    // status: "ongoing" + a startTime in the recent past so the buffer
    // logic considers it ongoing.
    const RECENT = new Date("2026-04-25T12:00:00Z");
    const legs = groupByCity(
      [
        // Earlier-date leg with no ongoing event:
        ev({ id: 1, startTime: "2026-03-01T00:00:00Z", cityKo: "도쿄", status: "completed" }),
        // Later-date leg with an ongoing event:
        ev({
          id: 2,
          startTime: "2026-04-25T10:00:00Z",
          cityKo: "후쿠오카",
          status: "ongoing",
        }),
      ],
      "ko",
      RECENT,
    );
    expect(legs[0].city).toBe("후쿠오카");
    expect(legs[0].hasOngoing).toBe(true);
  });

  it("orders non-ongoing legs by earliest start ascending", () => {
    const legs = groupByCity(
      [
        ev({ id: 1, startTime: "2026-07-12T00:00:00Z", cityKo: "사이타마" }),
        ev({ id: 2, startTime: "2026-04-25T00:00:00Z", cityKo: "후쿠오카" }),
        ev({ id: 3, startTime: "2026-05-23T00:00:00Z", cityKo: "고베" }),
      ],
      "ko",
      FUTURE_REF,
    );
    expect(legs.map((l) => l.city)).toEqual(["후쿠오카", "고베", "사이타마"]);
  });
});
