import { describe, it, expect } from "vitest";
import {
  OPEN_WINDOW_MS,
  WISH_PREDICT_OPEN_DAYS,
  daysUntilUTC,
  isWishPredictOpen,
  shouldShowWishBadge,
  utcDayOffset,
  utcDayStart,
} from "@/lib/eventTiming";

const NOW = new Date("2026-05-15T03:00:00.000Z"); // mid-morning KST, mid-evening US East
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
  // Helper: exact ms offset from NOW. Use this (not UTC-day arithmetic)
  // so tests pin the strict 168h-window semantics rather than the old
  // calendar-day approximation.
  function msOffset(deltaMs: number): Date {
    return new Date(NOW.getTime() + deltaMs);
  }

  it("returns true at exactly the 168h boundary (inclusive)", () => {
    // start - now === OPEN_WINDOW_MS exactly. The earlier UTC-day
    // implementation also passed this; the new strict-ms gate still
    // does, just via a different code path.
    const ev = {
      startTime: msOffset(OPEN_WINDOW_MS),
      status: "upcoming" as const,
    };
    expect(isWishPredictOpen(ev, NOW)).toBe(true);
  });

  it("returns false at 7d 2h 43m out — past the strict 168h boundary", () => {
    // This is the bug the gate rewrite targeted. Operator reported
    // the gate showing OPEN at "7 days 2 hours 43 minutes before
    // event start" because the old UTC-day-distance implementation
    // opened at calendar-day-D-7 instead of 168h-D-7. With strict
    // ms semantics the gate now stays closed in this state.
    const sevenDaysTwoHoursFortyThreeMinutes =
      OPEN_WINDOW_MS + 2 * 60 * 60 * 1000 + 43 * 60 * 1000;
    const ev = {
      startTime: msOffset(sevenDaysTwoHoursFortyThreeMinutes),
      status: "upcoming" as const,
    };
    expect(isWishPredictOpen(ev, NOW)).toBe(false);
  });

  it("returns true at 6d 23h 59m out — just inside the boundary", () => {
    const ev = {
      startTime: msOffset(OPEN_WINDOW_MS - 60 * 1000), // -1 minute
      status: "upcoming" as const,
    };
    expect(isWishPredictOpen(ev, NOW)).toBe(true);
  });

  it("returns true at 1 hour before startTime (the lower edge of the open window)", () => {
    const ev = {
      startTime: msOffset(60 * 60 * 1000),
      status: "upcoming" as const,
    };
    expect(isWishPredictOpen(ev, NOW)).toBe(true);
  });

  it("returns false at exactly startTime (gate closes when the show begins)", () => {
    const ev = { startTime: NOW, status: "upcoming" as const };
    expect(isWishPredictOpen(ev, NOW)).toBe(false);
  });

  it("returns false for past startTime even if status hasn't flipped yet (CR #282)", () => {
    // Status auto-flip can lag a few minutes behind real time around
    // startMs. The strict-future ms check keeps the gate closed even
    // when the DB still reports `scheduled`.
    const ev = {
      startTime: msOffset(-60 * 60 * 1000), // -1h
      status: "upcoming" as const,
    };
    expect(isWishPredictOpen(ev, NOW)).toBe(false);
  });

  it("returns false for ongoing/completed/cancelled regardless of timing", () => {
    const start = msOffset(3 * MS_PER_DAY);
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
    // 2026-05-22T03:00 UTC is exactly 7 UTC days × 24h from
    // 2026-05-15T03:00 UTC — boundary-inclusive.
    const ev = {
      startTime: "2026-05-22T03:00:00.000Z",
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
  function msOffset(deltaMs: number): Date {
    return new Date(NOW.getTime() + deltaMs);
  }

  it("returns true at exactly 168h before start (inclusive boundary)", () => {
    expect(shouldShowWishBadge(msOffset(OPEN_WINDOW_MS), NOW)).toBe(true);
  });

  it("returns false at 7d 2h 43m out (mirrors isWishPredictOpen)", () => {
    const sevenDaysTwoHoursFortyThreeMinutes =
      OPEN_WINDOW_MS + 2 * 60 * 60 * 1000 + 43 * 60 * 1000;
    expect(
      shouldShowWishBadge(msOffset(sevenDaysTwoHoursFortyThreeMinutes), NOW),
    ).toBe(false);
  });

  it("returns true at 1h before start", () => {
    expect(shouldShowWishBadge(msOffset(60 * 60 * 1000), NOW)).toBe(true);
  });

  it("returns false at exactly start (gate closes when show begins)", () => {
    expect(shouldShowWishBadge(NOW, NOW)).toBe(false);
  });

  it("returns false for past start (defensive, even though caller pre-filters)", () => {
    expect(shouldShowWishBadge(msOffset(-60 * 60 * 1000), NOW)).toBe(false);
  });

  it("agrees with isWishPredictOpen on the 168h boundary — no drift between home card and detail page", () => {
    // Operator-confusing drift between the two surfaces was the
    // original bug. Both helpers MUST agree on the boundary.
    const boundary = msOffset(OPEN_WINDOW_MS);
    const detailGate = isWishPredictOpen(
      { startTime: boundary, status: "upcoming" },
      NOW,
    );
    expect(detailGate).toBe(true);
    expect(shouldShowWishBadge(boundary, NOW)).toBe(true);

    const justOutside = msOffset(OPEN_WINDOW_MS + 60 * 1000); // +1 min
    expect(
      isWishPredictOpen(
        { startTime: justOutside, status: "upcoming" },
        NOW,
      ),
    ).toBe(false);
    expect(shouldShowWishBadge(justOutside, NOW)).toBe(false);
  });
});
