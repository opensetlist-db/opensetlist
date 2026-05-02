import { describe, it, expect } from "vitest";
import { generateSlug, resolveCanonicalSlug } from "@/lib/slug";

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

describe("resolveCanonicalSlug", () => {
  describe("admin-supplied path (verbatim, strict)", () => {
    it("accepts an already-canonical slug verbatim", () => {
      const result = resolveCanonicalSlug("my-slug", "fallback", "event");
      expect(result).toEqual({ ok: true, slug: "my-slug" });
    });

    it("trims surrounding whitespace before validating", () => {
      const result = resolveCanonicalSlug("  my-slug  ", "fallback", "event");
      expect(result).toEqual({ ok: true, slug: "my-slug" });
    });

    it("rejects uppercase input rather than silently lowercasing", () => {
      const result = resolveCanonicalSlug("My-Slug", "fallback", "event");
      expect(result.ok).toBe(false);
    });

    it("rejects spaces in admin input", () => {
      const result = resolveCanonicalSlug("my slug", "fallback", "event");
      expect(result.ok).toBe(false);
    });

    it("rejects non-ASCII admin input", () => {
      const result = resolveCanonicalSlug("ミラクラ", "fallback", "event");
      expect(result.ok).toBe(false);
    });

    it("rejects leading/trailing hyphens", () => {
      expect(resolveCanonicalSlug("-foo", "fallback", "event").ok).toBe(false);
      expect(resolveCanonicalSlug("foo-", "fallback", "event").ok).toBe(false);
    });

    it("returns a Korean error message on rejection", () => {
      const result = resolveCanonicalSlug("My Slug!", "fallback", "event");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toMatch(/슬러그/);
      }
    });
  });

  describe("auto-fallback path (no admin slug)", () => {
    it("derives from fallbackSource when rawSlug is missing", () => {
      const result = resolveCanonicalSlug(undefined, "Cerise Bouquet", "artist");
      expect(result).toEqual({ ok: true, slug: "cerise-bouquet" });
    });

    it("derives from fallbackSource when rawSlug is blank", () => {
      const result = resolveCanonicalSlug("   ", "Cerise Bouquet", "artist");
      expect(result).toEqual({ ok: true, slug: "cerise-bouquet" });
    });

    it("falls back to ${modelPrefix}-{timestamp} when fallbackSource strips to empty", () => {
      const result = resolveCanonicalSlug(undefined, "上昇気流", "event");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.slug).toMatch(/^event-\d+$/);
      }
    });

    it("falls back to ${modelPrefix}-{timestamp} when both inputs are absent", () => {
      const result = resolveCanonicalSlug(null, "", "series");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.slug).toMatch(/^series-\d+$/);
      }
    });

    it("ignores non-string rawSlug and uses fallbackSource", () => {
      const result = resolveCanonicalSlug(42, "Hello World", "event");
      expect(result).toEqual({ ok: true, slug: "hello-world" });
    });

    it("never produces an empty slug on the auto path", () => {
      const result = resolveCanonicalSlug(undefined, "", "x");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.slug).not.toBe("");
    });
  });
});
