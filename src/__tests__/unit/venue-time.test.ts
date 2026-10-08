import { describe, it, expect } from "vitest";
import { formatVenueStart, venueIsoString } from "@/lib/venueTime";

// 2026-11-14 16:30 JST — the 15th Fes Day 1 start.
const FES_START = new Date("2026-11-14T07:30:00.000Z");

describe("venueIsoString", () => {
  it("renders JP events with the +09:00 offset", () => {
    expect(venueIsoString(FES_START, "JP")).toBe("2026-11-14T16:30:00+09:00");
  });

  it("rolls the calendar day when the venue offset crosses midnight", () => {
    expect(venueIsoString("2026-11-14T20:00:00.000Z", "KR")).toBe(
      "2026-11-15T05:00:00+09:00",
    );
  });

  it("falls back to UTC (Z) for unlisted / missing countries", () => {
    expect(venueIsoString(FES_START, "US")).toBe("2026-11-14T07:30:00Z");
    expect(venueIsoString(FES_START, null)).toBe("2026-11-14T07:30:00Z");
  });

  it("returns null for missing or unparseable input", () => {
    expect(venueIsoString(null, "JP")).toBeNull();
    expect(venueIsoString("not-a-date", "JP")).toBeNull();
  });
});

describe("formatVenueStart", () => {
  it("formats venue-local date/time/zone per locale", () => {
    expect(formatVenueStart(FES_START, "JP", "ja")).toEqual({
      date: "11月14日",
      time: "16:30",
      zone: "JST",
    });
    expect(formatVenueStart(FES_START, "JP", "ko")).toEqual({
      date: "11월 14일",
      time: "16:30",
      zone: "JST",
    });
    expect(formatVenueStart(FES_START, "JP", "en")).toEqual({
      date: "November 14",
      time: "16:30",
      zone: "JST",
    });
  });

  it("is independent of the process timezone (fixed-offset math)", () => {
    // Accepts ISO strings too (post-cache payloads are strings).
    expect(formatVenueStart(FES_START.toISOString(), "JP", "ko")?.time).toBe(
      "16:30",
    );
  });
});
