import { describe, it, expect } from "vitest";
import { formatDate } from "@/lib/utils";

describe("formatDate", () => {
  const fixedUtcDate = new Date("2026-05-17T12:00:00Z");

  it("formats with mapped locale tag (ko → ko-KR)", () => {
    const result = formatDate(fixedUtcDate, "ko");
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });

  it("formats with mapped locale tag (ja → ja-JP)", () => {
    const result = formatDate(fixedUtcDate, "ja");
    expect(result).toBeTruthy();
  });

  it("returns empty string for null / undefined date", () => {
    expect(formatDate(null, "ko")).toBe("");
    expect(formatDate(undefined, "ko")).toBe("");
  });

  it("accepts ISO string and parses it", () => {
    const result = formatDate("2026-05-17T12:00:00Z", "en");
    expect(result).toBeTruthy();
  });

  // Defense-in-depth case: scanner traffic to paths like /.env, /.git
  // bypasses the next-intl middleware matcher (which excludes dot-paths)
  // and reaches the [locale] route with locale=".env". Before the fix,
  // toLocaleDateString threw RangeError and 500'd the response — Sentry
  // event 7453030684 (2026-05-17). After the fix, the page renders with
  // en-US date formatting instead of crashing. The [locale] layout +
  // page guards also reject these with notFound(), so the rendered date
  // is never user-visible in practice; this is the inner safety net.
  it("falls back to en-US on invalid locale tag rather than throwing", () => {
    expect(() => formatDate(fixedUtcDate, ".env")).not.toThrow();
    expect(() => formatDate(fixedUtcDate, ".git")).not.toThrow();
    expect(() => formatDate(fixedUtcDate, "wp-login.php")).not.toThrow();
    expect(() => formatDate(fixedUtcDate, "totally-not-a-locale")).not.toThrow();
  });

  it("invalid-locale fallback produces a non-empty string", () => {
    const result = formatDate(fixedUtcDate, ".env");
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
