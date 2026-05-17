import { describe, it, expect } from "vitest";
import { formatDate } from "@/lib/utils";

// Fixed UTC instant + UTC-pinned options so the test doesn't depend on the
// runner's local timezone. Intl.DateTimeFormat output otherwise drifts by ±1
// day around midnight UTC if the runner is in a non-UTC zone.
const FIXED_DATE = new Date("2026-05-17T12:00:00Z");
const OPTIONS = {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
} as const;

describe("formatDate", () => {
  it("maps ko → ko-KR (exact match against Intl.DateTimeFormat output)", () => {
    const expected = new Intl.DateTimeFormat("ko-KR", OPTIONS).format(FIXED_DATE);
    expect(formatDate(FIXED_DATE, "ko", OPTIONS)).toBe(expected);
  });

  it("maps ja → ja-JP", () => {
    const expected = new Intl.DateTimeFormat("ja-JP", OPTIONS).format(FIXED_DATE);
    expect(formatDate(FIXED_DATE, "ja", OPTIONS)).toBe(expected);
  });

  it("maps en → en-US", () => {
    const expected = new Intl.DateTimeFormat("en-US", OPTIONS).format(FIXED_DATE);
    expect(formatDate(FIXED_DATE, "en", OPTIONS)).toBe(expected);
  });

  it("returns empty string for null / undefined date", () => {
    expect(formatDate(null, "ko")).toBe("");
    expect(formatDate(undefined, "ko")).toBe("");
  });

  it("accepts ISO string and parses it", () => {
    const expected = new Intl.DateTimeFormat("en-US", OPTIONS).format(FIXED_DATE);
    expect(formatDate("2026-05-17T12:00:00Z", "en", OPTIONS)).toBe(expected);
  });

  // Defense-in-depth case: scanner traffic to paths like /.env, /.git bypasses
  // the next-intl middleware matcher (which excludes dot-paths) and reaches
  // the [locale] route with locale=".env". Before the fix, toLocaleDateString
  // threw RangeError and 500'd the response — Sentry event 7453030684
  // (2026-05-17). After the fix, formatDate falls back to en-US instead of
  // crashing. The [locale] layout + page guards also reject these with
  // notFound(), so the rendered date is never user-visible in practice; this
  // is the inner safety net.
  it.each([".env", ".git", "wp-login.php", "totally-not-a-locale"])(
    "falls back to en-US output for invalid locale %j",
    (invalidLocale) => {
      const expected = new Intl.DateTimeFormat("en-US", OPTIONS).format(FIXED_DATE);
      expect(formatDate(FIXED_DATE, invalidLocale, OPTIONS)).toBe(expected);
    },
  );
});
