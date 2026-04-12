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
