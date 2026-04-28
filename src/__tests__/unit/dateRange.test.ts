import { describe, it, expect } from "vitest";
import { formatDateRange } from "@/lib/dateRange";

describe("formatDateRange", () => {
  const SHORT: Intl.DateTimeFormatOptions = {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  };

  it("collapses to a single date when start === end", () => {
    const result = formatDateRange(
      "2026-04-25T00:00:00Z",
      "2026-04-25T00:00:00Z",
      "ko",
      SHORT,
    );
    expect(result.includes("~")).toBe(false);
    expect(result.length).toBeGreaterThan(0);
  });

  it("collapses to a single date when start and end render identically", () => {
    // Same UTC day, different times → SHORT format renders both as "4월 25일"
    // → still collapses to a single label.
    const result = formatDateRange(
      "2026-04-25T03:00:00Z",
      "2026-04-25T20:00:00Z",
      "ko",
      SHORT,
    );
    expect(result.includes("~")).toBe(false);
  });

  it("joins with `~` when start and end differ", () => {
    const result = formatDateRange(
      "2026-04-25T00:00:00Z",
      "2026-04-26T00:00:00Z",
      "ko",
      SHORT,
    );
    expect(result.includes("~")).toBe(true);
    expect(result.split("~").length).toBe(2);
  });

  it("renders Korean dates correctly", () => {
    const result = formatDateRange(
      "2026-05-23T00:00:00Z",
      "2026-05-24T00:00:00Z",
      "ko",
      SHORT,
    );
    // Korean Intl output for {month:"long", day:"numeric"} is like "5월 23일"
    expect(result).toContain("5월");
    expect(result).toContain("23");
    expect(result).toContain("24");
  });

  it("renders English dates correctly", () => {
    const result = formatDateRange(
      "2026-05-23T00:00:00Z",
      "2026-05-24T00:00:00Z",
      "en",
      SHORT,
    );
    // English Intl output for {month:"long", day:"numeric"} is "May 23"
    expect(result).toContain("May");
    expect(result).toContain("23");
    expect(result).toContain("24");
  });

  it("falls back when one side is empty", () => {
    expect(formatDateRange("", "2026-05-23T00:00:00Z", "ko", SHORT)).not.toBe(
      "",
    );
    expect(formatDateRange("2026-05-23T00:00:00Z", "", "ko", SHORT)).not.toBe(
      "",
    );
  });
});
