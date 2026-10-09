import { prisma } from "@/lib/prisma";
import { CACHE_TTL, cachedQuery, splitIdKey } from "@/lib/dataCache";
import { displayNameWithFallback } from "@/lib/display";
import { resolveUnitColor } from "@/lib/artistColor";
import { safeBigIntToNumber } from "@/lib/copyPastSetlist";
import { descendantsOf, getArtistHierarchyCached } from "@/lib/artistHierarchy";
import { FALLBACK_LOCALE } from "@/i18n/routing";
import type { AvailableSong } from "@/lib/types/predict";

/**
 * Server-side catalog for the Predicted Setlist song picker (v0.13.14+
 * — `task-song-picker-predict-mode.md`). Lives outside the event page
 * so the row → `AvailableSong` mapping is unit-testable and so the
 * festival path (n10) can call it once per festival group.
 *
 * Scope: every non-deleted base song credited to an artist in
 * `scopeIds` — the scope root (the group) plus ALL of its descendants
 * from the artist hierarchy. Before n10 the predicate was
 * `id = root OR parentArtistId = root` (depth 1); identical on today's
 * data, but a depth-2 artist would have silently fallen out.
 *
 * `safeBigIntToNumber` (`src/lib/copyPastSetlist.ts`) guards the
 * BigInt → JS-number conversion at the response boundary — same
 * outbound contract as the past-setlists route. Unsafe ids
 * (> 2^53-1) are dropped rather than truncated; at Phase 1
 * autoincrement scale this is belt-and-suspenders.
 *
 * Unit identity routing: a song credited to both the group and a
 * sub-unit picks the sub-unit row for filter routing (sub-unit
 * wins). This keeps section-header grouping organised by the
 * smaller scope under composite `all` / `sub` filters.
 *
 * Locale filter mirrors `getEvent`'s `[locale, "ja"]` policy.
 */
async function fetchAvailableSongRows(scopeIds: bigint[], locale: string) {
  const localeFilter = { locale: { in: [locale, FALLBACK_LOCALE] } };
  return prisma.song.findMany({
    where: {
      isDeleted: false,
      // Variants hidden — the picker only surfaces canonical (base)
      // songs. A song with `baseVersionId !== null` is a variant
      // ("Dream Believers (SAKURA Ver.)"); only the base row is
      // pickable. `isSongMatched` already handles variant↔base
      // equivalence at score time so predicting the base also
      // matches a variant performance.
      baseVersionId: null,
      artists: {
        some: {
          artist: { id: { in: scopeIds }, isDeleted: false },
        },
      },
    },
    select: {
      id: true,
      originalTitle: true,
      originalLanguage: true,
      variantLabel: true,
      baseVersionId: true,
      translations: {
        where: localeFilter,
        select: { locale: true, title: true, variantLabel: true },
      },
      artists: {
        select: {
          artist: {
            select: {
              id: true,
              slug: true,
              color: true,
              parentArtistId: true,
              isMainUnit: true,
              originalName: true,
              originalShortName: true,
              originalLanguage: true,
              isDeleted: true,
              translations: {
                where: localeFilter,
                select: { locale: true, name: true, shortName: true },
              },
            },
          },
        },
      },
    },
    orderBy: { originalTitle: "asc" },
  });
}

export type AvailableSongRow = Awaited<
  ReturnType<typeof fetchAvailableSongRows>
>[number];

/**
 * Pure row → `AvailableSong` mapping. `rootId` is the scope root (the
 * group); `scopeIds` is root + descendants. Every id comparison goes
 * through `String(...)` because the root can arrive as a number (a
 * `serializeBigInt`-processed cached event) while Prisma returns
 * bigint — `1n === 1` is `false`, which once discarded every row and
 * left the picker empty (caught on dev preview, 2026-05-19).
 *
 * `festivalGroupIds` is always `[]` here; the festival path fills it
 * when it merges per-group catalogs (`mergeFestivalCatalog`).
 */
export function mapAvailableSongRows(
  rows: readonly AvailableSongRow[],
  rootId: bigint | number,
  scopeIds: readonly (bigint | number | string)[],
  locale: string,
): AvailableSong[] {
  const rootKey = String(rootId);
  const scopeSet = new Set(scopeIds.map(String));
  const out: AvailableSong[] = [];
  for (const row of rows) {
    const songId = safeBigIntToNumber(row.id);
    if (songId === null) continue;
    const baseVersionId =
      row.baseVersionId === null ? null : safeBigIntToNumber(row.baseVersionId);
    const aliveArtists = row.artists
      .map((sa) => sa.artist)
      .filter((a) => !a.isDeleted);
    // "Sub-unit" = any in-scope artist other than the root itself —
    // a direct unit / solo, or a deeper descendant.
    const subUnits = aliveArtists.filter(
      (a) => String(a.id) !== rootKey && scopeSet.has(String(a.id)),
    );
    const groupArtist = aliveArtists.find((a) => String(a.id) === rootKey);

    // Routing preference (matches the docstring on
    // `AvailableSong.unit`):
    //   - 0 sub-units → group fallback
    //   - 1 sub-unit  → that sub-unit (main or non-main)
    //   - ≥2 sub-units with a main unit → main unit wins
    //   - ≥2 sub-units, all non-main → multi-solo collab, mark
    //     `isMultiArtist` so the picker routes it to `others`
    //     only. `unit` still points at the first sub-unit row for
    //     fallback display (the in-row badge).
    let unitArtist: (typeof subUnits)[number] | typeof groupArtist | undefined;
    let isMultiArtist = false;
    if (subUnits.length === 0) {
      unitArtist = groupArtist;
    } else if (subUnits.length === 1) {
      unitArtist = subUnits[0];
    } else {
      const mainSubUnit = subUnits.find((a) => a.isMainUnit);
      if (mainSubUnit) {
        unitArtist = mainSubUnit;
      } else {
        unitArtist = subUnits[0];
        isMultiArtist = true;
      }
    }
    if (!unitArtist) continue;
    const unitArtistId = safeBigIntToNumber(unitArtist.id);
    if (unitArtistId === null) continue;

    // Collect ALL credited in-scope artistIds (group + sub-units), not
    // just the canonical `unit.artistId`. Lets the picker show a
    // multi-unit collab song (e.g. Cerise + DOLLCHESTRA + Mira-Cra
    // Park!) under EVERY credited unit's chip rather than only the
    // canonical one. Cover artists, guests, and unrelated featured
    // artists are out of scope and excluded — same scope the
    // canonical `unit` uses. Dedup via Set since a single song row
    // could have duplicate SongArtist entries in malformed data.
    const creditedSet = new Set<number>();
    for (const a of aliveArtists) {
      if (!scopeSet.has(String(a.id))) continue;
      const aid = safeBigIntToNumber(a.id);
      if (aid === null) continue;
      creditedSet.add(aid);
    }
    const creditedArtistIds = [...creditedSet];

    out.push({
      songId,
      originalTitle: row.originalTitle,
      originalLanguage: row.originalLanguage,
      variantLabel: row.variantLabel,
      baseVersionId,
      translations: row.translations,
      unit: {
        artistId: unitArtistId,
        slug: unitArtist.slug,
        label: displayNameWithFallback(
          unitArtist,
          unitArtist.translations,
          locale,
          "short",
        ),
        color: resolveUnitColor(unitArtist),
        isSubUnit: unitArtist.parentArtistId !== null,
        isMainUnit: unitArtist.isMainUnit,
      },
      isMultiArtist,
      creditedArtistIds,
      festivalGroupIds: [],
    });
  }
  return out;
}

export async function getAvailableSongs(
  rootId: bigint | number,
  scopeIds: bigint[],
  locale: string,
): Promise<AvailableSong[]> {
  const rows = await fetchAvailableSongRows(scopeIds, locale);
  return mapAvailableSongRows(rows, rootId, scopeIds, locale);
}

// The picker catalog depends only on (scope root, locale), not on the
// event, so every upcoming event of the same artist — and every
// festival that lists that group — shares one cache entry. The scope
// set is derived inside from the (separately cached) hierarchy, so it
// isn't part of the key; both expire together on the `public-data`
// tag when an operator edits artists.
export const getAvailableSongsCached = cachedQuery(
  "predict-available-songs",
  async (rootId: bigint, locale: string) => {
    const hierarchy = await getArtistHierarchyCached();
    const scopeIds = descendantsOf(hierarchy, rootId).map((id) => BigInt(id));
    return getAvailableSongs(rootId, scopeIds, locale);
  },
  { revalidate: CACHE_TTL.entity },
);

/**
 * Display rows (chip label + color) for the festival path's root
 * groups. Read separately rather than taken from the roster's artist
 * links because a performer linked only to a sub-unit reaches a root
 * the roster never mentions. Tiny (one row per group, ≤ ~10) and keyed
 * on the sorted id set, so every festival day with the same groups
 * shares the entry.
 */
export const getFestivalGroupArtistsCached = cachedQuery(
  "predict-festival-group-artists",
  async (idKey: string, locale: string) => {
    const ids = splitIdKey(idKey);
    if (ids.length === 0) return [];
    return prisma.artist.findMany({
      where: { id: { in: ids }, isDeleted: false },
      select: {
        id: true,
        slug: true,
        color: true,
        originalName: true,
        originalShortName: true,
        originalLanguage: true,
        translations: {
          where: { locale: { in: [locale, FALLBACK_LOCALE] } },
          select: { locale: true, name: true, shortName: true },
        },
      },
    });
  },
  { revalidate: CACHE_TTL.entity },
);
