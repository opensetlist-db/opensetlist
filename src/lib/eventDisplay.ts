import { resolveDisplayPair } from "@/lib/display";
import { nonBlank } from "@/lib/utils";

export type EventDisplayText = {
  main: string;
  sub: string | null;
  mainLang: string;
  subLang: string;
};

export function eventDisplayField<T extends { locale: string }>(
  original: string | null | undefined,
  originalLanguage: string,
  rows: readonly T[],
  locale: string,
  field: keyof T,
  kind?: "title",
): EventDisplayText | null {
  const source = nonBlank(original);
  if (!source) {
    const legacy = rows.find((row) => row.locale === originalLanguage)?.[field];
    if (typeof legacy === "string" && nonBlank(legacy)) {
      return eventDisplayField(legacy, originalLanguage, rows, locale, field, kind);
    }
    const current = rows.find((row) => row.locale === locale)?.[field];
    return typeof current === "string" && nonBlank(current)
      ? { main: current, sub: null, mainLang: locale, subLang: locale }
      : null;
  }
  const { main, sub } = resolveDisplayPair(
    { original: source, originalLanguage }, rows, locale, field, { kind },
  );
  return { main, sub, mainLang: originalLanguage, subLang: locale };
}

export function eventDisplayName(
  item: {
    originalName: string | null;
    originalShortName?: string | null;
    originalLanguage: string;
    translations: readonly { locale: string; name: string; shortName?: string | null }[];
  },
  locale: string,
  kind?: "title",
  short = false,
) {
  const { originalName, originalShortName, originalLanguage, translations } = item;
  // Use the full pair when a local abbreviation is missing; don't attach
  // a translated full name to an unrelated abbreviation.
  const originalShort = short ? nonBlank(originalShortName) : null;
  if (originalShort) {
    const { main, sub, status } = resolveDisplayPair(
      { original: originalShort, originalLanguage }, translations, locale, "shortName",
      { kind: originalShort === nonBlank(originalName) ? kind : undefined },
    );
    if (sub || status === "exempt" || status === "original-language") {
      return { main, sub, mainLang: originalLanguage, subLang: locale };
    }
    return eventDisplayField(originalName, originalLanguage, translations, locale, "name", kind)
      ?? { main, sub, mainLang: originalLanguage, subLang: locale };
  }
  return eventDisplayField(originalName, originalLanguage, translations, locale, "name", kind);
}

export function eventDisplayPlain(pair: EventDisplayText | null | undefined): string {
  return pair ? (pair.sub ? `${pair.main} / ${pair.sub}` : pair.main) : "";
}

/** Descriptions and geographic labels are single-language display text. */
export function localizedEventText<T extends { locale: string }>(
  original: string | null | undefined,
  originalLanguage: string,
  rows: readonly T[],
  locale: string,
  field: keyof T,
) {
  const value = rows.find((row) => row.locale === locale)?.[field];
  return (typeof value === "string" ? nonBlank(value) : null) ??
    (locale === originalLanguage ? nonBlank(original) : null);
}
