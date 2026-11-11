import { locales } from "@/i18n/routing";
import { nullableString, type AdminFieldResult } from "@/lib/admin-input";
import { resolveDisplayPair } from "@/lib/display";

const inputLocales = new Set<string>([...locales, "zh-CN"]);
const names = { originalName: "name", originalShortName: "shortName" } as const;
export const eventLanguageFields = {
  ...names, originalCity: "city", originalVenue: "venue", organizerName: "organizerName",
} as const;
export const seriesLanguageFields = {
  ...names, originalDescription: "description", organizerName: "organizerName",
} as const;

type Row = {
  locale: string;
  name: string;
  shortName?: string | null;
  city?: string | null;
  venue?: string | null;
  description?: string | null;
  organizerName?: string | null;
};
type Field = Exclude<keyof Row, "locale">;
type FieldMap = Record<string, Field>;
type Source = { originalLanguage: string } & Record<string, unknown>;

export function prepareEventLanguageWrite(
  body: Record<string, unknown>,
  fields: FieldMap,
  source: Source,
  stored?: Source & { translations: Row[] },
): AdminFieldResult<{ rows: Row[]; changed: Row[]; removed: string[] }> {
  const raw = body.translations === undefined ? [] : body.translations;
  if (!Array.isArray(raw)) return { ok: false, message: "translations 배열이 필요합니다." };
  const removed = body.removeTranslations === undefined ? [] : body.removeTranslations;
  if (!Array.isArray(removed) || removed.some((locale) => typeof locale !== "string" || !inputLocales.has(locale))) {
    return { ok: false, message: "removeTranslations 언어를 확인해 주세요." };
  }
  const columns = Object.values(fields);
  const old = new Map(stored?.translations.map((row) => [row.locale, row]));
  const merged = new Map(old);
  for (const locale of removed) merged.delete(locale);
  const changed: Row[] = [];
  const confirmations = new Map<string, Set<Field>>();
  const supplied = new Map<string, Record<string, unknown>>();
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, message: "translations 항목은 객체여야 합니다." };
    }
    const input = item as Record<string, unknown>;
    const { locale, confirmedSame } = input;
    if (typeof locale !== "string" || !inputLocales.has(locale) || seen.has(locale) || removed.includes(locale)) {
      return { ok: false, message: `translations 언어가 지원되지 않거나 중복됩니다: ${String(locale)}` };
    }
    seen.add(locale);
    supplied.set(locale, input);
    const previous = old.get(locale);
    const row: Row = { locale, name: "" };
    for (const field of columns) {
      const value = input[field];
      if (value === undefined) {
        if (field === "name") row.name = previous?.name ?? "";
        else row[field] = previous?.[field] ?? null;
      } else {
        const parsed = nullableString(value, `translations.${locale}.${field}`);
        if (!parsed.ok) return parsed;
        if (field === "name") row.name = parsed.value ?? "";
        else row[field] = parsed.value;
      }
    }
    if (confirmedSame !== undefined) {
      if (!Array.isArray(confirmedSame) || confirmedSame.some((field) =>
        !columns.includes(field) || field === "description" || row[field as Field] !==
          source[Object.keys(fields).find((key) => fields[key] === field)!])) {
        return { ok: false, message: `translations.${locale}: 원문과 같은 표기만 확인할 수 있습니다.` };
      }
      confirmations.set(locale, new Set<Field>(confirmedSame));
    }
    // A locale can carry a venue or organizer even when the title is exempt.
    if (!previous && !columns.some((field) => row[field])) continue;
    merged.set(locale, row);
    if (!previous || columns.some((field) => (row[field] ?? null) !== (previous[field] ?? null))) {
      changed.push(row);
    }
  }

  const rows = [...merged.values()];
  for (const [key, field] of Object.entries(fields)) {
    const original = source[key];
    if (typeof original !== "string" || !original.trim()) continue;
    const sourceChanged = !stored || original !== stored[key] || source.originalLanguage !== stored.originalLanguage;
    if (!sourceChanged && !locales.some((locale) =>
      (old.get(locale)?.[field] ?? null) !== (merged.get(locale)?.[field] ?? null))) continue;
    for (const locale of locales) {
      // A short label identical to the full title is the same visible field.
      const kind = field === "name" || (field === "shortName" && original === source.originalName)
        ? "title" : undefined;
      const sameValueConfirmed = confirmations.get(locale)?.has(field) || field === "description";
      const result = resolveDisplayPair(
        { original, originalLanguage: source.originalLanguage },
        rows, locale, field,
        { kind, sameValueConfirmed },
      );
      const needsReview = stored && sourceChanged && locale !== source.originalLanguage &&
        result.status !== "exempt" && supplied.get(locale)?.[field] === undefined;
      if (needsReview || result.status === "missing" || result.status === "unconfirmed-same" || result.status === "title-review") {
        return { ok: false, message: `translations.${locale}.${field}: 출처에서 확인한 현지 표기가 필요합니다.` };
      }
    }
  }
  return { ok: true, value: { rows, changed, removed } };
}
