import { locales } from "@/i18n/routing";
import { resolveDisplayPair } from "@/lib/display";

export type SongTranslationEdit = {
  locale: string;
  title?: string;
  variantLabel?: string | null;
};

type SongNames = {
  originalTitle: string;
  originalLanguage: string;
  variantLabel: string | null;
  translations: readonly SongTranslationEdit[];
};

export function songNameSnapshot(song: SongNames) {
  return JSON.stringify([
    song.originalTitle, song.originalLanguage, song.variantLabel,
    [...song.translations].sort((a, b) => a.locale.localeCompare(b.locale))
      .map(({ locale, title, variantLabel }) => [locale, title ?? "", variantLabel ?? null]),
  ]);
}

export function songTranslationTitle(
  title: string | undefined,
  originalTitle: string,
  originalLanguage: string,
  locale: string,
) {
  if (title?.trim()) return title;
  // A label-only row still needs a title column, which legacy readers
  // may consume. Use the original only where the title needs no translation.
  const { status } = resolveDisplayPair(
    { original: originalTitle, originalLanguage }, [], locale, "title", { kind: "title" },
  );
  return status === "exempt" || status === "original-language" ? originalTitle : "";
}

export function parseSongTranslations(input: unknown): SongTranslationEdit[] | null {
  if (!Array.isArray(input)) return null;
  const rows: SongTranslationEdit[] = [];
  const seen = new Set<string>();
  for (const row of input) {
    if (!row || typeof row.locale !== "string" || !row.locale.trim() || seen.has(row.locale) ||
      (row.title !== undefined && typeof row.title !== "string") ||
      (row.variantLabel != null && typeof row.variantLabel !== "string")) return null;
    seen.add(row.locale);
    rows.push({
      locale: row.locale,
      title: row.title,
      variantLabel: row.variantLabel?.trim() ? row.variantLabel : row.variantLabel === undefined ? undefined : null,
    });
  }
  return rows;
}

export function songNameError(
  next: SongNames,
  edits: readonly SongTranslationEdit[],
  reviewed: boolean,
  previous?: SongNames,
) {
  const languageChanged = next.originalLanguage !== previous?.originalLanguage;
  const titleChanged = languageChanged || next.originalTitle !== previous?.originalTitle;
  const variantChanged = languageChanged || next.variantLabel !== previous?.variantLabel;
  const changed = edits.some((row) => {
    const old = previous?.translations.find((translation) => translation.locale === row.locale);
    return (row.title !== undefined && (row.title || "") !== (old?.title || "")) ||
      (row.variantLabel !== undefined && (row.variantLabel || "") !== (old?.variantLabel || ""));
  });
  if (!titleChanged && !variantChanged && !changed) return null;
  if (!next.originalTitle.trim() || !next.originalLanguage.trim()) return "원제와 원어를 입력해 주세요.";

  for (const [field, original, oldOriginal, label] of [
    ["title", next.originalTitle, previous?.originalTitle, "제목"],
    ["variantLabel", next.variantLabel, previous?.variantLabel, "버전 라벨"],
  ] as const) {
    const sourceChanged = original !== oldOriginal || languageChanged;

    if (!original?.trim()) {
      if (sourceChanged && next.translations.some((row) => row[field]?.trim())) {
        return "원문 버전 라벨을 비우려면 언어별 버전 라벨도 지워 주세요.";
      }
      if (edits.some((row) => row[field]?.trim())) return "원문 버전 라벨을 입력해 주세요.";
      continue;
    }
    for (const locale of locales) {
      const submitted = edits.find((row) => row.locale === locale)?.[field];
      const { status } = resolveDisplayPair(
        { original, originalLanguage: next.originalLanguage },
        next.translations, locale, field,
        { kind: field === "title" ? "title" : undefined, sameValueConfirmed: reviewed && submitted === original },
      );
      if (status === "exempt" || locale === next.originalLanguage) continue;
      if (status === "missing" || status === "title-review") return `${locale} ${label} 표기를 입력해 주세요.`;
      if (status === "unconfirmed-same" || (previous && sourceChanged && (!reviewed || !submitted?.trim()))) {
        return `${locale} ${label} 표기를 출처에서 다시 확인해 주세요.`;
      }
    }
  }
  return null;
}
