import { locales } from "@/i18n/routing";
import { resolveDisplayPair } from "@/lib/display";
import type { AdminFieldResult } from "@/lib/admin-input";

const identityFields = [
  ["name", "originalName", "nameSameSource"],
  ["shortName", "originalShortName", "shortNameSameSource"],
  ["stageName", "originalStageName", "stageNameSameSource"],
] as const;

type SameNameSourceField = (typeof identityFields)[number][2];
export type IdentitySameSources = Partial<Record<SameNameSourceField, string>>;
type Confirmations = ReadonlyMap<string, ReadonlySet<SameNameSourceField>>;

type Translation = { locale: string; name: string; shortName?: string | null; stageName?: string | null };
type Identity = {
  originalName: string;
  originalLanguage: string;
  originalShortName?: string | null;
  originalStageName?: string | null;
  translations: readonly Translation[];
  sameNameConfirmations?: Confirmations;
};

const FULL_UNIT_NAMES: Readonly<Record<string, string>> = {
  diverdiva: "DiverDiva",
  azuna: "A・ZU・NA",
  qu4rtz: "QU4RTZ",
  r3birth: "R3BIRTH",
  "a-l-a-n": "A.L.A.N",
};

// Official English release listings and Korean discography use these exact brands.
const CONFIRMED_ARTIST_NAMES: Readonly<Record<string, string>> = {
  liella: "Liella!",
  diverdiva: "DiverDiva",
  qu4rtz: "QU4RTZ",
  r3birth: "R3BIRTH",
  "a-l-a-n": "A.L.A.N",
};

export function identityTranslations<T extends Translation>(
  raw: unknown,
  parse: (value: unknown) => AdminFieldResult<T[]>,
): AdminFieldResult<T[]> & { sameNameConfirmations?: Confirmations } {
  if (raw === undefined || (Array.isArray(raw) && raw.length === 0)) return { ok: true, value: [] };
  const parsed = parse(raw);
  if (!parsed.ok) return parsed;

  // Translation parsers preserve row order. Keep evidence out of Prisma data.
  const items = raw as Record<string, unknown>[];
  const sameNameConfirmations = new Map<string, Set<SameNameSourceField>>();
  for (const [index, row] of parsed.value.entries()) {
    const confirmed = new Set<SameNameSourceField>();
    for (const [field, , sourceField] of identityFields) {
      const source = items[index][sourceField];
      if (source === undefined || source === "") continue;
      const url = typeof source === "string" && /^https?:\/\//i.test(source.trim()) && URL.canParse(source) ? new URL(source) : null;
      if (!row[field] || !url || !["https:", "http:"].includes(url.protocol) || url.username || url.password) {
        return { ok: false, message: "translations[" + index + "]." + sourceField + " (확인 출처 URL 필요)" };
      }
      confirmed.add(sourceField);
    }
    if (confirmed.size) sameNameConfirmations.set(row.locale, confirmed);
  }
  return { ...parsed, sameNameConfirmations };
}

export function checkIdentityNames(
  target: string,
  next: Identity,
  previous?: Identity,
  artistSlug?: string,
) {
  const final = new Map(previous?.translations.map((row) => [row.locale, row]));
  for (const row of next.translations) {
    final.set(row.locale, {
      ...final.get(row.locale),
      locale: row.locale,
      name: row.name,
      ...(row.shortName !== undefined ? { shortName: row.shortName } : {}),
      ...(row.stageName !== undefined ? { stageName: row.stageName } : {}),
    });
  }
  const problems: string[] = [];
  for (const [field, originalField, sourceField] of identityFields) {
    const original = next[originalField];
    if (!original?.trim()) continue;
    const sourceChanged = !previous || original !== previous[originalField] || next.originalLanguage !== previous.originalLanguage;
    const fieldChanged = next.translations.some((row) => row[field] !== undefined && row[field] !==
      previous?.translations.find((stored) => stored.locale === row.locale)?.[field]);
    if (!sourceChanged && !fieldChanged) continue;

    const rows = Array.from(final.values());
    for (const locale of locales) {
      if (locale === next.originalLanguage) continue;
      if (field === "shortName" && artistSlug && FULL_UNIT_NAMES[artistSlug] === next.originalName &&
          !final.get(locale)?.shortName) continue;
      const submitted = next.translations.find((row) => row.locale === locale);
      const confirmed = submitted?.[field] === original && next.sameNameConfirmations?.get(locale)?.has(sourceField);
      const knownBrand = artistSlug && CONFIRMED_ARTIST_NAMES[artistSlug] === original &&
        (field === "name" || (field === "shortName" && artistSlug === "liella"));
      const { status } = resolveDisplayPair(
        { original, originalLanguage: next.originalLanguage }, rows, locale, field,
        { sameValueConfirmed: Boolean(confirmed || knownBrand) },
      );
      if (status === "unconfirmed-same") {
        // Keep a stored spelling during a partial edit to another locale.
        const stored = previous?.translations.find((row) => row.locale === locale);
        if (sourceChanged || stored?.[field] !== original) {
          problems.push(field + " (" + locale + ", 원문 동일 표기 검수 필요)");
        }
      } else if (status === "missing" || (previous && sourceChanged &&
          !next.translations.some((row) => row.locale === locale && row[field] !== undefined))) {
        problems.push(field + " (" + locale + ", 표기 필요)");
      }
    }
  }
  return problems.length ? target + " " + next.originalName + ": " + problems.join(", ") : null;
}
