import { colors } from "@/styles/tokens";

/*
 * Brand gradient used as the avatar fallback when an artist has no
 * `color` set (per `raw/artist-color-handoff.md`). Sourced from
 * `tokens.ts` so the gradient stays in lockstep with the rest of the
 * brand chrome — do not hardcode the gradient string here.
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
 * Solid color used when a unit has no `Artist.color` set yet.
 * Distinct from `BRAND_GRADIENT` (which is for avatars / stripes
 * that need a gradient shape) — this is a flat color suitable for
 * inline tints, vertical bars, and small pills. The event page's
 * `<UnitsCard>` and `<PerformersCard>` (for performers whose unit
 * lacks a color) both use it so a "no-color" unit still renders
 * with a visible brand-tinted accent rather than a neutral gray.
 *
 * `colors.primary` is the right pick: it's already the
 * "primary action" surface across the app, so a not-yet-themed
 * unit reads as "color pending, default to brand" instead of
 * inventing a new neutral.
 */
export const UNIT_COLOR_FALLBACK = colors.primary;

/** Resolved unit color — `Artist.color` if set, else the brand fallback. */
export function resolveUnitColor(artist: {
  color?: string | null;
}): string {
  return artist.color ?? UNIT_COLOR_FALLBACK;
}
