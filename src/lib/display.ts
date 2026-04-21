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

interface NameDisplay {
  main: string;
  sub: string | null;
  shortName: string | null;
}

/**
 * Identity-name analogue of displayOriginalTitle, for entities with
 * parent-level originalName/originalShortName/originalLanguage
 * (Artist, Group, EventSeries, Event, StageIdentity, RealPerson).
 *
 * main      = parent originalName, always shown
 * sub       = locale-specific translation.name (only when displayLocale != originalLanguage AND the names differ)
 * shortName = strict locale shortName, falling back to parent originalShortName
 *
 * Strict locale lookup — no ko/en fallback. A missing locale row falls
 * through to the parent originals, so a viewer never sees a wrong-locale
 * value bleed in.
 */
export function displayOriginalName<
  T extends { locale: string; name: string; shortName?: string | null },
>(
  item: {
    originalName: string | null;
    originalShortName?: string | null;
    originalLanguage: string;
  },
  translations: readonly T[],
  displayLocale: string
): NameDisplay {
  const translation =
    translations.find((t) => t.locale === displayLocale) ?? null;
  // During PR A's nullable transition: if `originalName` is missing, fall
  // through to the viewer's translation, then any translation, then "".
  // PR B flips `originalName` to NOT NULL so this fallback becomes dead
  // code, but it keeps headers from rendering blank in the meantime.
  const main =
    item.originalName ?? translation?.name ?? translations[0]?.name ?? "";
  const shortName =
    translation?.shortName || item.originalShortName || null;

  if (item.originalLanguage === displayLocale) {
    return { main, sub: null, shortName };
  }

  const localeName = translation?.name ?? null;
  if (!localeName || localeName === main) {
    return { main, sub: null, shortName };
  }

  return { main, sub: localeName, shortName };
}

/**
 * Strict locale lookup with parent-original fallback for a single field.
 * Use for secondary translated columns: bio, description, city, venue,
 * stageName, shortName.
 *
 * Returns translation[translationField] when it has a non-empty value,
 * else parent[parentOriginalField], else null. Never falls back to a
 * different locale's translation row.
 */
export function resolveLocalizedField<
  TParent extends Record<string, unknown>,
  TTranslation extends { locale: string } & Record<string, unknown>,
>(
  parent: TParent,
  translations: readonly TTranslation[],
  displayLocale: string,
  translationField: keyof TTranslation,
  parentOriginalField: keyof TParent
): string | null {
  const translation = translations.find((t) => t.locale === displayLocale);
  const localeValue = translation?.[translationField];
  if (typeof localeValue === "string" && localeValue.length > 0) {
    return localeValue;
  }
  const parentValue = parent[parentOriginalField];
  if (typeof parentValue === "string" && parentValue.length > 0) {
    return parentValue;
  }
  return null;
}

/**
 * Single-string convenience wrapper for link labels, badges, list rows.
 * Picks the locale-specific name (shortName in 'short' mode, full name in 'full'),
 * falling back to the parent original. Never returns null — `originalName`
 * is the ultimate floor (NOT NULL after PR B; in PR A still nullable, so
 * we coerce a missing value to empty string for callers that expect a string).
 */
export function displayNameWithFallback(
  item: {
    originalName: string | null;
    originalShortName?: string | null;
    originalLanguage: string;
  },
  translations: readonly { locale: string; name: string; shortName?: string | null }[],
  displayLocale: string,
  mode: "short" | "full" = "short"
): string {
  const translation = translations.find((t) => t.locale === displayLocale);
  if (mode === "short") {
    return (
      translation?.shortName ||
      translation?.name ||
      item.originalShortName ||
      item.originalName ||
      ""
    );
  }
  return translation?.name || item.originalName || "";
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
