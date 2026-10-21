import type { CSSProperties } from "react";
import { colors, unitFallbackPalette } from "@/styles/tokens";

/*
 * Small pure helpers shared by the artist detail page's components.
 * Kept out of the "use client" modules on purpose: server components
 * import these, and a plain value exported from a client module can
 * resolve to undefined during SSR.
 */

/** Muted fallback for a member with neither unit nor own colour
 *  (20-v1 contract: unit colour → stage-identity colour → muted). */
export const MEMBER_FALLBACK_COLOR = colors.textMuted;

/** Identity-panel stripe for an artist without a stored colour: the
 *  approved 20-v1 blue → violet ramp (primary → the fallback palette's
 *  purple; decorative, never behind text). */
export const IDENTITY_FALLBACK_ACCENT = `linear-gradient(${colors.primary}, ${unitFallbackPalette[2]})`;

/**
 * Inline custom properties consumed by `artistDetail.module.css`:
 * `--accent` paints stripes/rings, `--wash` is the same colour at
 * 0x18 alpha (~9%) for card backgrounds. Expects `#RRGGBB` — every
 * stored artist/member colour passes `nullableHexColor` validation, and
 * the unit fallback palette is six-digit hex too. A non-hex value
 * (e.g. the brand gradient on the identity stripe) goes only into
 * `--accent`.
 */
export function accentStyle(color: string): CSSProperties {
  const isHex = /^#[0-9a-f]{6}$/i.test(color);
  return {
    "--accent": color,
    ...(isHex ? { "--wash": `${color}18` } : {}),
  } as CSSProperties;
}

/**
 * Language of a name rendered through `displayNameWithFallback`. The
 * helper shows the viewer-locale translation when one exists and the
 * original-language name otherwise; in the second case the element
 * needs `lang` so screen readers and font fallback treat e.g. a
 * Japanese name on an English page as Japanese. Returns `undefined`
 * when the text is in the page language (inherit from <html>).
 */
export function fallbackNameLang(
  item: { originalLanguage: string },
  translations: readonly { locale: string; name: string }[],
  locale: string,
): string | undefined {
  const hasLocaleName = translations.some(
    (t) => t.locale === locale && Boolean(t.name),
  );
  if (hasLocaleName || item.originalLanguage === locale) return undefined;
  return item.originalLanguage;
}

/** `lang` for text known to be in the entity's original language. */
export function originalLang(
  originalLanguage: string,
  locale: string,
): string | undefined {
  return originalLanguage === locale ? undefined : originalLanguage;
}

/**
 * First user-perceived character. `charAt(0)` splits surrogate pairs
 * and combining sequences (an emoji or a decomposed Hangul syllable
 * would render as a broken glyph in the 40px initial circle).
 */
export function firstGrapheme(label: string): string {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const { segment } of segmenter.segment(label.trim())) return segment;
  return "?";
}
