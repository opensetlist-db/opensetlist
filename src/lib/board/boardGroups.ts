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
 *
 * The board itself goes one step further than the picker: side
 * projects (`Artist.isSideProject`) get no board column —
 * `fanBoardRootIds` is `boardGroupRootIds` minus those, and it is what
 * `loadBoardGroups` (every board consumer) resolves.
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
  /** Explicit side-project appearances for the festival picker. */
  collaborationArtistIds?: readonly IdLike[];
}

/**
 * Ordered root ids (hierarchy key space: decimal strings) of the
 * board's groups. Callers load display rows for exactly these ids.
 */
export function boardGroupRootIds({
  roster,
  hierarchy,
  primaryArtistId,
  collaborationArtistIds,
}: BoardGroupIdsInput): string[] {
  if (primaryArtistId !== null) return [rootOf(hierarchy, primaryArtistId)];
  return resolveFestivalGroups(roster, hierarchy, collaborationArtistIds).map((g) => g.rootId);
}

/**
 * The fan board's root ids: `boardGroupRootIds` without side projects,
 * on the festival branch only.
 *
 * Why only the board: a cross-IP side unit is a top-level Artist, so
 * the roster walk makes it a root next to the series it borrows its
 * members from. The picker keeps it only when explicitly assigned to
 * the event (`resolveFestivalGroups`). On the board it is a
 * near-empty extra column next to the series fans actually pick for,
 * so it is dropped here and nowhere else (catalog, picker chips and
 * song pages keep it).
 *
 * The single-artist branch is left alone: there the series artist IS
 * the show, so a side project's own concert keeps its one column —
 * dropping it would leave that board with no group at all.
 *
 * Consequence downstream: a song whose only root is a side project is
 * on no board group's catalog, so the full-setlist bridge
 * (`boardGroupsBySong`) leaves it out and the write validators answer
 * `invalid_group` for its group id.
 */
export function fanBoardRootIds(input: BoardGroupIdsInput): string[] {
  const rootIds = boardGroupRootIds(input);
  if (input.primaryArtistId !== null) return rootIds;
  return rootIds.filter((id) => !input.hierarchy.sideProjects.has(id));
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
 * Composition of `fanBoardRootIds` + `boardGroupsFromRows` for
 * callers that already hold the display rows. A caller that must load
 * the rows first (the event page) computes the ids once, loads, then
 * calls `boardGroupsFromRows` directly instead of resolving twice.
 */
export function resolveBoardGroups({
  roster,
  hierarchy,
  primaryArtist,
  groupArtists,
  locale,
}: BoardGroupsInput): BoardGroup[] {
  const rootIds = fanBoardRootIds({
    roster,
    hierarchy,
    primaryArtistId: primaryArtist?.id ?? null,
  });
  const rows = primaryArtist ? [...groupArtists, primaryArtist] : groupArtists;
  return boardGroupsFromRows(rootIds, rows, locale);
}

/**
 * Ordered root ids + their display rows → board groups.
 *
 * A root whose display row is missing (soft-deleted between the
 * hierarchy read and the row read) or whose id isn't JS-safe drops out
 * silently and the rest keep their order — the same policy the
 * festival picker applies, so a board group always has a picker chip.
 * NB on a single-artist event whose series artist is a sub-unit, the
 * root is a different artist: its row must be among `rows`, or the
 * board has no group.
 *
 * When two rows share an id the LAST wins (`resolveBoardGroups` appends
 * the series artist, the row the page already rendered the header
 * from).
 */
export function boardGroupsFromRows(
  rootIds: readonly string[],
  rows: readonly BoardGroupArtistRow[],
  locale: string,
): BoardGroup[] {
  const rowById = new Map<string, BoardGroupArtistRow>();
  for (const r of rows) rowById.set(String(r.id), r);

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

/**
 * The series' primary artist when the event is single-artist, else
 * null (no series, festival series with `artistId = null`, or a
 * soft-deleted series artist — the relation isn't `isDeleted`-filtered
 * in the page query). This is the one place that decides which branch
 * of the board resolver an event takes; the page, the board read route
 * and the pick write routes must all ask here so they can't disagree.
 */
export function seriesPrimaryArtistOf<
  A extends { isDeleted: boolean },
>(series: { artist: A | null } | null | undefined): A | null {
  const artist = series?.artist;
  return artist && !artist.isDeleted ? artist : null;
}
