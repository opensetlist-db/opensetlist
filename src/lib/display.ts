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
 * Translation-primary: the viewer's locale name is the main label,
 * the original-language name is the secondary `sub` line. Song /
 * album titles stay original-primary via `displayOriginalTitle`
 * (artwork identity is the original title); identity names of
 * people / groups / events / series flip here so a Korean viewer
 * sees the Korean rendering on top of a Japanese tour.
 *
 * main      = locale translation when present and locale differs
 *             from originalLanguage; otherwise the original
 * sub       = original-language name (only when displayLocale !=
 *             originalLanguage AND the two names differ)
 * shortName = strict locale shortName, falling back to parent
 *             originalShortName
 *
 * Strict locale lookup — no ko/en fallback. A missing locale row
 * falls through to the original, so a viewer never sees a
 * wrong-locale value bleed in.
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
  const originalTranslation =
    translations.find((t) => t.locale === item.originalLanguage) ?? null;
  // Resolve the original-language string. During PR A's nullable
  // transition `originalName` may be missing — fall through to the
  // row in the entity's declared `originalLanguage` (strict — never
  // an arbitrary translations[0]), then the viewer's locale, then "".
  const original =
    item.originalName ??
    originalTranslation?.name ??
    translation?.name ??
    "";
  const shortName =
    translation?.shortName || item.originalShortName || null;

  // Same locale as origin: nothing to flip — original *is* the
  // viewer's language.
  if (item.originalLanguage === displayLocale) {
    return { main: original, sub: null, shortName };
  }

  // No translation for the viewer's locale (or it matches the
  // original byte-for-byte): fall back to original-only display, no
  // sub. Never bleeds a non-matching locale into either slot.
  const localeName = translation?.name ?? null;
  if (!localeName || localeName === original) {
    return { main: original, sub: null, shortName };
  }

  // Cross-locale + distinct translation: viewer's language is the
  // headline; original-language name reads as the parenthetical
  // below.
  return { main: localeName, sub: original, shortName };
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
  mode: "short" | "full" = "full"
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
