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
 *      is on stage, fans predict its songs. Side projects require an
 *      explicit per-event collaboration assignment instead.
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
 * Ordinary groups need roster members; an explicitly assigned
 * collaboration may appear without any member affiliations recorded.
 *
 * Pure — no Prisma / Next imports, so it unit-tests in isolation.
 */

import { rootOf, type ArtistHierarchy } from "@/lib/artistHierarchyTree";
import type { AvailableSong } from "@/lib/types/predict";
import type { EventRosterEntry } from "@/lib/types/setlist";

export interface FestivalGroupRef {
  /** Root artist id (string — hierarchy key space; see
   *  `artistHierarchy.ts` for why ids are strings there). */
  rootId: string;
  /** Distinct roster performers reaching this root. Ordering key
   *  after `sortOrder`. */
  performerCount: number;
  /** The root's `Artist.sortOrder`, null when the operator set none. */
  sortOrder: number | null;
}

/**
 * Distinct root groups reached from the roster, in festival order:
 *
 *   1. `Artist.sortOrder` ascending — the operator's series order
 *      (e.g. by debut), so a franchise festival lists its series the
 *      way fans know them rather than by headcount. Roots without one
 *      come after every root that has one.
 *   2. Performer count desc (the headline groups first).
 *   3. First-appearance order — the roster arrives in canonical seed
 *      order, so ties read in the same sequence as the lineup card.
 *
 * With no sortOrder anywhere (every event before the operator fills
 * it), 1 is a no-op and the order is exactly the old count rule.
 * This is the ONE place festival roots are ordered: the fan board's
 * chips and the prediction picker's chips both come from here.
 *
 * Side-project membership alone does not establish a collaboration's
 * appearance: members of GKSS or AiScReam may attend as part of their
 * home groups. Only the operator's per-event assignment adds a side
 * project, regardless of how many of its members attend. No assignment
 * changes membership data or the side project's own headlined shows.
 */
export function resolveFestivalGroups(
  roster: readonly EventRosterEntry[],
  hierarchy: ArtistHierarchy,
  collaborationArtistIds: readonly (bigint | number | string)[] = [],
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
  const assigned = new Set(collaborationArtistIds.map(String));
  for (const id of assigned) {
    // A stale/deleted/reclassified assignment cannot invent an artist
    // outside the live hierarchy, or turn a sub-unit into another root.
    if (hierarchy.sideProjects.has(id) && hierarchy.parentOf.get(id) === null) {
      if (!counts.has(id)) counts.set(id, 0);
    }
  }
  // Map iteration is insertion order, and `Array.prototype.sort` is
  // stable, so equal keys keep first-appearance order.
  return [...counts]
    .filter(([root]) => !hierarchy.sideProjects.has(root) || assigned.has(root))
    .map(([rootId, performerCount]) => ({
      rootId,
      performerCount,
      sortOrder: hierarchy.sortOrderOf.get(rootId) ?? null,
    }))
    .sort(
      (a, b) =>
        compareSortOrder(a.sortOrder, b.sortOrder) ||
        b.performerCount - a.performerCount,
    );
}

/** Ascending, nulls last; 0 for "same tier" so the next key decides. */
function compareSortOrder(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
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
