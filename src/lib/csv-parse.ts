/**
 * Pure parsing helpers for CSV import — extracted for testability.
 */

/** Parse space-separated artist slugs. Returns empty array for empty/undefined input. */
export function parseArtistSlugs(value: string | undefined | null): string[] {
  if (!value) return [];
  return value.trim().split(/\s+/).filter(Boolean);
}

/** Resolve originalLanguage from CSV row value, with default. */
export function resolveOriginalLanguage(value: string | undefined | null): string {
  return value?.trim() || "ja";
}
