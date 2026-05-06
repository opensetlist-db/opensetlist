import { describe, it, expect } from "vitest";
import { getConfirmStatus } from "@/lib/confirmStatus";

const NOW = new Date("2026-05-23T12:00:00.000Z");

function item(
  status: string,
  createdAtOffsetMs: number,
  id = 1,
): { id: number; status: string; createdAt: Date } {
  return {
    id,
    status,
    createdAt: new Date(NOW.getTime() + createdAtOffsetMs),
  };
}

describe("getConfirmStatus", () => {
  it("DB-confirmed status trumps everything (just-created)", () => {
    // Row created 0s ago but DB says confirmed (operator manually
    // promoted) → confirmed. The 1-min auto-promote logic doesn't
    // need to fire — DB-level intent wins.
    expect(getConfirmStatus(item("confirmed", 0), NOW)).toBe("confirmed");
  });

  it("DB `live` status maps to confirmed for visual purposes", () => {
    // The row is happening right now, verified by the system; the
    // viewer shouldn't see it as unverified. Aligns with the Stage B
    // `deriveRowState` behavior in `<ActualSetlist>` (only `rumoured`
    // gets the gray bg).
    expect(getConfirmStatus(item("live", 0), NOW)).toBe("confirmed");
  });

  it("rumoured row created < 1 minute ago → rumoured", () => {
    // -30s: clearly inside the 1-min window.
    expect(getConfirmStatus(item("rumoured", -30_000), NOW)).toBe("rumoured");
  });

  it("rumoured row created ≥ 1 minute ago → auto-promotes to confirmed", () => {
    // -90s: well past the boundary.
    expect(getConfirmStatus(item("rumoured", -90_000), NOW)).toBe("confirmed");
  });

  it("boundary: exactly 60s (>= AUTO_CONFIRM_MS) promotes", () => {
    // Inclusive boundary — at exactly the 60s mark the row flips.
    // A 1-second-late check should not leave the row in rumoured
    // limbo for an extra poll cycle.
    expect(getConfirmStatus(item("rumoured", -60_000), NOW)).toBe("confirmed");
  });

  it("boundary: 1ms before 60s stays rumoured", () => {
    // Strict inequality on the just-under side — confirms the
    // boundary is `>= 60_000`, not `> 60_000`.
    expect(getConfirmStatus(item("rumoured", -59_999), NOW)).toBe("rumoured");
  });

  it("late-arriving viewer: a row 5 minutes old reads as confirmed on first paint", () => {
    // The whole point of computing now-vs-createdAt rather than a
    // setTimeout — a viewer who lands on the page well after the
    // row was entered shouldn't see it briefly flash rumoured then
    // promote on the first poll. They see the settled state
    // immediately.
    expect(getConfirmStatus(item("rumoured", -5 * 60_000), NOW)).toBe(
      "confirmed",
    );
  });

  it("createdAt as ISO string (page serializeBigInt produces strings) is accepted", () => {
    // The `/api/setlist` route returns `serializeBigInt(items)` where
    // every BigInt becomes a number and Date columns become ISO
    // strings. Shape the test stub the same way.
    const stub = {
      id: 1,
      status: "rumoured",
      createdAt: new Date(NOW.getTime() - 90_000).toISOString(),
    };
    expect(getConfirmStatus(stub, NOW)).toBe("confirmed");
  });

  it("malformed createdAt falls back defensively to confirmed", () => {
    // A row with a corrupt timestamp (data tampering, DevTools
    // edit) shouldn't trap into permanent rumoured. Settle to
    // confirmed — the safe default, matches the unknown-status
    // fallback below.
    const stub = {
      id: 1,
      status: "rumoured",
      createdAt: "not-a-real-iso",
    };
    expect(getConfirmStatus(stub, NOW)).toBe("confirmed");
  });

  it("unknown status (forward-compat schema widening) falls back to confirmed", () => {
    // Defensive against future SetlistItemStatus enum additions
    // that ship before this helper updates — render the row as
    // confirmed (the safe default; pre-refactor render also treated
    // anything non-rumoured as the default visual).
    expect(
      getConfirmStatus(
        { id: 1, status: "future-unknown-status", createdAt: NOW },
        NOW,
      ),
    ).toBe("confirmed");
  });
});
