import { describe, it, expect } from "vitest";
import { avatarAccent, avatarGlyphTone } from "@/components/artists/artistList";
import { BRAND_GRADIENT } from "@/lib/artistColor";

// Input colours are artist data (series colours from the official
// sites), not palette copies — see eslint-rules/hex-colour-literals.mjs.
const NIJIGASAKI_YELLOW = "#FBB906";
const MUSE_PINK = "#E50080";
const MID_GREY = "#777777";

describe("avatarAccent", () => {
  it("paints a stored #RRGGBB colour as is", () => {
    expect(avatarAccent(MUSE_PINK)).toBe(MUSE_PINK);
  });

  it("falls back to the brand gradient for no or malformed colour", () => {
    expect(avatarAccent(null)).toBe(BRAND_GRADIENT);
    expect(avatarAccent("red")).toBe(BRAND_GRADIENT);
  });
});

describe("avatarGlyphTone", () => {
  it("keeps the white glyph on the brand gradient (no stored colour)", () => {
    expect(avatarGlyphTone(null)).toBe("white");
  });

  it("treats a non-hex value like no colour", () => {
    expect(avatarGlyphTone("red")).toBe("white");
    expect(avatarGlyphTone("#FFF")).toBe("white");
  });

  it("uses ink on a light colour where white would fail 4.5:1", () => {
    expect(avatarGlyphTone(NIJIGASAKI_YELLOW)).toBe("ink");
  });

  it("uses white on a saturated dark colour", () => {
    expect(avatarGlyphTone(MUSE_PINK)).toBe("white");
  });

  it("falls back to black when neither ink nor white reaches 4.5:1", () => {
    expect(avatarGlyphTone(MID_GREY)).toBe("black");
  });
});
