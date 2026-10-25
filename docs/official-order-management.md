# Managing official display order

`officialOrder.ts` owns comparisons. The admin Artist form distinguishes
artist rank (roots and siblings), the identity's default member rank, and
the exact artist/member relationship rank. Dates, translations and history
are independent. Empty UI inputs explicitly clear their own rank. Duplicate
relationship ranks are allowed with a warning and the common default tie.

`PUT /api/admin/artists/:id/stage-identities` accepts
`{ stageIdentityId, sortOrder }`. `sortOrder` must be a signed 32-bit JSON
integer or null. Omission preserves; null clears. A missing relationship
returns 404 and is never created. The response carries the persisted rank;
the form reorders with `createOfficialOrdering().sortMembers` in that artist
context. Reload uses `membershipOrderBy()` on the same filtered relationship.

## CSV

The admin importer type `membership-order` consumes a separate file:

```csv
artistSlug,memberSlug,sortOrder
unit-slug,existing-member-slug,1
unit-slug,another-existing-member,__CLEAR__
unit-slug,preserve-this-member,
```

Blank or missing cells preserve. `__CLEAR__` clears; the word `null`, fractions,
NaN, exponents and out-of-range integers are errors. Missing artists, members
or memberships are row errors, including preserve rows. Each row transaction
changes only the existing pair's rank. Successful rows remain committed on
partial failure; replay is safe and reports unchanged rows as PRESERVED.
The response `count` is the number of changed rows, with UPDATED/PRESERVED/ERROR
log entries. Existing `members.csv` continues editing default member order
with its existing blank-clear semantics; do not interchange these files.

After committed admin writes/imports, `revalidatePublicData()` expires the
Next public-data tag and writer-warm entries. Rank changes do not bump a
setlist revision. Normal live acceptance still compares capturedAt at the
same revision. The warm expiry's documented in-flight late-fill limitation
remains; ticket 03 wires rank metadata into consistent live reads and checks
its final order. Ticket 02 does not establish public SSR/live display parity.

## Source-backed changes

Audit the complete current catalog and preserve source URLs, checked dates,
contexts and before/after values in the ticket handoff. Official text order
may be stored as ordinals after owner approval; do not invent official numbers
or use a single performance introduction/track sequence as general rank.
Conflicts and inaccessible sources remain explicit null/fallback decisions.
No membership is created by an order import. Apply only an approved dev
manifest with before-value checks, replay/rollback verification and preserved
performance baselines. Production application belongs to ticket 05.
