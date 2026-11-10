import { locales } from "@/i18n/routing";
import {
  catalogLocaleReviewIssue,
  catalogShortNameRule,
  ImportValidationError,
  isSameSpellingSource,
} from "@/lib/csv-parse";
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

/** Compare the values that Prisma will persist, leaving unchanged legacy fields alone. */
export function catalogDisplayIssues(
  row: Record<string, string>,
  existing: DisplayRecord | null,
  originals: Record<string, string | null | undefined>,
  patches: readonly TranslationPatch[],
  fields: readonly DisplayField[],
  prefix = "",
  artistSlug?: string,
) {
  const previousLanguage = text(existing?.originalLanguage) || "ja";
  const originalLanguage = originals.originalLanguage ?? previousLanguage;
  const previousFullName = text(existing?.originalName);
  const fullName = originals.originalName === undefined ? previousFullName : text(originals.originalName);
  const fullNameIsTitle = fields.some(([key, , kind]) => key === "originalName" && kind === "title");
  const issues: string[] = [];

  for (const [originalKey, field, kind] of fields) {
    const previous = text(existing?.[originalKey]);
    const original = originals[originalKey] === undefined
      ? previous
      : text(originals[originalKey]);
    const shortRule = field === "shortName"
      ? catalogShortNameRule(original, fullName, fullNameIsTitle, artistSlug)
      : undefined;
    const previousShortRule = field === "shortName"
      ? catalogShortNameRule(previous, previousFullName, fullNameIsTitle, artistSlug)
      : undefined;
    const sourceChanged = existing !== null && (original !== previous ||
      originalLanguage !== previousLanguage || shortRule !== previousShortRule);
    const translations = locales.map((locale) => {
      const before = text(existing?.translations.find((t) => t.locale === locale)?.[field]);
      const patch = patches.find((t) => t.locale === locale)?.[field];
      return { locale, before, submitted: text(patch), value: patch === undefined ? before : text(patch) };
    });
    if (kind === "required") {
      for (const { locale, value } of translations) {
        if (!value.trim() && patches.some((patch) => patch.locale === locale)) {
          issues.push(`${prefix}${locale}_${field}: 번역 행에 이름이 필요합니다`);
        }
      }
    }
    if (existing && !sourceChanged &&
        translations.every(({ before, value }) => before === value)) continue;
    if (!original.trim()) {
      if (kind || translations.some(({ value }) => value.trim())) {
        issues.push(`${prefix}${originalKey}: 원문 표기가 필요합니다`);
      }
      continue;
    }
    for (const { locale, value, submitted } of translations) {
      const key = `${prefix}${locale}_${field}`;
      if (shortRule === "full-name" && !value.trim()) continue;
      const { status } = resolveDisplayPair({ original, originalLanguage }, translations, locale, "value", {
        kind: kind === "title" || shortRule === "title" ? "title" : undefined,
        sameValueConfirmed: isSameSpellingSource(row[`${key}_same_source`]),
      });
      const issue = catalogLocaleReviewIssue({ locale, value, originalLanguage, sourceChanged, submitted, status });
      if (issue) {
        issues.push(`${key}: ${issue}`);
      } else if (status === "missing" || status === "unconfirmed-same" || status === "title-review") {
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
