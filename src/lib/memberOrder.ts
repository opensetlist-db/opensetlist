import type { Prisma } from "@/generated/prisma/client";

// Official member order — the one ordering rule every member list on
// the site (event lineup, artist page, performer checklists, admin
// pickers) applies, so a group's members read the same way wherever
// they appear.
//
//   1. `StageIdentity.sortOrder` ascending — the operator's number,
//      normally copied from the official site's member list. NULLS
//      LAST, so members nobody has numbered yet trail the numbered
//      ones instead of jumping ahead of them (Postgres already sorts
//      NULL last for ASC; spelling it out keeps the rule independent
//      of the database default).
//   2. `createdAt` ascending — the pre-sortOrder behaviour (seed order
//      ≈ canonical order), so an unnumbered group keeps today's order.
//   3. id — deterministic tiebreak for rows created in one statement
//      (bulk seeds share a timestamp).
//
// Built as functions returning fresh arrays rather than shared
// constants: Prisma's orderBy inputs are mutable array types, and a
// fresh literal per call keeps a caller from mutating the rule for
// everyone else.

/** orderBy for a `stageIdentity.findMany` (or a StageIdentity include). */
export function stageIdentityOrderBy(): Prisma.StageIdentityOrderByWithRelationInput[] {
  return [
    { sortOrder: { sort: "asc", nulls: "last" } },
    { createdAt: "asc" },
    { id: "asc" },
  ];
}

/**
 * orderBy for a table that points at one StageIdentity through a
 * `stageIdentity` relation plus a `stageIdentityId` column —
 * EventPerformer, StageIdentityArtist. The tiebreak is the FK column
 * itself (= the identity's id) so it needs no extra join.
 */
export function byStageIdentityOrderBy(): Array<
  | { stageIdentity: Prisma.StageIdentityOrderByWithRelationInput }
  | { stageIdentityId: Prisma.SortOrder }
> {
  return [
    { stageIdentity: { sortOrder: { sort: "asc", nulls: "last" } } },
    { stageIdentity: { createdAt: "asc" } },
    { stageIdentityId: "asc" },
  ];
}

/** What `compareMemberOrder` needs from a member row. */
export type MemberOrderKey = {
  id: string;
  sortOrder: number | null;
  // A Date on the server, an ISO string once the row crossed a JSON /
  // RSC boundary (the admin form gets its list through
  // `serializeBigInt`, which stringifies dates).
  createdAt: Date | string;
};

function toMillis(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

/**
 * The same rule as `stageIdentityOrderBy`, for a list that is re-sorted
 * in memory after a local edit (the admin artist form re-sorts after a
 * 정렬 순서 save or a link), so the screen shows exactly the order a
 * reload would bring back. Falling back to "keep the current order" for
 * ties / unnumbered members is not enough: clearing a member's number
 * moves it to its creation slot on the server, not where it happened
 * to sit.
 *
 * This module only imports Prisma *types*, so the client bundle can
 * import the comparator without pulling the Prisma client in.
 */
export function compareMemberOrder(a: MemberOrderKey, b: MemberOrderKey): number {
  // NULLS LAST: an unnumbered member sorts after every numbered one.
  if (a.sortOrder !== b.sortOrder) {
    if (a.sortOrder === null) return 1;
    if (b.sortOrder === null) return -1;
    return a.sortOrder - b.sortOrder;
  }
  const byCreated = toMillis(a.createdAt) - toMillis(b.createdAt);
  if (byCreated !== 0) return byCreated;
  // Code-unit comparison, not localeCompare. The id is a uuid string in
  // a text column: lowercase hex with hyphens at fixed positions, so
  // the database's collation and plain string order agree on it.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
