import { locales } from "@/i18n/routing";
import { ImportValidationError } from "@/lib/csv-parse";
import { resolveDisplayPair } from "@/lib/display";

type TranslationPatch = { locale: string } & Record<string, unknown>;
type DisplayRecord = Record<string, unknown> & {
  translations: readonly TranslationPatch[];
};

type DisplayField = readonly [
  originalKey: string,
  translationKey: string,
  kind?: "title" | "required",
];

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function confirmed(source: string | undefined) {
  return !!source && URL.canParse(source) && /^https?:\/\//i.test(source);
}

export function catalogDisplayIssues(
  row: Record<string, string>,
  existing: DisplayRecord | null,
  originals: Record<string, string | null | undefined>,
  patches: readonly TranslationPatch[],
  fields: readonly DisplayField[],
  prefix = "",
) {
  const previousLanguage = text(existing?.originalLanguage) || "ja";
  const originalLanguage = originals.originalLanguage ?? previousLanguage;
  const issues: string[] = [];

  for (const [originalKey, field, kind] of fields) {
    const previous = text(existing?.[originalKey]);
    const original = originals[originalKey] === undefined
      ? previous
      : text(originals[originalKey]);
    const translations = locales.map((locale) => {
      const before = text(existing?.translations.find((t) => t.locale === locale)?.[field]);
      const patch = patches.find((t) => t.locale === locale)?.[field];
      return { locale, before, value: patch === undefined ? before : text(patch) };
    });
    if (existing && original === previous && originalLanguage === previousLanguage &&
        translations.every(({ before, value }) => before === value)) continue;
    if (!original.trim()) {
      if (kind || translations.some(({ value }) => value.trim())) {
        issues.push(`${prefix}${originalKey}: 원문 표기가 필요합니다`);
      }
      continue;
    }
    for (const locale of locales) {
      const key = `${prefix}${locale}_${field}`;
      const { status } = resolveDisplayPair({ original, originalLanguage }, translations, locale, "value", {
        kind: kind === "title" ? "title" : undefined,
        sameValueConfirmed: confirmed(row[`${key}_same_source`]),
      });
      if (status === "missing" || status === "unconfirmed-same" || status === "title-review") {
        issues.push(`${key}: ${status}`);
      }
    }
  }
  return issues;
}

export function validateCatalogDisplay(
  label: string,
  ...input: Parameters<typeof catalogDisplayIssues>
) {
  const issues = catalogDisplayIssues(...input);
  if (issues.length) throw new ImportValidationError(`${label} — ${issues.join(", ")}`);
}
