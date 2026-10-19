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
