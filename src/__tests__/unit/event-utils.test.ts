import { describe, it, expect } from "vitest";
import { getEventLockTime, isEventLocked } from "@/lib/event-utils";

describe("getEventLockTime", () => {
  it("returns startTime", () => {
    const startTime = new Date("2026-05-02T07:30:00Z");
    expect(getEventLockTime({ startTime })).toEqual(startTime);
  });
});

describe("isEventLocked", () => {
  it("returns true when startTime is in the past", () => {
    expect(
      isEventLocked({ startTime: new Date("2020-01-01T00:00:00Z") })
    ).toBe(true);
  });

  it("returns false when startTime is in the future", () => {
    expect(
      isEventLocked({ startTime: new Date("2099-12-31T00:00:00Z") })
    ).toBe(false);
  });
});
