import { describe, it, expect } from "vitest";
import { titleFontSize } from "@/lib/ogFonts";

// scoreWeightedLength weights ASCII as 1 and CJK/Fullwidth as 2.
// Build inputs of an exact target weighted length using ASCII for odd targets
// and a mix of CJK + ASCII otherwise.
function ascii(score: number): string {
  return "a".repeat(score);
}

describe("titleFontSize — boundary regression", () => {
  describe("base = 60 (event route)", () => {
    it.each([
      // [score, expected fontSize, expected subtitleClamp, label]
      [1, 60, 2, "very short"],
      [20, 60, 2, "tier1 upper bound"],
      [21, 56, 2, "tier2 lower bound"],
      [35, 56, 2, "tier2 upper bound"],
      [36, 48, 2, "tier3 lower bound"],
      [55, 48, 2, "tier3 upper bound"],
      [56, 40, 1, "tier4 lower bound — clamp drops to 1"],
      [80, 40, 1, "tier4 upper bound"],
      [81, 34, 1, "tier5 lower bound"],
      [110, 34, 1, "tier5 upper bound"],
      [111, 30, 1, "fallback (above all tiers)"],
      [200, 30, 1, "fallback far above"],
    ])("score %i → fontSize %i, clamp %i (%s)", (score, fontSize, clamp) => {
      expect(titleFontSize(ascii(score), 60)).toEqual({
        fontSize,
        subtitleClamp: clamp,
      });
    });
  });

  describe("base = 72 (artist / song routes)", () => {
    it.each([
      [1, 72, 2, "very short"],
      [20, 72, 2, "tier1 upper bound"],
      [21, 64, 2, "tier2 lower bound"],
      [35, 64, 2, "tier2 upper bound"],
      [36, 54, 2, "tier3 lower bound"],
      [55, 54, 2, "tier3 upper bound"],
      [56, 44, 1, "tier4 lower bound — clamp drops to 1"],
      [80, 44, 1, "tier4 upper bound"],
      [81, 36, 1, "tier5 lower bound"],
      [110, 36, 1, "tier5 upper bound"],
      [111, 32, 1, "fallback"],
    ])("score %i → fontSize %i, clamp %i (%s)", (score, fontSize, clamp) => {
      expect(titleFontSize(ascii(score), 72)).toEqual({
        fontSize,
        subtitleClamp: clamp,
      });
    });
  });

  describe("CJK weighting", () => {
    it("counts hiragana as 2× — 10 hiragana scores 20 (tier1)", () => {
      // あ.repeat(10) → 10 hiragana × 2 weight = score 20 → tier1
      expect(titleFontSize("あ".repeat(10), 60)).toEqual({
        fontSize: 60,
        subtitleClamp: 2,
      });
    });

    it("counts hiragana as 2× — 11 hiragana scores 22 (tier2)", () => {
      expect(titleFontSize("あ".repeat(11), 60)).toEqual({
        fontSize: 56,
        subtitleClamp: 2,
      });
    });

    it("counts Han / kanji as 2×", () => {
      // 蓮 × 18 = score 36 → tier3
      expect(titleFontSize("蓮".repeat(18), 60)).toEqual({
        fontSize: 48,
        subtitleClamp: 2,
      });
    });

    it("counts Hangul as 2×", () => {
      // 가 × 28 = score 56 → tier4 (clamp drops to 1)
      expect(titleFontSize("가".repeat(28), 60)).toEqual({
        fontSize: 40,
        subtitleClamp: 1,
      });
    });

    it("counts Fullwidth tilde as 2×", () => {
      // 10 fullwidth tildes (U+FF5E) → score 20 → tier1
      expect(titleFontSize("～".repeat(10), 60)).toEqual({
        fontSize: 60,
        subtitleClamp: 2,
      });
    });

    it("counts wave dash (U+301C) as 2×", () => {
      // 11 wave dashes (U+301C) → score 22 → tier2 (catches U+301C → wide regression)
      expect(titleFontSize("〜".repeat(11), 60)).toEqual({
        fontSize: 56,
        subtitleClamp: 2,
      });
    });

    it("mixes ASCII (1×) and CJK (2×) correctly", () => {
      // "Dream " (6 ASCII = 6) + "～" (1 fullwidth = 2) + "Bloom" (5 ASCII = 5) = 13 → tier1
      expect(titleFontSize("Dream ～Bloom", 60)).toEqual({
        fontSize: 60,
        subtitleClamp: 2,
      });
    });
  });

  it("defaults base to 60", () => {
    expect(titleFontSize(ascii(50))).toEqual(titleFontSize(ascii(50), 60));
  });
});
