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
