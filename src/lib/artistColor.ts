import { colors, unitFallbackPalette } from "@/styles/tokens";

/*
 * Brand gradient used as the avatar fallback when an artist has no
 * `color` set (per `raw/artist-color-handoff.md`). Sourced from
 * `tokens.ts` so the gradient stays in lockstep with the rest of the
 * brand chrome — do not hardcode the gradient string here.
 *
 * Used by `<ArtistAvatar>` and `<ColorStripe>` for any artist
 * (solo / group / unit) without a color. Unit-specific surfaces
 * (artist page UnitCard, setlist row UnitBadge, event-page Units /
 * Performers cards) prefer `resolveUnitColor` below — that helper
 * walks a deterministic palette so multiple color-pending units on
 * the same page render distinguishably instead of collapsing to a
 * single brand-blue placeholder.
 */
export const BRAND_GRADIENT = colors.brandGradient;

/**
 * Returns the artist's display color, or null if none is set. Callers
 * fall back to BRAND_GRADIENT when null. Centralized so any future
 * change to the fallback rule (e.g., per-group default colors) only
 * touches this one helper. Both `<ArtistAvatar>` and the detail-page
 * ColorStripe import this — keeps the contract identical across
 * surfaces.
 */
export function getArtistColor(artist: {
  color?: string | null;
}): string | null {
  return artist.color ?? null;
}

/**
 * Stable string-to-int hash for `resolveUnitColor`'s palette index
 * lookup. FNV-1a 32-bit accumulator + MurmurHash3's `fmix32`
 * finalizer to disperse the low bits — without `fmix32`, FNV-1a's
 * lower nibble clusters on short ASCII slugs and `% palette.length`
 * (with palette.length ≤ ~16) collapses several Hasunosora sub-unit
 * slugs onto the same bucket. The finalizer is the standard
 * Murmur3 mix; not cryptographic, just there to give every output
 * bit roughly equal influence over the result before modulo.
 *
 * Same slug always lands on the same palette color across renders,
 * surfaces (artist page / event page / setlist row), and server
 * restarts.
 */
function hashUnitSlug(slug: string): number {
  // 32-bit FNV-1a: offset basis 2166136261, prime 16777619.
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // MurmurHash3 fmix32 — disperses bits so any modulo is uniform.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Resolved unit color, with a deterministic palette fallback.
 *
 * Order of preference:
 *   1. `Artist.color` if the operator has backfilled it (full
 *      opacity hex string).
 *   2. A deterministic pick from `unitFallbackPalette`, indexed by
 *      `hashUnitSlug(slug) % palette.length` — same unit always
 *      lands on the same color so the artist-page Unit card, the
 *      setlist-row pill, and the event-page Units sidebar agree.
 *   3. `colors.primary` as a last resort when neither color nor slug
 *      is available (defensive — shouldn't happen for any real
 *      Artist row since slug is unique-and-required).
 *
 * The palette ensures multiple color-pending units on the same page
 * render with visibly different hues instead of all collapsing to
 * the same brand-blue placeholder. Once the operator backfills
 * `Artist.color`, the palette fallback is bypassed entirely.
 */
export function resolveUnitColor(artist: {
  slug?: string | null;
  color?: string | null;
}): string {
  if (artist.color) return artist.color;
  if (artist.slug) {
    const idx = hashUnitSlug(artist.slug) % unitFallbackPalette.length;
    return unitFallbackPalette[idx];
  }
  return colors.primary;
}
