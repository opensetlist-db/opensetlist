/**
 * Which groups does an event's fan board (n15) have, in which order.
 *
 * One answer for every event shape, so the board's routes, loaders and
 * components can't disagree about it:
 *
 *   - Multi-artist event (the Fes — no series artist): the ROOT groups
 *     reached from the roster, in festival order. This is exactly the
 *     festival picker's `resolveFestivalGroups` — reused, not copied,
 *     so the board's chips and the picker's chips can never drift.
 *   - Single-artist event (a series with a primary artist): exactly one
 *     group, the root of that artist. The festival catalog path can't
 *     express this — on single-artist events every song's
 *     `festivalGroupIds` is empty — so the board needs this adapter to
 *     get one group chip there.
 *
 * Two steps because the display rows (slug / colour / localized name)
 * live behind a cached DB read the caller owns: `boardGroupRootIds`
 * says which roots to load, `resolveBoardGroups` turns the loaded rows
 * into board groups. Both are pure — no Prisma / Next imports — so they
 * unit-test in isolation and are safe to import from client code.
 */

import { rootOf, type ArtistHierarchy } from "@/lib/artistHierarchyTree";
import { safeBigIntToNumber } from "@/lib/copyPastSetlist";
import { displayNameWithFallback } from "@/lib/display";
import { resolveFestivalGroups } from "@/lib/predict/festivalCatalog";
import type { EventRosterEntry } from "@/lib/types/setlist";

type IdLike = bigint | number | string;

/** The display fields a board group is built from — a structural
 *  subset of an `Artist` row with its locale-filtered translations
 *  (what `getFestivalGroupArtistsCached` and the event page's series
 *  artist both carry). */
export interface BoardGroupArtistRow {
  id: IdLike;
  slug: string;
  color: string | null;
  originalName: string | null;
  originalShortName: string | null;
  originalLanguage: string;
  translations: readonly {
    locale: string;
    name: string;
    shortName: string | null;
  }[];
}

/** Same shape `deriveFestivalFilters` consumes, so a board group list
 *  can feed the existing chip derivation unchanged. */
export interface BoardGroup {
  artistId: number;
  slug: string;
  /** Localized SHORT name (`displayNameWithFallback(…, "short")`). */
  label: string;
  /** `Artist.color`; null means "use the primary colour" downstream. */
  color: string | null;
}

export interface BoardGroupIdsInput {
  roster: readonly EventRosterEntry[];
  hierarchy: ArtistHierarchy;
  /** The series' primary artist id when the event is single-artist
   *  (alive series artist), else null. Its presence alone selects the
   *  single-artist branch — the roster is then ignored, so a guest from
   *  another IP on a solo show does not add a second group. */
  primaryArtistId: IdLike | null;
}

/**
 * Ordered root ids (hierarchy key space: decimal strings) of the
 * board's groups. Callers load display rows for exactly these ids.
 */
export function boardGroupRootIds({
  roster,
  hierarchy,
  primaryArtistId,
}: BoardGroupIdsInput): string[] {
  if (primaryArtistId !== null) return [rootOf(hierarchy, primaryArtistId)];
  return resolveFestivalGroups(roster, hierarchy).map((g) => g.rootId);
}

export interface BoardGroupsInput {
  roster: readonly EventRosterEntry[];
  hierarchy: ArtistHierarchy;
  /** The alive series artist on a single-artist event, else null. When
   *  it is itself the root it doubles as that root's display row. */
  primaryArtist: BoardGroupArtistRow | null;
  /** Display rows for the ids `boardGroupRootIds` returned (any order;
   *  extra rows are ignored). */
  groupArtists: readonly BoardGroupArtistRow[];
  locale: string;
}

/**
 * The board's groups, in board order.
 *
 * A root whose display row is missing (soft-deleted between the
 * hierarchy read and the row read) or whose id isn't JS-safe drops out
 * silently and the rest keep their order — the same policy the
 * festival picker applies, so a board group always has a picker chip.
 */
export function resolveBoardGroups({
  roster,
  hierarchy,
  primaryArtist,
  groupArtists,
  locale,
}: BoardGroupsInput): BoardGroup[] {
  const rootIds = boardGroupRootIds({
    roster,
    hierarchy,
    primaryArtistId: primaryArtist?.id ?? null,
  });
  const rowById = new Map<string, BoardGroupArtistRow>();
  for (const r of groupArtists) rowById.set(String(r.id), r);
  // Primary last so it wins over a duplicate in `groupArtists` — it is
  // the row the page already rendered the header from.
  if (primaryArtist) rowById.set(String(primaryArtist.id), primaryArtist);

  const groups: BoardGroup[] = [];
  for (const rootId of rootIds) {
    const r = rowById.get(rootId);
    const artistId = r ? safeBigIntToNumber(BigInt(rootId)) : null;
    if (!r || artistId === null) continue;
    groups.push({
      artistId,
      slug: r.slug,
      label: displayNameWithFallback(r, r.translations, locale, "short"),
      color: r.color,
    });
  }
  return groups;
}
