/**
 * Festival path for the Predicted Setlist picker (n10).
 *
 * A multi-artist event (the Fes: `EventSeries.artistId = null` +
 * `organizerName`) has no single "primary artist" whose catalog the
 * picker could load, so before n10 the picker was simply hidden there.
 * The festival path derives the scope from the event roster instead:
 *
 *   1. `resolveFestivalGroups` — every performer's artist links are
 *      walked up the `parentArtistId` chain to their ROOT group, so a
 *      member linked only to a sub-unit (Cerise Bouquet) still lands
 *      on its group (Hasunosora). Guests count too — a guest's group
 *      is on stage, fans predict its songs.
 *   2. The page loads one catalog per root (`getAvailableSongsCached`,
 *      root + all descendants — the same cache entry the group's own
 *      single-artist events use).
 *   3. `mergeFestivalCatalog` — union, deduped by `songId`, recording
 *      which roots credited each song in `festivalGroupIds`. A
 *      crossover song shows under every applicable group chip but is
 *      ONE selectable prediction.
 *   4. `deriveFestivalFilters` (in `unitFilters.ts`) — `all` + one
 *      chip per group.
 *
 * Known gap (v1, by decision): an act with no member rows on the
 * roster (the Musical guest slot) is unreachable here, so its songs
 * aren't in the picker. Fans are not expected to predict the guest
 * slot; revisit after Day.1.
 *
 * Pure — no Prisma / Next imports, so it unit-tests in isolation.
 */

import { rootOf, type ArtistHierarchy } from "@/lib/artistHierarchy";
import type { AvailableSong } from "@/lib/types/predict";
import type { EventRosterEntry } from "@/lib/types/setlist";

export interface FestivalGroupRef {
  /** Root artist id (string — hierarchy key space; see
   *  `artistHierarchy.ts` for why ids are strings there). */
  rootId: string;
  /** Distinct roster performers reaching this root. Ordering key. */
  performerCount: number;
}

/**
 * Distinct root groups reached from the roster, ordered by performer
 * count desc (the headline groups first), first-appearance order as
 * the tiebreak — the roster arrives in canonical seed order, so ties
 * read in the same sequence as the lineup card.
 *
 * A performer linked to two roots (a member of a cross-IP collab group
 * such as AiScReam) counts toward both; that is what puts the collab
 * group's chip on the row at all.
 */
export function resolveFestivalGroups(
  roster: readonly EventRosterEntry[],
  hierarchy: ArtistHierarchy,
): FestivalGroupRef[] {
  const counts = new Map<string, number>();
  for (const entry of roster) {
    const roots = new Set<string>();
    for (const { artist } of entry.stageIdentity.artistLinks) {
      if (artist.isDeleted) continue;
      roots.add(rootOf(hierarchy, artist.id));
    }
    for (const root of roots) counts.set(root, (counts.get(root) ?? 0) + 1);
  }
  // Map iteration is insertion order, and `Array.prototype.sort` is
  // stable, so equal counts keep first-appearance order.
  return [...counts]
    .map(([rootId, performerCount]) => ({ rootId, performerCount }))
    .sort((a, b) => b.performerCount - a.performerCount);
}

/**
 * Union of the per-group catalogs, deduped by `songId`.
 *
 * `perGroup[i]` is the catalog for `groupIds[i]`. The first group (in
 * festival order) that lists a song owns its row — so its `unit`,
 * `isMultiArtist` and `creditedArtistIds` describe it relative to that
 * group — and every later group that also lists it only appends its
 * id to `festivalGroupIds`. Output order is group by group (each
 * group's catalog keeps its server-side title order), so the picker's
 * `all` view reads as one block of sections per group.
 */
export function mergeFestivalCatalog(
  groupIds: readonly number[],
  perGroup: readonly (readonly AvailableSong[])[],
): AvailableSong[] {
  const bySongId = new Map<number, AvailableSong>();
  groupIds.forEach((groupId, i) => {
    for (const song of perGroup[i] ?? []) {
      const existing = bySongId.get(song.songId);
      if (existing) {
        if (!existing.festivalGroupIds.includes(groupId)) {
          existing.festivalGroupIds.push(groupId);
        }
        continue;
      }
      // Copy — the per-group arrays come from a shared cache entry
      // and must not be mutated across requests.
      bySongId.set(song.songId, { ...song, festivalGroupIds: [groupId] });
    }
  });
  return [...bySongId.values()];
}
