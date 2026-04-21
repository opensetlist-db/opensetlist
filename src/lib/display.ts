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
 * variant = resolved variant label (locale-exact translation → original fallback)
 *
 * Looks up the translation strictly by displayLocale. Unlike pickTranslation,
 * there is NO fallback to ko/en — a missing locale row falls through to the
 * parent's original fields, so a Japanese viewer never sees a Korean variant
 * label bleed through for a Japanese song with only a ko translation.
 */
export function displayOriginalTitle<
  T extends { locale: string; title: string; variantLabel?: string | null },
>(
  item: {
    originalTitle: string;
    originalLanguage: string;
    variantLabel?: string | null;
  },
  translations: readonly T[],
  displayLocale: string = "ko"
): TitleDisplay {
  const translation =
    translations.find((t) => t.locale === displayLocale) ?? null;
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
