/**
 * Pure parsing helpers for CSV import — extracted for testability.
 */

/** Parse space-separated artist slugs. Returns empty array for empty/undefined input. */
export function parseArtistSlugs(value: string | undefined | null): string[] {
  if (!value) return [];
  return value.trim().split(/\s+/).filter(Boolean);
}

/**
 * Resolve originalLanguage from CSV row value, with default "ja".
 *
 * Normalizes the legacy `jp` alias to the canonical `ja` so Album rows
 * imported from Hasunosora CSVs stop landing in the DB with a locale code
 * that doesn't match any *Translation row's locale. Unknown values throw
 * loudly — silent pass-through is how the `jp` mismatch escaped review in
 * the first place.
 */
const VALID_ORIGINAL_LANGUAGES = new Set(["ko", "ja", "en", "zh-CN"]);
export function resolveOriginalLanguage(value: string | undefined | null): string {
  const raw = (value?.trim() || "ja").toLowerCase();
  const normalized =
    raw === "jp" ? "ja" :
    raw === "zh-cn" ? "zh-CN" :
    raw;
  if (!VALID_ORIGINAL_LANGUAGES.has(normalized)) {
    throw new Error(`Unknown originalLanguage: ${value}`);
  }
  return normalized;
}

export interface TranslationRow {
  locale: string;
  title: string;
  variantLabel: string | null;
}

/**
 * Resolve song translations from a CSV row.
 * Returns { translations, removedLocales } where:
 * - translations: locale rows to upsert (title and/or variantLabel present)
 * - removedLocales: locales with no data that should be deleted from DB
 */
export function resolveSongTranslations(row: Record<string, string>): {
  translations: TranslationRow[];
  removedLocales: string[];
} {
  const LOCALES = ["ja", "ko", "en"] as const;

  const translations: TranslationRow[] = [];
  for (const locale of LOCALES) {
    const title = row[`${locale}_title`] || "";
    const variantLabel = row[`${locale}_variantLabel`] || null;
    if (title || variantLabel) {
      translations.push({ locale, title, variantLabel });
    }
  }

  const presentLocales = new Set(translations.map((t) => t.locale));
  const removedLocales = LOCALES.filter((l) => !presentLocales.has(l));

  return { translations, removedLocales };
}
