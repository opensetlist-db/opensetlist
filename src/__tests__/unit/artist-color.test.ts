import { describe, it, expect } from "vitest";
import { BRAND_GRADIENT, getArtistColor } from "@/lib/artistColor";
import { colors } from "@/styles/tokens";

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
