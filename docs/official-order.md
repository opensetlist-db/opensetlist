# Official display ordering

`src/lib/officialOrder.ts` is the pure, server/client-safe display contract.
It does not load data or decide who performed, which affiliation is legal,
which credit is eligible, or who represents a song/event. Existing consumers
keep their current behavior until they explicitly adopt this API.

## Inputs and fallback

Create one `createOfficialOrdering(artists)` per consistent metadata snapshot.
Supply the active Artist hierarchy, including ancestors, with `id`,
`parentArtistId`, `type`, and `sortOrder`. Decimal ID strings are recommended
for JSON; bigint and safe integer numbers also work. Unsafe numbers are
rejected rather than silently rounding. Do not use the existing lossy
BigInt-to-Number serializer for ordering metadata.

Artist paths compare each ancestor's `sortOrder ASC NULLS LAST`, then numeric
ID. A parent precedes its descendants; child unit/solo ranks are local to
their parent. Missing/deleted ancestors stop the path at the highest loaded
node. Unknown displayed artists use null rank and numeric ID. Duplicate
metadata IDs or cyclic paths are invalid and throw; do not mix inconsistent
snapshots. The factory copies metadata and never changes shared hierarchy
maps, source arrays or rows.

`sortArtists(rows, key)` returns the same row objects in a new array:

```ts
const order = createOfficialOrdering(artistMetadata);
const displayed = order.sortArtists(section.artists, (artist) => ({
  artistId: artist.id,
  // Only include this on event surfaces that already classify guests.
  isGuest: artist.isGuest,
}));
```

The member key contains the default `StageIdentity` fields (`id`, `sortOrder`,
`createdAt`), already resolved `groupArtistIds`, and `membershipOrders` with
`artistId` and nullable `sortOrder`. These orders are metadata, not evidence
of membership or appearance. Pass actual displayed rows only. A relation
rank sorts before every unranked relation, even one with a lower default
rank. Ties/unranked relations use default rank, creation instant, UUID
code-unit order. Signed 32-bit integers including zero/negative values and
null are valid; `isOfficialRank` rejects fractions, NaN, overflow and omission.
Dates may be Date objects or serialized ISO timestamps with an explicit `Z`
or numeric timezone offset for the same instant. Zone-less/loose strings are
rejected rather than interpreted in the host's local timezone.

## Member contexts

```ts
// Group roster: only this group's relation rank, then the default member key.
order.sortMembers(rows, memberKey, { kind: "artist", artistId: groupId });

// Unit page / eligible single-unit credit: that unit's rank takes priority.
order.sortMembers(actualPerformers, memberKey, {
  kind: "artist", artistId: unitId,
});

// Mixed roster: resolved groups in official order, then each group's member
// order. No known group follows known groups, using only the default key.
order.sortMembers(rows, memberKey, { kind: "mixed" });

// Existing badge/credit logic must already have declared these units eligible.
// stageIdentityIds is the intersection of explicit credit participation and
// actual displayed performers; never expand it to a unit's complete roster.
order.sortMembers(actualPerformers, memberKey, {
  kind: "credits",
  eligibleUnitCredits: [
    { artistId: unitA, stageIdentityIds: actualUnitAPerformerIds },
    { artistId: unitB, stageIdentityIds: actualUnitBPerformerIds },
  ],
});
```

Eligible unit sections come first, in official hierarchy order; a member in
multiple units uses the first valid unit as an ordering key only. An explicit
descendant unit is more specific than its credited ancestor for that member.
Remaining members use resolved group/default order. A non-unit or unloaded
unit in `eligibleUnitCredits` throws rather than legitimizing a bad solo
credit. Single-group, full_group, no-credit, and solo/special cases without
eligible units use an explicit group or `mixed` context (an empty credit list
is equivalent to mixed). Existing stage/badge semantics stay with consumers.

If multiple legal groups remain for a flat row, the first officially ordered
group becomes its comparison key. This never changes `groupArtistIds` or
stores a representative affiliation. Unknown/deleted groups are ignored as
contexts; `groupArtistIds` accepts only loaded `type=group` nodes. For a solo
or unit page use the explicit `artist` context instead. An ungrouped member's
historical memberships do not invent a group.

On event lists, pass the existing `EventPerformer.isGuest` through the member
key. All ordinary performers precede all guests, before unit/group/member
comparison. For an already selected artist section containing only guests,
pass its existing guest classification to `sortArtists`. Do not invent a
guest concept on other pages.

## Query and integration boundaries

`membershipOrderBy()` is a fresh Prisma orderBy array for a relation query
restricted to **one artist**. It mirrors the pure fixed-artist context.
`stageIdentityOrderBy()`, `byStageIdentityOrderBy()` and `compareMemberOrder()`
remain the legacy/default member contract; they deliberately ignore relation
ranks. A mixed artist query cannot use a single SQL relation rank ordering.

For live/SSR consumers, batch-load the required hierarchy and relation keys
inside the same consistent snapshot read. The factory performs zero queries.
Do not load a relation per performer/song, send the entire hierarchy on each
poll, or combine independently aged hierarchy and roster caches. Server-side
ordering can keep the wire DTO narrow; if clients need to rederive ordering,
version/normalize metadata at that boundary explicitly. Preserve same-revision
newer `capturedAt` acceptance and existing revision/broadcast semantics.

Rank writes in management/import work must preserve omitted values, clear
only explicit null, and invalidate the real public/hierarchy/roster/live and
writer-warm dependencies through the existing invalidation path. Cache/wire
integration and UI application are separate follow-up work, not implemented
by this pure module.

Call within existing role/category/franchise sections. Keep synthetic filter
positions, board side-project exclusions, picker scope, search relevance,
vote rank, user prediction position, song position/medley/encore and album
track order. Resolve representatives/catalog owners before display sorting;
do not feed a newly sorted `rows[0]` back into those decisions.

## Schema and rollout

`StageIdentityArtist.sortOrder Int?` is additive, with no default/backfill.
`StageIdentity.sortOrder` remains the global default; Artist ranks apply at
every level. Historical events use today's display rank without changing
their performer sets, voices, affiliations or actual musical order.

Inspect the actual shared dev schema diff before applying. Another branch's
objects must survive: a guarded whole-schema push may refuse unrelated DROP
statements. In that case apply only the reviewed nullable-column addition,
not `--accept-data-loss`. Existing rows remain null. An old generated client
ignores the added column. Rollback can revert adoption code while retaining
the nullable column. No production migration or guessed catalog rank is part
of this module's rollout.
