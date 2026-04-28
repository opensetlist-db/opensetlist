import { describe, it, expect } from "vitest";
import { paletteFromAnchorAndFrequency } from "@/lib/ogPalette";

// Helper — frequency map literal-style.
function freq(entries: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v]));
}

describe("paletteFromAnchorAndFrequency", () => {
  describe("with anchor set", () => {
    it("uses anchor as mesh[0] and top-2 frequency as mesh[1..2]", () => {
      const palette = paletteFromAnchorAndFrequency(
        "#e91e8c",
        freq({ "#ff6b9d": 5, "#0277bd": 3, "#7b1fa2": 1 }),
      );
      expect(palette.mesh[0]).toBe("#e91e8c");
      expect(palette.mesh[1]).toBe("#ff6b9d");
      expect(palette.mesh[2]).toBe("#0277bd");
      expect(palette.source).toBe("anchored");
    });

    it("harmonizes when only one supporting color is available", () => {
      const palette = paletteFromAnchorAndFrequency(
        "#e91e8c",
        freq({ "#ff6b9d": 5 }),
      );
      // anchor + supporting + 1 harmonized rotation. The third
      // stop is OKLCH-derived; we just assert it exists, isn't
      // empty, and isn't a duplicate of the first two.
      expect(palette.mesh[0]).toBe("#e91e8c");
      expect(palette.mesh[1]).toBe("#ff6b9d");
      expect(palette.mesh[2]).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(palette.mesh[2]).not.toBe(palette.mesh[0]);
      expect(palette.mesh[2]).not.toBe(palette.mesh[1]);
      expect(palette.source).toBe("anchored");
    });

    it("harmonizes from anchor alone when no supporting colors exist", () => {
      const palette = paletteFromAnchorAndFrequency("#0277bd", freq({}));
      // [anchor, anchor+30°, anchor-30°] — three distinct stops,
      // mesh[0] is the anchor verbatim, the others derived.
      expect(palette.mesh[0]).toBe("#0277bd");
      expect(palette.mesh[1]).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(palette.mesh[2]).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(new Set(palette.mesh).size).toBe(3);
      expect(palette.source).toBe("anchored");
    });

    it("dedupes anchor from the supporting candidate pool", () => {
      // The anchor color also appears in the frequency map (e.g.
      // a member's personal color matches the unit's brand color).
      // mesh[0] is still the anchor; mesh[1..2] skip the dupe and
      // pick the next-top entries.
      const palette = paletteFromAnchorAndFrequency(
        "#e91e8c",
        freq({ "#e91e8c": 10, "#ff6b9d": 5, "#0277bd": 3 }),
      );
      expect(palette.mesh[0]).toBe("#e91e8c");
      expect(palette.mesh[1]).toBe("#ff6b9d");
      expect(palette.mesh[2]).toBe("#0277bd");
      expect(palette.source).toBe("anchored");
    });

    it("normalizes anchor casing to lowercase", () => {
      const palette = paletteFromAnchorAndFrequency(
        "#E91E8C",
        freq({ "#ff6b9d": 5, "#0277bd": 3 }),
      );
      expect(palette.mesh[0]).toBe("#e91e8c");
    });
  });

  describe("with null/invalid anchor (regression — existing behavior)", () => {
    it("uses faithful path when frequency has 3+ colors", () => {
      const palette = paletteFromAnchorAndFrequency(
        null,
        freq({ "#0277bd": 5, "#ff6b9d": 3, "#7b1fa2": 1 }),
      );
      expect(palette.mesh).toEqual(["#0277bd", "#ff6b9d", "#7b1fa2"]);
      expect(palette.source).toBe("faithful");
    });

    it("uses harmonized path when frequency has <3 colors", () => {
      const palette = paletteFromAnchorAndFrequency(
        null,
        freq({ "#0277bd": 5 }),
      );
      expect(palette.mesh[0]).toBe("#0277bd");
      expect(palette.source).toBe("harmonized");
    });

    it("falls back when frequency is empty", () => {
      const palette = paletteFromAnchorAndFrequency(null, freq({}));
      expect(palette.source).toBe("fallback");
    });

    it("treats malformed anchor hex as null", () => {
      const palette = paletteFromAnchorAndFrequency(
        "not-a-color",
        freq({ "#0277bd": 5, "#ff6b9d": 3, "#7b1fa2": 1 }),
      );
      // Same mesh + source as the null-anchor case.
      expect(palette.mesh).toEqual(["#0277bd", "#ff6b9d", "#7b1fa2"]);
      expect(palette.source).toBe("faithful");
    });

    it("treats empty-string anchor as null", () => {
      const palette = paletteFromAnchorAndFrequency("", freq({}));
      expect(palette.source).toBe("fallback");
    });
  });

  describe("fingerprint", () => {
    it("differs between anchored and faithful for the same frequency", () => {
      const sharedFreq = freq({ "#ff6b9d": 5, "#0277bd": 3, "#7b1fa2": 1 });
      const anchored = paletteFromAnchorAndFrequency("#e91e8c", sharedFreq);
      const faithful = paletteFromAnchorAndFrequency(null, sharedFreq);
      // Anchoring shifts mesh[0] to a new color and bumps mesh[2]
      // out — fingerprints diverge so existing CDN cache busts on
      // first deploy of the anchor change.
      expect(anchored.fingerprint).not.toBe(faithful.fingerprint);
    });

    it("is stable across calls with the same input", () => {
      const a = paletteFromAnchorAndFrequency(
        "#e91e8c",
        freq({ "#ff6b9d": 5, "#0277bd": 3 }),
      );
      const b = paletteFromAnchorAndFrequency(
        "#e91e8c",
        freq({ "#ff6b9d": 5, "#0277bd": 3 }),
      );
      expect(a.fingerprint).toBe(b.fingerprint);
    });
  });
});
