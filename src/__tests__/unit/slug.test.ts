import { describe, it, expect } from "vitest";
import {
  deriveSlug,
  generateSlug,
  resolveCanonicalSlug,
  validateCanonicalSlug,
} from "@/lib/slug";

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

describe("validateCanonicalSlug", () => {
  it("accepts an already-canonical slug verbatim", () => {
    expect(validateCanonicalSlug("my-slug")).toBe("my-slug");
  });

  it("trims surrounding whitespace before validating", () => {
    expect(validateCanonicalSlug("  my-slug  ")).toBe("my-slug");
  });

  it("returns null for uppercase input", () => {
    expect(validateCanonicalSlug("My-Slug")).toBeNull();
  });

  it("returns null for input with spaces", () => {
    expect(validateCanonicalSlug("my slug")).toBeNull();
  });

  it("returns null for non-ASCII input", () => {
    expect(validateCanonicalSlug("ミラクラ")).toBeNull();
  });

  it("returns null for leading/trailing hyphens", () => {
    expect(validateCanonicalSlug("-foo")).toBeNull();
    expect(validateCanonicalSlug("foo-")).toBeNull();
  });

  it("returns null for special characters", () => {
    expect(validateCanonicalSlug("my-slug!")).toBeNull();
  });

  it("returns null for blank or non-string input", () => {
    expect(validateCanonicalSlug("")).toBeNull();
    expect(validateCanonicalSlug("   ")).toBeNull();
    expect(validateCanonicalSlug(undefined)).toBeNull();
    expect(validateCanonicalSlug(null)).toBeNull();
    expect(validateCanonicalSlug(42)).toBeNull();
  });
});

describe("deriveSlug", () => {
  // These tests load kuroshiro for the transliteration cases, adding
  // ~1-2s to the suite duration. Worth it: deriveSlug is the single
  // source of truth for "what slug does this name produce" and the
  // contract is exactly what the slug-generator preview, every admin
  // POST auto-path, and generateUniqueSlug all depend on.

  it("returns ASCII slug directly when input is ASCII-derivable", async () => {
    expect(await deriveSlug("Cerise Bouquet")).toBe("cerise-bouquet");
  });

  it("preserves mixed-ASCII through the ASCII path (no transliteration)", async () => {
    expect(await deriveSlug("6th Live BGP")).toBe("6th-live-bgp");
  });

  it("transliterates Japanese katakana to romaji", async () => {
    expect(await deriveSlug("ペレニアル")).toBe("pereniaru");
  });

  it("transliterates Japanese with mixed kanji + hiragana", async () => {
    // The original Vercel-bug repro from the user's prod test.
    expect(await deriveSlug("ハナムスビ")).toBe("hanamusubi");
  });

  it("returns empty when both ASCII and transliteration produce nothing", async () => {
    // All-symbol input transliterates to whitespace which strips back to "".
    expect(await deriveSlug("★★★")).toBe("");
  });

  it("returns empty for empty input", async () => {
    expect(await deriveSlug("")).toBe("");
  });
});

describe("resolveCanonicalSlug", () => {
  describe("admin-supplied path (verbatim, strict)", () => {
    it("accepts an already-canonical slug verbatim", async () => {
      const result = await resolveCanonicalSlug("my-slug", "fallback", "event");
      expect(result).toEqual({ ok: true, slug: "my-slug" });
    });

    it("trims surrounding whitespace before validating", async () => {
      const result = await resolveCanonicalSlug("  my-slug  ", "fallback", "event");
      expect(result).toEqual({ ok: true, slug: "my-slug" });
    });

    it("rejects uppercase input rather than silently lowercasing", async () => {
      const result = await resolveCanonicalSlug("My-Slug", "fallback", "event");
      expect(result.ok).toBe(false);
    });

    it("rejects spaces in admin input", async () => {
      const result = await resolveCanonicalSlug("my slug", "fallback", "event");
      expect(result.ok).toBe(false);
    });

    it("rejects non-ASCII admin input", async () => {
      const result = await resolveCanonicalSlug("ミラクラ", "fallback", "event");
      expect(result.ok).toBe(false);
    });

    it("rejects leading/trailing hyphens", async () => {
      expect((await resolveCanonicalSlug("-foo", "fallback", "event")).ok).toBe(false);
      expect((await resolveCanonicalSlug("foo-", "fallback", "event")).ok).toBe(false);
    });

    it("returns a Korean error message on rejection", async () => {
      const result = await resolveCanonicalSlug("My Slug!", "fallback", "event");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toMatch(/슬러그/);
      }
    });
  });

  describe("auto-fallback path (no admin slug)", () => {
    it("derives from fallbackSource when rawSlug is missing", async () => {
      const result = await resolveCanonicalSlug(undefined, "Cerise Bouquet", "artist");
      expect(result).toEqual({ ok: true, slug: "cerise-bouquet" });
    });

    it("derives from fallbackSource when rawSlug is blank", async () => {
      const result = await resolveCanonicalSlug("   ", "Cerise Bouquet", "artist");
      expect(result).toEqual({ ok: true, slug: "cerise-bouquet" });
    });

    it("transliterates Japanese fallbackSource (Scope B behavior change)", async () => {
      // Pre-Scope-B this would have returned `event-{ts}` because the
      // auto-path was ASCII-only. After Scope B, every admin POST that
      // uses resolveCanonicalSlug shares songs's transliteration logic.
      const result = await resolveCanonicalSlug(undefined, "ペレニアル", "event");
      expect(result).toEqual({ ok: true, slug: "pereniaru" });
    });

    it("falls back to ${modelPrefix}-{timestamp} only when even transliteration produces empty", async () => {
      const result = await resolveCanonicalSlug(undefined, "★★★", "event");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.slug).toMatch(/^event-\d+$/);
      }
    });

    it("falls back to ${modelPrefix}-{timestamp} when both inputs are absent", async () => {
      const result = await resolveCanonicalSlug(null, "", "series");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.slug).toMatch(/^series-\d+$/);
      }
    });

    it("ignores non-string rawSlug and uses fallbackSource", async () => {
      const result = await resolveCanonicalSlug(42, "Hello World", "event");
      expect(result).toEqual({ ok: true, slug: "hello-world" });
    });

    it("never produces an empty slug on the auto path", async () => {
      const result = await resolveCanonicalSlug(undefined, "", "x");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.slug).not.toBe("");
    });
  });
});
