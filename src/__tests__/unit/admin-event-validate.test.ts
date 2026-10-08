import { describe, it, expect } from "vitest";
import { validateEngagementOpensAt } from "@/app/api/admin/events/_validate";

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
