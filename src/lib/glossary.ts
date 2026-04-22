/**
 * Phase 1A glossary builder for impression translation.
 *
 * Auto-derives a proper-noun substitution list from existing translation rows
 * (artists, stage identities, VAs, songs) for a given event, then provides
 * placeholder helpers that protect those terms from LLM modification.
 *
 * The placeholder substitution costs zero prompt tokens. Names that have no
 * separate per-locale translation (e.g. Latin-script "Cerise Bouquet") fall
 * back to the parent original so the term still appears in every locale-pair
 * direction — preventing the LLM from transliterating it.
 *
 * Not related to the dead `src/lib/translation.ts` `applyDictionary` helpers,
 * which target the deferred `DictionaryTerm` admin-curated schema.
 */

import { prisma } from "./prisma";

export type LocalizedTerm = { ko: string; ja: string; en: string };

export type ArtistTerms = {
  artist: LocalizedTerm[];
  stageIdentity: LocalizedTerm[];
  realPerson: LocalizedTerm[];
  song: LocalizedTerm[];
};

export type GlossaryPair = { source: string; target: string };
export type GlossaryRestoreMap = Map<string, string>;

type GlossaryLocale = "ko" | "ja" | "en";
const LOCALES: readonly GlossaryLocale[] = ["ko", "ja", "en"] as const;

// Universal-fallback rule: when a translation locale is empty, fall back to
// the parent's `originalShortName`. This covers two cases:
//   1. Operator data convention puts JA short name in parent override, not in
//      the va_ja_shortName translation row.
//   2. Latin-script names ("Cerise Bouquet") with no per-locale translation —
//      every slot fills with the same string so the pair {source, target} is
//      still emitted (placeholder substitution protects against LLM rewriting).
function pickShortName(
  parent: { originalShortName?: string | null } | null,
  translations: ReadonlyArray<{ locale: string; shortName: string | null }>
): LocalizedTerm {
  const parentShort = (parent?.originalShortName ?? "").trim();
  const result: LocalizedTerm = { ko: "", ja: "", en: "" };
  for (const locale of LOCALES) {
    const fromTranslation = (
      translations.find((t) => t.locale === locale)?.shortName ?? ""
    ).trim();
    result[locale] = fromTranslation || parentShort;
  }
  return result;
}

// Same logic as pickShortName, but the type signature only exposes shortName
// (no name/stageName) so the spec's "do NOT fall back to formal name" rule for
// RealPerson is enforced at the type level.
function pickRealPersonShortName(
  parent: { originalShortName: string | null } | null,
  translations: ReadonlyArray<{ locale: string; shortName: string | null }>
): LocalizedTerm {
  return pickShortName(parent, translations);
}

function mergeOriginalAndTranslations(song: {
  originalTitle: string;
  originalLanguage: string;
  translations: ReadonlyArray<{ locale: string; title: string }>;
}): LocalizedTerm {
  const originalTitle = song.originalTitle.trim();
  const result: LocalizedTerm = { ko: "", ja: "", en: "" };
  for (const locale of LOCALES) {
    if (locale === song.originalLanguage) {
      result[locale] = originalTitle;
      continue;
    }
    const fromTranslation = (
      song.translations.find((t) => t.locale === locale)?.title ?? ""
    ).trim();
    result[locale] = fromTranslation || originalTitle;
  }
  return result;
}

export async function buildArtistTerms(artistId: bigint): Promise<ArtistTerms> {
  const [artist, stageIdentities, songs] = await Promise.all([
    prisma.artist.findUnique({
      where: { id: artistId },
      include: { translations: true },
    }),
    prisma.stageIdentity.findMany({
      where: { artistLinks: { some: { artistId } } },
      include: {
        translations: true,
        voicedBy: {
          include: { realPerson: { include: { translations: true } } },
        },
      },
    }),
    prisma.song.findMany({
      where: { artists: { some: { artistId } }, isDeleted: false },
      include: { translations: true },
    }),
  ]);

  const artistTerms: LocalizedTerm[] = artist
    ? [pickShortName(artist, artist.translations)]
    : [];

  const stageIdentityTerms: LocalizedTerm[] = stageIdentities.map((si) =>
    pickShortName(si, si.translations)
  );

  // Each StageIdentity may have multiple voicedBy rows (recasts, time-aware
  // VA changes). Collect all distinct RealPersons; one VA can voice multiple
  // SIs of the same artist (sub-units).
  const realPersonById = new Map<
    string,
    {
      originalShortName: string | null;
      translations: { locale: string; shortName: string | null }[];
    }
  >();
  for (const si of stageIdentities) {
    for (const vb of si.voicedBy) {
      if (vb.realPerson) {
        realPersonById.set(vb.realPerson.id, vb.realPerson);
      }
    }
  }
  const realPersonTerms: LocalizedTerm[] = Array.from(
    realPersonById.values()
  ).map((rp) => pickRealPersonShortName(rp, rp.translations));

  const songTerms: LocalizedTerm[] = songs.map(mergeOriginalAndTranslations);

  return {
    artist: artistTerms,
    stageIdentity: stageIdentityTerms,
    realPerson: realPersonTerms,
    song: songTerms,
  };
}

const TTL_MS = 60 * 60 * 1000; // 1h
const cache = new Map<string, { builtAt: number; data: ArtistTerms }>();

export async function getArtistTerms(artistId: bigint): Promise<ArtistTerms> {
  const key = artistId.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.builtAt < TTL_MS) return hit.data;

  const data = await buildArtistTerms(artistId);
  cache.set(key, { builtAt: Date.now(), data });
  return data;
}

// Test-only escape hatch — clears the module cache between test runs so each
// test starts from a known empty state. Not exported through any public path.
export function _resetGlossaryCacheForTests(): void {
  cache.clear();
}

const MIN_LEN: Record<GlossaryLocale, number> = { ko: 2, ja: 2, en: 2 };

export function assemblePairs(
  terms: ArtistTerms,
  sourceLocale: GlossaryLocale,
  targetLocale: GlossaryLocale
): GlossaryPair[] {
  const all: LocalizedTerm[] = [
    ...terms.artist,
    ...terms.stageIdentity,
    ...terms.realPerson,
    ...terms.song,
  ];
  const minSourceLen = MIN_LEN[sourceLocale];

  const pairs: GlossaryPair[] = [];
  for (const term of all) {
    const source = term[sourceLocale];
    const target = term[targetLocale];
    if (!source || !target) continue;
    if (source.length < minSourceLen) continue;
    pairs.push({ source, target });
  }

  pairs.sort((a, b) => b.source.length - a.source.length);

  const seen = new Set<string>();
  return pairs.filter((p) => {
    if (seen.has(p.source)) return false;
    seen.add(p.source);
    return true;
  });
}

export async function getGlossaryForEvent(
  eventId: bigint,
  sourceLocale: GlossaryLocale,
  targetLocale: GlossaryLocale,
  // Pluggable fetcher so the admin debug endpoint can swap in
  // `buildArtistTerms` to bypass the 1h cache when verifying fresh DB state
  // after data edits. Production translate route uses the cached default.
  artistTermsFetcher: (id: bigint) => Promise<ArtistTerms> = getArtistTerms
): Promise<GlossaryPair[]> {
  // No filter on isGuest — both regular performers and guests are pulled.
  // Guest VAs from non-Hasunosora rosters get the same proper-noun protection.
  const performers = await prisma.eventPerformer.findMany({
    where: { eventId },
    include: {
      stageIdentity: {
        include: { artistLinks: { select: { artistId: true } } },
      },
    },
  });

  const artistIds = new Set<string>();
  for (const p of performers) {
    for (const link of p.stageIdentity.artistLinks) {
      artistIds.add(link.artistId.toString());
    }
  }
  if (artistIds.size === 0) return [];

  const termsList = await Promise.all(
    Array.from(artistIds, (id) => artistTermsFetcher(BigInt(id)))
  );

  const merged: ArtistTerms = {
    artist: termsList.flatMap((t) => t.artist),
    stageIdentity: termsList.flatMap((t) => t.stageIdentity),
    realPerson: termsList.flatMap((t) => t.realPerson),
    song: termsList.flatMap((t) => t.song),
  };

  return assemblePairs(merged, sourceLocale, targetLocale);
}

// __GLOSS_N__ placeholder format — distinct from the dead translation.ts
// __DICT_N__ helpers so the two never collide if both are ever active.
const PLACEHOLDER_RE = /__GLOSS_(\d+)__/g;

// ASCII-only sources need word-boundary substitution to avoid corrupting
// unrelated text — at MIN_LEN=2, "Mai" would otherwise match inside "mail",
// "Email", etc. CJK/Hangul sources keep raw substring substitution because
// `\b` doesn't fire cleanly on those scripts (per spec §6).
function isAsciiSource(s: string): boolean {
  return /^[\x20-\x7E]+$/.test(s);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function applyGlossary(
  text: string,
  pairs: GlossaryPair[]
): { processed: string; restoreMap: GlossaryRestoreMap } {
  if (pairs.length === 0) {
    return { processed: text, restoreMap: new Map() };
  }
  const restoreMap: GlossaryRestoreMap = new Map();
  let processed = text;
  for (let i = 0; i < pairs.length; i++) {
    const { source, target } = pairs[i];
    const placeholder = `__GLOSS_${i}__`;
    if (isAsciiSource(source)) {
      const re = new RegExp(`\\b${escapeRegExp(source)}\\b`, "g");
      const next = processed.replace(re, placeholder);
      if (next === processed) continue;
      processed = next;
    } else {
      if (!processed.includes(source)) continue;
      processed = processed.replaceAll(source, placeholder);
    }
    restoreMap.set(placeholder, target);
  }
  return { processed, restoreMap };
}

export function restoreGlossary(
  text: string,
  restoreMap: GlossaryRestoreMap
): string {
  if (restoreMap.size === 0) return text;
  // Single regex pass — newly-inserted target text can't re-trigger the
  // pattern, so a target string containing literal __GLOSS_N__ is safe.
  return text.replace(PLACEHOLDER_RE, (m) => restoreMap.get(m) ?? m);
}
