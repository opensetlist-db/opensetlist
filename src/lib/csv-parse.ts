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

export type OriginalsFieldMap<T> = ReadonlyArray<{
  /** CSV column name for the explicit override (e.g. "originalName" or "series_originalName"). */
  override: string;
  /** Translation row field to derive from when no override is provided; null = override-only. */
  sourceKey: (keyof T & string) | null;
  /** Output property name on the parent (e.g. "originalName" — matches the Prisma column). */
  out: string;
}>;

/**
 * Resolve parent-level `original*` fields from a CSV row.
 *
 * Per-field precedence: explicit override column > value from the
 * `originalLanguage`-matching translation row > omit (preserve existing).
 *
 * `originalLanguage` is only included in the output when the resolved
 * `originalName` is non-empty. Writing `originalLanguage` alongside a
 * stale `originalName` would tag a parent's identity with a language
 * that doesn't match its actual values — the bug PR A exists to prevent.
 */
export function buildOriginals<T extends Record<string, unknown>>(
  row: Record<string, string>,
  source: T | null,
  originalLanguage: string,
  fieldMap: OriginalsFieldMap<T>
): Record<string, string | null> {
  const fields: Record<string, string | null> = {};
  for (const { override, sourceKey, out } of fieldMap) {
    const explicit = row[override]?.trim();
    if (explicit) {
      fields[out] = explicit;
      continue;
    }
    if (sourceKey !== null && source !== null) {
      const v = source[sourceKey];
      // Trim source values too so a stray whitespace-only translation cell
      // doesn't leak into the parent's identity columns. Mirrors the trim
      // applied to explicit override values above.
      const trimmed = typeof v === "string" ? v.trim() : "";
      fields[out] = trimmed.length > 0 ? trimmed : null;
    }
  }
  const name = fields.originalName;
  if (typeof name === "string" && name.length > 0) {
    return { originalLanguage, ...fields };
  }
  return fields;
}

/** Thrown when a CSV row violates an import-time invariant (e.g. missing required identity columns). */
export class ImportValidationError extends Error {}

/**
 * Throw when a create branch would persist NULL `originalName` — schema is
 * NOT NULL on every entity, and a missing identity column reintroduces the
 * locale-bleed state PR A/B exist to prevent. Returns the narrowed string
 * for direct use in the create payload.
 */
export function ensureOriginalName(
  originals: Record<string, string | null>,
  slug: string,
  entity: string,
  originalLanguage: string
): string {
  const v = originals.originalName;
  if (typeof v !== "string" || v.length === 0) {
    throw new ImportValidationError(
      `${entity} "${slug}" has no originalName — provide an "originalName" override column or a ${originalLanguage}_name translation row (originalLanguage=${originalLanguage}).`
    );
  }
  return v;
}
