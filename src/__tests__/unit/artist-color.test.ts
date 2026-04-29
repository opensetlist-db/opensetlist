import { describe, it, expect } from "vitest";
import {
  BRAND_GRADIENT,
  getArtistColor,
  resolveUnitColor,
} from "@/lib/artistColor";
import { colors, unitFallbackPalette } from "@/styles/tokens";

describe("getArtistColor", () => {
  it("returns the explicit color when set", () => {
    expect(getArtistColor({ color: "#FF6B9D" })).toBe("#FF6B9D");
    expect(getArtistColor({ color: "#0277BD" })).toBe("#0277BD");
  });

  it("returns null when color is null", () => {
    expect(getArtistColor({ color: null })).toBeNull();
  });

  it("returns null when color is undefined / absent", () => {
    expect(getArtistColor({ color: undefined })).toBeNull();
    expect(getArtistColor({})).toBeNull();
  });

  it("treats empty string as a set color (not a fallback trigger)", () => {
    // Empty string is the operator's responsibility to validate at the admin
    // form layer; the helper's job is just `?? null`. Documenting this here
    // so a future change of behavior is a deliberate decision, not a drift.
    expect(getArtistColor({ color: "" })).toBe("");
  });
});

describe("BRAND_GRADIENT", () => {
  it("matches the tokens.ts brandGradient value", () => {
    expect(BRAND_GRADIENT).toBe(colors.brandGradient);
  });
});

describe("resolveUnitColor", () => {
  it("returns Artist.color verbatim when set, ignoring slug", () => {
    expect(
      resolveUnitColor({ slug: "anything", color: "#FFB6C1" }),
    ).toBe("#FFB6C1");
    // Non-empty color short-circuits even when slug is null.
    expect(resolveUnitColor({ slug: null, color: "#123456" })).toBe(
      "#123456",
    );
  });

  it("falls back to a palette color when Artist.color is null and slug is provided", () => {
    const resolved = resolveUnitColor({
      slug: "cerise-bouquet",
      color: null,
    });
    expect(unitFallbackPalette).toContain(resolved);
  });

  it("is deterministic — same slug always produces the same color", () => {
    const a = resolveUnitColor({ slug: "dollchestra", color: null });
    const b = resolveUnitColor({ slug: "dollchestra", color: null });
    const c = resolveUnitColor({ slug: "dollchestra", color: null });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("falls back to colors.primary when both color and slug are missing", () => {
    expect(resolveUnitColor({ color: null, slug: null })).toBe(
      colors.primary,
    );
    expect(resolveUnitColor({ color: null })).toBe(colors.primary);
    expect(resolveUnitColor({})).toBe(colors.primary);
  });

  it("treats empty-string color the same as null (falls through to palette)", () => {
    // Operator data sometimes saves "" instead of null for a missing
    // color. The truthiness check on `artist.color` catches both —
    // intentional drift from `getArtistColor`'s `?? null` semantics
    // because the unit resolver's contract is "always return a
    // tintable color string", and an empty string is unusable as a
    // tint at the consumer layer.
    const resolved = resolveUnitColor({ slug: "edel-note", color: "" });
    expect(unitFallbackPalette).toContain(resolved);
  });

  it("distributes the Hasunosora seed's color-pending units across distinct palette indices", () => {
    // All nine sub-units listed in `data/examples/artists.csv`. With
    // a 10-entry palette, every slug should land on its own index —
    // verifying the seed roster doesn't accidentally collide (which
    // would defeat the "distinguishable hues" goal). If a future
    // palette resize or hash change introduces a collision, this
    // test fails loud and points at exactly which pair.
    const slugs = [
      "cerise-bouquet",
      "dollchestra",
      "mira-cra-park",
      "edel-note",
      "rurino-to-yukai-na-tsuzuri-tachi",
      "kaho-megu-gelato",
      "hasuno-kyuujitsu",
      "ritorurito",
      "princess",
    ];
    const colorBySlug = new Map(
      slugs.map((slug) => [slug, resolveUnitColor({ slug, color: null })]),
    );
    const distinctColors = new Set(colorBySlug.values());
    expect(distinctColors.size).toBe(slugs.length);
  });
});
