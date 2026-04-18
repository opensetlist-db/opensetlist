import { describe, it, expect } from "vitest";
import { getEditCooldownRemaining } from "@/lib/impression";

describe("getEditCooldownRemaining", () => {
  it("returns ~60s when the impression was just posted", () => {
    const updatedAt = new Date("2026-05-02T12:00:00Z");
    const now = new Date("2026-05-02T12:00:00Z");
    expect(getEditCooldownRemaining(updatedAt, now)).toBe(60);
  });

  it("returns ~30s mid-cooldown", () => {
    const updatedAt = new Date("2026-05-02T12:00:00Z");
    const now = new Date("2026-05-02T12:00:30Z");
    expect(getEditCooldownRemaining(updatedAt, now)).toBe(30);
  });

  it("returns 0 at the cooldown boundary", () => {
    const updatedAt = new Date("2026-05-02T12:00:00Z");
    const now = new Date("2026-05-02T12:01:00Z");
    expect(getEditCooldownRemaining(updatedAt, now)).toBe(0);
  });

  it("returns 0 after the cooldown has expired", () => {
    const updatedAt = new Date("2026-05-02T12:00:00Z");
    const now = new Date("2026-05-02T12:05:00Z");
    expect(getEditCooldownRemaining(updatedAt, now)).toBe(0);
  });

  it("treats a future updatedAt (clock skew) as if just posted", () => {
    const updatedAt = new Date("2026-05-02T12:02:00Z");
    const now = new Date("2026-05-02T12:00:00Z");
    expect(getEditCooldownRemaining(updatedAt, now)).toBe(60);
  });
});
