import { describe, it, expect } from "vitest";
import {
  WISH_PREDICT_OPEN_DAYS,
  daysUntilUTC,
  isWishPredictOpen,
  shouldShowWishBadge,
  utcDayOffset,
  utcDayStart,
} from "@/lib/eventTiming";

const NOW = new Date("2026-05-15T03:00:00.000Z"); // mid-morning KST, mid-evening US East

describe("WISH_PREDICT_OPEN_DAYS", () => {
  it("is 7 — single source of truth for the gate window", () => {
    expect(WISH_PREDICT_OPEN_DAYS).toBe(7);
  });
});

describe("utcDayStart", () => {
  it("floors to 00:00:00.000 UTC of the same UTC day", () => {
    const d = new Date("2026-05-15T03:00:00.000Z");
    expect(utcDayStart(d).toISOString()).toBe("2026-05-15T00:00:00.000Z");
  });

  it("does NOT shift across the UTC day boundary regardless of local TZ", () => {
    // 2026-05-15T22:30:00Z is 2026-05-16 07:30 KST (next local day) but
    // still 2026-05-15 in UTC. Local-time floors would mis-bucket this.
    const d = new Date("2026-05-15T22:30:00.000Z");
    expect(utcDayStart(d).toISOString()).toBe("2026-05-15T00:00:00.000Z");
  });
});

describe("utcDayOffset", () => {
  it("adds whole UTC days while keeping 00:00:00.000 floor", () => {
    expect(utcDayOffset(NOW, 7).toISOString()).toBe(
      "2026-05-22T00:00:00.000Z",
    );
  });

  it("accepts negative offsets (past-direction)", () => {
    expect(utcDayOffset(NOW, -3).toISOString()).toBe(
      "2026-05-12T00:00:00.000Z",
    );
  });
});

describe("daysUntilUTC", () => {
  it("returns 0 when target and now are on the same UTC day", () => {
    const target = new Date("2026-05-15T23:59:00.000Z");
    expect(daysUntilUTC(target, NOW)).toBe(0);
  });

  it("returns 1 when target is the next UTC day, even by a few hours", () => {
    // NOW: 2026-05-15T03:00Z. target: 2026-05-16T01:00Z — 22h apart
    // by clock, but a UTC-day-boundary apart by bucket.
    const target = new Date("2026-05-16T01:00:00.000Z");
    expect(daysUntilUTC(target, NOW)).toBe(1);
  });

  it("returns negative for past targets", () => {
    const target = new Date("2026-05-12T03:00:00.000Z");
    expect(daysUntilUTC(target, NOW)).toBe(-3);
  });
});

describe("isWishPredictOpen", () => {
  function dayOffset(days: number): Date {
    // Exactly N UTC-days from NOW's UTC-day-start (offset hours added
    // so we're definitely in the target UTC day, not on its boundary).
    return new Date(
      Date.UTC(2026, 4, 15 + days, 12, 0, 0), // May = month 4 (0-indexed)
    );
  }

  it("returns true for an upcoming event exactly 7 days out (boundary, inclusive)", () => {
    const ev = { startTime: dayOffset(7), status: "upcoming" as const };
    expect(isWishPredictOpen(ev, NOW)).toBe(true);
  });

  it("returns false for an upcoming event 8 days out (just outside the window)", () => {
    const ev = { startTime: dayOffset(8), status: "upcoming" as const };
    expect(isWishPredictOpen(ev, NOW)).toBe(false);
  });

  it("returns true for an upcoming event 1 day out", () => {
    const ev = { startTime: dayOffset(1), status: "upcoming" as const };
    expect(isWishPredictOpen(ev, NOW)).toBe(true);
  });

  it("returns true for an upcoming event same UTC day (D-0)", () => {
    // D-0 in `isWishPredictOpen` is true (event is later today),
    // even though `shouldShowWishBadge` would return false for the
    // same daysUntil — the home badge has a stricter `> 0` rule.
    const ev = { startTime: dayOffset(0), status: "upcoming" as const };
    expect(isWishPredictOpen(ev, NOW)).toBe(true);
  });

  it("returns false for past startTime even if status hasn't flipped yet", () => {
    // Edge: status auto-flip races with UTC-day-rollover; defensive.
    const ev = { startTime: dayOffset(-1), status: "upcoming" as const };
    expect(isWishPredictOpen(ev, NOW)).toBe(false);
  });

  it("returns false when startTime is earlier today (same UTC day, already past) — strict-future guard, CR #282", () => {
    // The UTC-day-distance check alone would return true here:
    // `daysUntilUTC` reports 0 (same UTC day) and 0 satisfies
    // `>= 0 && <= 7`. But the event is in the past — the open
    // window for predicting/wishing is closed. Without the strict
    // `start > now` guard the helper would silently green-light
    // a stale `status: "upcoming"` row whose DB `scheduled` flag
    // hadn't yet been auto-flipped to `ongoing` — a real edge case
    // when the auto-status ticker lags behind real time by a few
    // minutes around startMs.
    const start = new Date(NOW.getTime() - 60 * 60 * 1000); // -1h, same UTC day
    expect(
      isWishPredictOpen({ startTime: start, status: "upcoming" }, NOW),
    ).toBe(false);
  });

  it("returns false for ongoing/completed/cancelled regardless of timing", () => {
    const start = dayOffset(3);
    expect(
      isWishPredictOpen({ startTime: start, status: "ongoing" }, NOW),
    ).toBe(false);
    expect(
      isWishPredictOpen({ startTime: start, status: "completed" }, NOW),
    ).toBe(false);
    expect(
      isWishPredictOpen({ startTime: start, status: "cancelled" }, NOW),
    ).toBe(false);
  });

  it("returns false defensively when startTime is null (TBA event)", () => {
    expect(
      isWishPredictOpen({ startTime: null, status: "upcoming" }, NOW),
    ).toBe(false);
  });

  it("accepts ISO string startTime (page serializeBigInt produces strings)", () => {
    const ev = {
      startTime: "2026-05-22T12:00:00.000Z", // exactly 7 UTC days
      status: "upcoming" as const,
    };
    expect(isWishPredictOpen(ev, NOW)).toBe(true);
  });

  it("returns false on a malformed date string instead of throwing", () => {
    const ev = {
      startTime: "not-a-real-iso",
      status: "upcoming" as const,
    };
    expect(isWishPredictOpen(ev, NOW)).toBe(false);
  });
});

describe("shouldShowWishBadge", () => {
  it("returns true for daysUntil 1..7", () => {
    for (let d = 1; d <= 7; d++) {
      expect(shouldShowWishBadge(d)).toBe(true);
    }
  });

  it("returns false for daysUntil 0 — D-0 is about to flip to Live Now", () => {
    // Distinct from isWishPredictOpen which IS true for D-0; the
    // home-card badge has a stricter rule because the auto-status
    // ticker is about to swap the card to ongoing anyway.
    expect(shouldShowWishBadge(0)).toBe(false);
  });

  it("returns false for daysUntil 8+ (outside the open window)", () => {
    expect(shouldShowWishBadge(8)).toBe(false);
    expect(shouldShowWishBadge(30)).toBe(false);
  });

  it("returns false for negative daysUntil", () => {
    expect(shouldShowWishBadge(-1)).toBe(false);
  });
});
