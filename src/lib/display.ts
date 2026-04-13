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
  variant: string | null;
}

/**
 * Determines how to display an original-language title (song or album).
 *
 * main    = always originalTitle
 * sub     = localized title (when different from original and locale differs)
 * variant = resolved variant label (localized → original fallback)
 */
export function displayOriginalTitle(
  item: { originalTitle: string; originalLanguage: string; variantLabel?: string | null },
  translation: { title: string; variantLabel?: string | null } | null,
  displayLocale: string = "ko"
): TitleDisplay {
  const main = item.originalTitle;
  const variant = translation?.variantLabel || item.variantLabel || null;

  if (item.originalLanguage === displayLocale) {
    return { main, sub: null, variant };
  }

  const localeTitle = translation?.title ?? null;

  if (!localeTitle || localeTitle === main) {
    return { main, sub: null, variant };
  }

  return { main, sub: localeTitle, variant };
}

/** @deprecated Use displayOriginalTitle instead */
export function displaySongTitle(
  song: { originalTitle: string; originalLanguage: string; variantLabel?: string | null },
  translation: { title: string; variantLabel?: string | null } | null,
  displayLocale: string = "ko"
): TitleDisplay {
  return displayOriginalTitle(song, translation, displayLocale);
}
