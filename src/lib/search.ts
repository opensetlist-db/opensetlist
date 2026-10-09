/**
 * Pure search/filter helpers for admin UI search components.
 */

export function matchesSongSearch(
  song: {
    originalTitle: string;
    translations: { locale: string; title: string }[];
  },
  query: string
): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (song.originalTitle.toLowerCase().includes(q)) return true;
  return song.translations.some((t) => t.title.toLowerCase().includes(q));
}

export function matchesIdentitySearch(
  si: { translations: { locale: string; name: string }[] },
  query: string
): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return si.translations.some((t) => t.name.toLowerCase().includes(q));
}

/**
 * Fold the look-alike characters an operator's keyboard produces into
 * the ones stored in artist names, so a live-entry search can't miss
 * on an invisible code-point difference. μ's is stored with GREEK
 * SMALL LETTER MU (U+03BC) everywhere; a Korean/Japanese IME or a
 * Windows keyboard tends to produce MICRO SIGN (U+00B5) or a
 * full-width form — NFKC maps both to U+03BC (and full-width Latin to
 * ASCII). Curly apostrophes (’ ‘ ＇) become the ASCII ' the names use.
 */
export function normalizeArtistQuery(q: string): string {
  return q
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u02BC\uFF07]/g, "'")
    .trim();
}
