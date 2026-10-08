import { describe, it, expect } from "vitest";
import {
  checkOpensAtBeforeStart,
  validateEngagementOpensAt,
} from "@/app/api/admin/events/_validate";

// `engagementOpensAt` at/after startTime would make the Wishlist /
// Predicted Setlist surfaces silently never open — the admin API must
// reject it with a 400 instead of storing it.
describe("validateEngagementOpensAt", () => {
  const start = new Date("2026-11-14T07:30:00.000Z");

  it.each([undefined, null, ""])("treats %j as 'use the D-7 default' (null)", (v) => {
    const r = validateEngagementOpensAt(v, start);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
  });

  it("accepts an instant before startTime", () => {
    const r = validateEngagementOpensAt("2026-10-10T00:00:00Z", start);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value?.toISOString()).toBe("2026-10-10T00:00:00.000Z");
  });

  it.each(["2026-11-14T07:30:00Z", "2026-11-15T00:00:00Z"])(
    "rejects %s (at/after startTime) with 400",
    (v) => {
      const r = validateEngagementOpensAt(v, start);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.response.status).toBe(400);
    },
  );

  it("rejects an unparseable value with 400", () => {
    const r = validateEngagementOpensAt("not-a-date", start);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(400);
  });
});

describe("validateEngagementOpensAt strictness", () => {
  const start = new Date("2026-11-14T07:30:00.000Z");

  it.each([
    "2026-10-10T00:00", // zone-less → would be read in server-local TZ
    "2026-10-10", // date only
    "2026-02-30T00:00:00Z", // rolls over to March 2nd under new Date()
    "2026-10-10T24:00:00Z",
  ])("rejects %s with 400", (v) => {
    const r = validateEngagementOpensAt(v, start);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(400);
  });

  it("accepts the admin form's minute-precision `…THH:mmZ` shape", () => {
    const r = validateEngagementOpensAt("2026-10-10T00:00Z", start);
    expect(r.ok).toBe(true);
  });

  it("accepts an explicit offset", () => {
    const r = validateEngagementOpensAt("2026-10-10T09:00:00+09:00", start);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value?.toISOString()).toBe("2026-10-10T00:00:00.000Z");
  });
});

describe("checkOpensAtBeforeStart", () => {
  const start = new Date("2026-11-14T07:30:00.000Z");

  it("passes null (no stored override)", () => {
    expect(checkOpensAtBeforeStart(null, start).ok).toBe(true);
  });

  it("rejects a stored opens-at left at/after a moved startTime", () => {
    const r = checkOpensAtBeforeStart(new Date("2026-11-20T00:00:00Z"), start);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(400);
  });
});
