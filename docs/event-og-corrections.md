# Event share-card corrections

Ordinary corrections publish a freshly reviewed version first, using the
[publication workflow](event-og-publication.md). They never overwrite images
or frozen metadata. Publishing another mode or completing an event is not a
correction. Public suspension is a separate operation.

## Operator procedure

1. Prepare/review the corrected card and publish its selected mode's ja/ko/en
   group. Inspect the new URLs before linking the previous version.
2. Run `node scripts/event-og.mjs list --event <id>`. This operator-only result
   includes each annotation's current version and private append-only correction
   history. Keep the source revision and expected annotation version.
3. Save a nonempty private reason (at most 1,000 characters) in a UTF-8 file.
   Invalid UTF-8 and NUL characters are rejected before CLI database access;
   Windows PowerShell 5.1 operators must explicitly select UTF-8 encoding.
   Allocate a new operation UUID for this decision and retain the exact inputs.
4. Execute explicitly:

```powershell
node scripts/event-og.mjs correct --event <id> --mode prediction --revision <old-UUID> --replacement <new-UUID> --expected-version 0 --operation <decision-UUID> --reason-file <private-reason.txt>
```

The CLI is dev-only, with the publication CLI's mandatory trusted Preview/local
origin. It accepts published, complete versions of the same event/mode and
storage namespace. Missing/deleted events, missing/incomplete/suspended targets,
cross-event/mode links, self links and cycles are refused. No storage write or
new generation occurs in the correction command.

Success prints the operation, source/target identifiers, resulting annotation
version and three locale URLs for each. Keep both old and new links: the old
one now explains the correction; the new normal one still opens the event top.
Private reasons, operation fingerprints and history are never public notice
text. The public notice uses the message catalog in the reader's language.

## Retries, conflicts and history

Same operation UUID and exact inputs return `reconciled` while that decision
is still current. Different content under that UUID, a stale expected version,
or retrying a superseded decision returns `correction_conflict`; inspect `list`
and make a deliberate new decision. Do not increment the expected version just
to suppress a conflict. Each successful decision appends its timestamp, private
reason, previous status/target and old/new versions, in the annotation transaction.

An event/mode-wide transaction advisory lock precedes all mutable graph reads,
using `event-card-annotation:<eventId>:<mode>`. READ COMMITTED after this lock
avoids a pre-lock stale snapshot. Source CAS and history are atomic. The lock
prevents simultaneous A→B and B→A from both committing. Future public-suspension
operations must follow the same graph lock/version protocol and retain priority;
this command never clears suspension state.

Known pre-commit failure exposes no partial annotation/history. Lost COMMIT
responses reconcile the operation and its current annotation in one consistent
snapshot. If DB access cannot establish the outcome, `outcome_unknown` is an
unsuccessful result: retry the identical operation, never invent a new success
or restore the old pointer. No automatic network/transaction retry loop runs.

## Public notice and freshness

A corrected URL remains200 with its original image, title, description, self
canonical/og:url and Twitter metadata. It has no auto-navigation script or
destination trigger. Its localized notice offers an explicit latest same-locale
share URL; A→B→C resolves to C. A missing, suspended, incomplete or malformed
chain yields a readable unavailable notice plus the canonical event link,
without redirecting or guessing another publication. A source whose annotation
is suspended remains subject to the separate public-suspension consumer.

The share reader already performs direct uncached DB reads. Both mutable graph
and source annotation remain uncached; the route is force-dynamic with no-store
HTML/CDN headers. There is no annotation cache entry to expire after commit.
The next read of a previously warmed URL sees the committed notice. This avoids
pretending that CLI `revalidateTag` works outside a Next request runtime and
does not purge unrelated event/live caches or alter immutable PNG caching.

## Validation

```powershell
npx vitest run src/__tests__/unit/event-og-publication.test.ts
npx vitest run -c vitest.integration.config.ts src/__tests__/integration/event-og-correction.test.ts
# Matching production build/start, dev DB/bucket and test namespace required:
$env:EVENT_CARD_R2_E2E='1'; $env:R2_KEY_PREFIX='test'
$env:NEXT_PUBLIC_BASE_URL='http://127.0.0.1:3194'; $env:TEST_BASE_URL=$env:NEXT_PUBLIC_BASE_URL
npx playwright test tests/e2e/event-og-correction.spec.ts
```

The opt-in E2E writes twelve retained synthetic PNGs and records keys before
PUTs. It warms A, corrects it via the real CLI, compares frozen OG and public
PNG hashes, tests all three localized mobile/keyboard/no-JS notices, follows B
to the event, and checks other modes still auto-open. `og03e2e-` DB fixtures and
their history are purged/cleaned. This is not production/X rollout evidence.

## Shared dev schema application

`EventCardCorrection` is additive and server-only; RLS and revokes follow the
existing publication tables. Do not weaken `schema-push.sh` if a live DB diff
would drop another active branch's columns. In that situation, review the
base-schema→task-schema file diff and apply only this table's DDL and security
in one dev session-pooler transaction. Verify hashes, preservation of the other
column, RLS/grants and the anon-exposure audit. Retain this separate evidence;
the normal remote migration workflow is not a success if its whole-schema
guard refuses unrelated drops. Production migration remains the later release
workflow, after integration/schema reconciliation.
