interface NameDisplay {
  main: string;
  sub: string | null;
  shortName: string | null;
}

function localeRow<T extends { locale: string }>(rows: readonly T[], locale: string) {
  return rows.find((row) => row.locale === locale);
}

// Match the title audit's script rules without changing the stored spelling.
function titleScript(original: string) {
  let readable = false;
  let afterLatin = false;
  for (const char of original.normalize("NFKC")) {
    if (/\p{Script=Latin}/u.test(char)) {
      readable = afterLatin = true;
    } else if (/[0-9]/u.test(char)) {
      readable = true;
      afterLatin = false;
    } else if (!afterLatin || !/\p{Mark}/u.test(char)) {
      afterLatin = false;
      if (/[\p{Letter}\p{Number}]/u.test(char)) return "other";
      if (!/[\p{Punctuation}\p{Symbol}\p{Separator}\s]/u.test(char)) return "review";
    }
  }
  return readable ? "exempt" : "review";
}

/**
 * Original-first display and completeness for a populated source field.
 * Use kind "title" for titles, including event names; other fields never get
 * the title exemption. Resolve the original separately from the locale row.
 * A matching stored value renders once, but only counts as confirmed when
 * the caller has evidence for that exact field and locale. "present" means
 * a distinct value exists; it makes no claim about translation quality.
 */
export function resolveDisplayPair<T extends { locale: string }>(
  source: { original: string; originalLanguage: string },
  translations: readonly T[],
  displayLocale: string,
  field: keyof T,
  options: { kind?: "title"; sameValueConfirmed?: boolean } = {},
) {
  const main = source.original;
  const script = options.kind === "title" ? titleScript(main) : null;
  if (script === "exempt") return { main, sub: null, status: "exempt" } as const;

  const value = localeRow(translations, displayLocale)?.[field];
  if (typeof value === "string" && value.trim() && value !== main) {
    return { main, sub: value, status: "present" } as const;
  }
  if (source.originalLanguage === displayLocale) {
    return { main, sub: null, status: "original-language" } as const;
  }
  if (value === main && main.trim()) {
    const status = options.sameValueConfirmed ? "confirmed-same" : "unconfirmed-same";
    return { main, sub: null, status } as const;
  }
  const status = script === "review" ? "title-review" : "missing";
  return { main, sub: null, status } as const;
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
  const translation = localeRow(translations, displayLocale);
  const originalTranslation = localeRow(translations, item.originalLanguage);
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
  const translation = localeRow(translations, displayLocale);
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
  const translation = localeRow(translations, displayLocale);
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

/**
 * Resolve the original-language short label for a "canonical-script"
 * avatar initial — the round member-page hero chip wants the source
 * script's first character (e.g. 瑠 for 瑠璃乃, not the surname's 大),
 * regardless of the viewer's locale. Distinct from
 * `displayNameWithFallback("short")`, which is locale-primary and
 * suitable for body text and locale-aware UI labels.
 *
 * Resolution order (mirrors `displayOriginalName`'s original-name
 * cascade for shape consistency):
 *   1. parent `originalShortName`
 *   2. translation row matching `originalLanguage`'s `shortName`
 *      — strict locale lookup so a non-original-locale shortName
 *      never bleeds into the canonical glyph
 *   3. `fullOriginalFallback` — the original-language full name string
 *      the caller has already resolved, so an entry without a curated
 *      `originalShortName` still gets a meaningful glyph (the legacy
 *      "first char of full name" behavior)
 *   4. `"?"` — last-resort literal so the avatar never renders blank
 *
 * Returns the entire string; the avatar component takes `.charAt(0)`.
 * Pure / locale-agnostic — safe to unit-test as a single fallback
 * chain. The current sole caller is the member-page character avatar;
 * any future surface that wants the same canonical-script intent
 * (artist hero, RealPerson detail, etc.) should reuse this helper
 * rather than re-inlining the chain.
 */
export function resolveOriginalShortLabel(
  item: {
    originalShortName?: string | null;
    originalLanguage: string;
  },
  translations: readonly { locale: string; shortName?: string | null }[],
  fullOriginalFallback: string | null,
): string {
  const originalLangTranslation = translations.find(
    (t) => t.locale === item.originalLanguage,
  );
  return (
    item.originalShortName ||
    originalLangTranslation?.shortName ||
    fullOriginalFallback ||
    "?"
  );
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
 * Opt into "paired" as each surface adopts the shared title policy.
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
  displayLocale: string = "ko",
  policy: "legacy" | "paired" = "legacy",
): TitleDisplay {
  const translation = localeRow(translations, displayLocale);
  const main = item.originalTitle;
  const variant = translation?.variantLabel || item.variantLabel || null;

  if (policy === "paired") {
    const { sub } = resolveDisplayPair(
      { original: main, originalLanguage: item.originalLanguage },
      translations, displayLocale, "title", { kind: "title" },
    );
    return { main, sub, variant };
  }

  if (item.originalLanguage === displayLocale) {
    return { main, sub: null, variant };
  }

  const localeTitle = translation?.title ?? null;

  if (!localeTitle || localeTitle === main) {
    return { main, sub: null, variant };
  }

  return { main, sub: localeTitle, variant };
}
