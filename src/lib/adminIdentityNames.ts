import { locales } from "@/i18n/routing";
import { resolveDisplayPair } from "@/lib/display";
import type { AdminFieldResult } from "@/lib/admin-input";

type Translation = { locale: string; name: string; shortName?: string | null; stageName?: string | null };
type Identity = {
  originalName: string;
  originalLanguage: string;
  originalShortName?: string | null;
  originalStageName?: string | null;
  translations: readonly Translation[];
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

export function identityTranslations<T>(raw: unknown, parse: (value: unknown) => AdminFieldResult<T[]>): AdminFieldResult<T[]> {
  if (raw === undefined || (Array.isArray(raw) && raw.length === 0)) return { ok: true, value: [] };
  return parse(raw);
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
  for (const [field, originalField] of [
    ["name", "originalName"],
    ["shortName", "originalShortName"],
    ["stageName", "originalStageName"],
  ] as const) {
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
      const { status } = resolveDisplayPair(
        { original, originalLanguage: next.originalLanguage }, rows, locale, field,
        { sameValueConfirmed: Boolean(artistSlug && CONFIRMED_ARTIST_NAMES[artistSlug] === original &&
          (field === "name" || (field === "shortName" && artistSlug === "liella"))) },
      );
      if (status === "unconfirmed-same") {
        problems.push(field + " (" + locale + ", 원문 동일 표기 검수 필요)");
      } else if (status === "missing" || (previous && sourceChanged &&
          !next.translations.some((row) => row.locale === locale && row[field] !== undefined))) {
        problems.push(field + " (" + locale + ", 표기 필요)");
      }
    }
  }
  return problems.length ? target + " " + next.originalName + ": " + problems.join(", ") : null;
}
