/**
 * Returns shortName if available, falls back to name.
 * Use 'full' mode for SEO meta tags and page H1 titles.
 * Use 'short' mode (default) everywhere else.
 */
export function displayName(
  translation: { name: string; shortName?: string | null },
  mode: "short" | "full" = "short"
): string {
  if (mode === "short") {
    return translation.shortName ?? translation.name;
  }
  return translation.name;
}

interface SongTitleDisplay {
  main: string;
  sub: string | null;
}

/**
 * Determines how to display a song title.
 *
 * main = always originalTitle.
 * sub  = localized title, shown only when:
 *   - it exists
 *   - it differs from originalTitle
 *   - originalLanguage differs from displayLocale
 */
export function displaySongTitle(
  song: { originalTitle: string; originalLanguage: string },
  translation: { title: string } | null,
  displayLocale: string = "ko"
): SongTitleDisplay {
  const main = song.originalTitle;

  if (song.originalLanguage === displayLocale) {
    return { main, sub: null };
  }

  const localeTitle = translation?.title ?? null;

  if (!localeTitle || localeTitle === main) {
    return { main, sub: null };
  }

  return { main, sub: localeTitle };
}
