import { colors } from "@/styles/tokens";

/*
 * Pure helpers for the artist list page. Kept out of any component
 * module so server components and unit tests import plain values.
 */

/** Glyph colour class for an artist initial square; maps 1:1 to
 *  `.glyphInk` / `.glyphWhite` / `.glyphBlack` in artistList.module.css. */
export type AvatarGlyphTone = "ink" | "white" | "black";

const HEX6 = /^#[0-9a-f]{6}$/i;

/** WCAG relative luminance of a `#RRGGBB` colour. */
function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Initial-glyph colour over an artist's stored colour (24-v1 contract).
 *
 * The old list painted every initial white, which drops below 2:1 on
 * pastel source colours (e.g. a light yellow unit). The approved packet
 * picks, in order: the ink tone when it reaches 4.5:1 on the colour,
 * else white when white does, else black (the only foreground left that
 * can reach 4.5:1 on a mid-tone). No stored colour means the brand
 * gradient, which keeps the white glyph. A non-hex value (never stored
 * — `nullableHexColor` validates writes) is treated like no colour.
 *
 * The square is decorative (`aria-hidden`; the full name sits beside
 * it), so this is a legibility refinement, not an accessibility gate.
 */
export function avatarGlyphTone(color: string | null): AvatarGlyphTone {
  if (!color || !HEX6.test(color)) return "white";
  const bg = relativeLuminance(color);
  const ink = relativeLuminance(colors.textPrimary);
  if ((bg + 0.05) / (ink + 0.05) >= 4.5) return "ink";
  if (1.05 / (bg + 0.05) >= 4.5) return "white";
  return "black";
}
