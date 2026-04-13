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

interface TitleDisplay {
  main: string;
  sub: string | null;
}

/**
 * Determines how to display an original-language title (song or album).
 *
 * main = always originalTitle.
 * sub  = localized title, shown only when:
 *   - it exists
 *   - it differs from originalTitle
 *   - originalLanguage differs from displayLocale
 */
export function displayOriginalTitle(
  item: { originalTitle: string; originalLanguage: string },
  translation: { title: string } | null,
  displayLocale: string = "ko"
): TitleDisplay {
  const main = item.originalTitle;

  if (item.originalLanguage === displayLocale) {
    return { main, sub: null };
  }

  const localeTitle = translation?.title ?? null;

  if (!localeTitle || localeTitle === main) {
    return { main, sub: null };
  }

  return { main, sub: localeTitle };
}

/** @deprecated Use displayOriginalTitle instead */
export function displaySongTitle(
  song: { originalTitle: string; originalLanguage: string },
  translation: { title: string } | null,
  displayLocale: string = "ko"
): TitleDisplay {
  return displayOriginalTitle(song, translation, displayLocale);
}
