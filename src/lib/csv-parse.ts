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
