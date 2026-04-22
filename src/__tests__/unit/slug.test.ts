import { describe, it, expect } from "vitest";
import { generateSlug, resolveAdminSlug } from "@/lib/slug";

describe("generateSlug", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(generateSlug("Cerise Bouquet")).toBe("cerise-bouquet");
  });

  it("keeps already lowercase text", () => {
    expect(generateSlug("dollchestra")).toBe("dollchestra");
  });

  it("removes special characters", () => {
    expect(generateSlug("ミラクラパーク!")).toBe("");
  });

  it("handles mixed ASCII and non-ASCII", () => {
    expect(generateSlug("6th Live BGP")).toBe("6th-live-bgp");
  });

  it("collapses consecutive hyphens", () => {
    expect(generateSlug("Dream  Believers")).toBe("dream-believers");
  });

  it("trims leading and trailing hyphens", () => {
    expect(generateSlug(" test ")).toBe("test");
  });

  it("replaces underscores with hyphens", () => {
    expect(generateSlug("dream_believers")).toBe("dream-believers");
  });

  it("truncates to 100 characters", () => {
    const long = "a".repeat(150);
    expect(generateSlug(long).length).toBe(100);
  });
});

describe("resolveAdminSlug", () => {
  it("normalizes admin-supplied slug (trim + generateSlug)", () => {
    expect(resolveAdminSlug("  My Slug  ", "fallback", "event")).toBe("my-slug");
  });

  it("falls back to fallbackSource when rawSlug is missing", () => {
    expect(resolveAdminSlug(undefined, "Cerise Bouquet", "artist")).toBe("cerise-bouquet");
  });

  it("falls back to fallbackSource when rawSlug is blank", () => {
    expect(resolveAdminSlug("   ", "Cerise Bouquet", "artist")).toBe("cerise-bouquet");
  });

  it("falls back to fallbackSource when rawSlug normalizes to empty (non-ASCII)", () => {
    expect(resolveAdminSlug("ミラクラ", "Cerise Bouquet", "artist")).toBe("cerise-bouquet");
  });

  it("falls back to ${modelPrefix}-{timestamp} when both inputs normalize to empty", () => {
    const result = resolveAdminSlug("ミラクラ", "上昇気流", "event");
    expect(result).toMatch(/^event-\d+$/);
  });

  it("falls back to ${modelPrefix}-{timestamp} when both inputs are missing", () => {
    const result = resolveAdminSlug(null, "", "series");
    expect(result).toMatch(/^series-\d+$/);
  });

  it("never returns an empty string", () => {
    expect(resolveAdminSlug("", "", "x")).not.toBe("");
    expect(resolveAdminSlug("★", "★", "x")).not.toBe("");
    expect(resolveAdminSlug(undefined, "", "x")).not.toBe("");
  });

  it("ignores non-string rawSlug and uses fallbackSource", () => {
    expect(resolveAdminSlug(42, "Hello World", "event")).toBe("hello-world");
    expect(resolveAdminSlug({}, "Hello World", "event")).toBe("hello-world");
  });
});
