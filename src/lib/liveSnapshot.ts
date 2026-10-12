import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { Prisma, type EventStatus } from "@/generated/prisma/client";
import { logPoolStats, prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { fetchEventWishlistTop3 } from "@/lib/wishes/top3";
import { getEventStatus, type ResolvedEventStatus } from "@/lib/eventStatus";
import { cachedQuery, eventTag, revalidateEventData } from "@/lib/dataCache";
import { revToNumber } from "@/lib/liveBroadcast";
import {
  __resetLiveWarmStateForTests,
  liveWarmEnabled,
  SLOWBUILD_MAX_MS,
  warmLookup,
} from "@/lib/liveWarm";
import type { ServerSnapshotVerify } from "@/lib/snapshotVerify";
import { INSTANCE_ID } from "@/lib/instanceId";
import { describeError, isDbTimeout } from "@/lib/dbErrors";
import { FALLBACK_LOCALE, type Locale } from "@/i18n/routing";
import type { FanTop3Entry, LiveSetlistItem } from "@/lib/types/setlist";

/**
 * n14 live snapshot — the single read behind `/api/setlist` and the
 * live (ongoing) event page's SSR seed.
 *
 * Consistency: everything is read in ONE `REPEATABLE READ` transaction
 * whose first statement reads the Event row (`setlistRevision`, raw
 * status/startTime, `now()`). Postgres takes the transaction snapshot
 * at that first statement, so the items, the reaction counts and the
 * wish TOP-3 all describe exactly the state at `rev` — a save that
 * commits mid-build is either entirely in (and then `rev` includes it)
 * or entirely out. The old route read the three slices with separate
 * auto-commit queries, so one response could mix two revisions.
 *
 * `capturedAt` is the transaction's `now()` (its start instant). Every
 * write whose commit finished before that instant is visible in the
 * snapshot, which is the property the reaction ack watermark relies
 * on: a client holding an ack taken with `clock_timestamp()` AFTER its
 * write committed releases the hold only for a snapshot with
 * `capturedAt > ackAt`. (A write that commits between BEGIN and the
 * first statement is visible but has `ackAt > capturedAt`, which only
 * holds the ack one snapshot longer — the safe direction.)
 *
 * Caching: the built snapshot goes into the Next data cache for 2 s,
 * keyed `(eventId, locale)` and tagged `event:<id>`; every setlist
 * writer expires that tag after commit. Concurrent misses on one
 * instance are coalesced (`inFlight`). The resolved `status` is NOT
 * part of the cached value — the route resolves it from the cached raw
 * status + startTime at response time, so the scheduled → ongoing flip
 * at startTime happens without any write.
 */

export type EventSnapshot = {
  /** False when no Event row exists for the id. */
  found: boolean;
  isDeleted: boolean;
  rawStatus: EventStatus | null;
  startTime: Date | null;
  /** `Event.setlistRevision` as of the snapshot (0 when not found). */
  rev: bigint;
  /** Postgres `now()` of the snapshot transaction. */
  capturedAt: Date;
  /** Wire-shaped items (BigInt → number, `confirmCount` flattened). */
  items: LiveSetlistItem[];
  reactionCounts: Record<string, Record<string, number>>;
  top3Wishes: FanTop3Entry[];
  /** Random id of the build that produced this value (diagnostics). */
  buildId: string;
};

/**
 * Where the served snapshot came from (`x-snapshot-source`, diagnostics):
 * `build` / `cache` / `repair` — the data-cache paths below; `warm` — a
 * writer-warmed Runtime Cache entry for the request's exact `minRev`
 * (`src/lib/liveWarm.ts`, flagged).
 */
export type SnapshotSource = "build" | "cache" | "repair" | "warm";

// ---------------------------------------------------------------------
// Test-only hook: pause the builder right after the snapshot-defining
// first statement. The integration test uses it to commit a change from
// another connection while a build is mid-flight and prove the build is
// still entirely the old state. `null` in production — the check is one
// branch per build.
// ---------------------------------------------------------------------
type SnapshotHook = (eventId: bigint) => Promise<void>;
let onSnapshotEstablished: SnapshotHook | null = null;
export function __setSnapshotEstablishedHookForTests(
  hook: SnapshotHook | null,
): void {
  onSnapshotEstablished = hook;
}

// Records which builds ran inside the current request's async context,
// so the caller can tell a real build ("build") from a cache hit
// ("cache") — including the stale-while-revalidate case where
// `unstable_cache` returns the OLD value and regenerates in the
// background (the background build's id is recorded, but the returned
// value carries the old id, so it is correctly reported as "cache").
const buildContext = new AsyncLocalStorage<{ builtIds: string[] }>();

/**
 * Timing a caller can ask the builder to record (an out-param, filled
 * in place). Used by the writer warm job (`src/lib/liveWarm.ts`) for its
 * `[liveWarm] set` line; all values `Date.now()` epoch ms of this
 * server.
 *   txStartAt — the transaction callback was entered: Prisma obtained a
 *               pool connection and ran BEGIN. Waiting for a connection
 *               happens BEFORE this, so `txStartAt − <call time>` is
 *               queueing, and `[txStartAt, txEndAt]` is the interval a
 *               connection was actually held by this build.
 *   txEndAt   — the callback returned or threw (COMMIT follows).
 *   holdMs    — the `holdMs` actually applied (after clamping); 0 when
 *               none.
 * Not set at all when the transaction never started.
 */
export type SnapshotBuildTiming = {
  txStartAt?: number;
  txEndAt?: number;
  holdMs?: number;
};

export type BuildSnapshotOptions = {
  /**
   * Drill only (`slowbuild` warm fault): sleep this long INSIDE the
   * REPEATABLE READ transaction, right after the snapshot-establishing
   * first statement — the capture is fixed and the pool connection is
   * held for the whole sleep. Clamped to `SLOWBUILD_MAX_MS` (5 s) so it
   * stays well inside this transaction's 10 s `timeout`; the limits
   * below are deliberately NOT raised for it. The reader path
   * (`cachedSnapshot`, `cachedSnapshotAtRev`) never passes it.
   */
  holdMs?: number;
  /** Out-param, see `SnapshotBuildTiming`. */
  timing?: SnapshotBuildTiming;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Wrap a transaction callback so it stamps entry/exit into `timing`.
// Without a timing record (every reader build) the callback is passed
// through untouched — no extra closure, no extra work.
function withTxTiming<R>(
  timing: SnapshotBuildTiming | undefined,
  fn: (tx: Prisma.TransactionClient) => Promise<R>,
): (tx: Prisma.TransactionClient) => Promise<R> {
  if (!timing) return fn;
  return async (tx) => {
    timing.txStartAt = Date.now();
    try {
      return await fn(tx);
    } finally {
      timing.txEndAt = Date.now();
    }
  };
}

/**
 * Build one snapshot from the database. Uncached; exported for the
 * integration tests and wrapped by `getLiveSnapshot` for everything
 * else. `options` is for the writer warm job only (timing out-param,
 * drill hold); readers call it with two arguments.
 */
export async function buildEventSnapshot(
  eventId: bigint,
  locale: Locale,
  options: BuildSnapshotOptions = {},
): Promise<EventSnapshot> {
  const started = Date.now();
  const localeFilter = { locale: { in: [locale, FALLBACK_LOCALE] } };
  const { timing } = options;
  const requestedHold = options.holdMs ?? 0;
  const holdMs =
    Number.isFinite(requestedHold) && requestedHold > 0
      ? Math.min(Math.floor(requestedHold), SLOWBUILD_MAX_MS)
      : 0;

  const raw = await prisma.$transaction(
    withTxTiming(timing, async (tx) => {
      // FIRST statement — establishes the REPEATABLE READ snapshot.
      // LEFT JOIN from a one-row relation so a missing event still
      // yields `now()` (and found = false) instead of zero rows.
      // `status::text` because the raw-query path has no enum decoder.
      const head = await tx.$queryRaw<
        {
          capturedAt: Date;
          setlistRevision: bigint | null;
          status: EventStatus | null;
          startTime: Date | null;
          isDeleted: boolean | null;
          found: boolean;
        }[]
      >`
        SELECT now() AS "capturedAt",
               e."setlistRevision",
               e.status::text AS status,
               e."startTime",
               e."isDeleted",
               (e.id IS NOT NULL) AS found
          FROM (SELECT 1) AS one
          LEFT JOIN "Event" e ON e.id = ${eventId}
      `;
      const row = head[0];
      if (onSnapshotEstablished) await onSnapshotEstablished(eventId);
      // Drill hold (`slowbuild`): after the first statement, so the
      // snapshot is already established and the connection is held —
      // exactly a build that is slow while occupying the database.
      if (holdMs > 0) await sleep(holdMs);
      if (timing) timing.holdMs = holdMs;
      if (!row.found) {
        return { row, items: [], reactionGroups: [], top3Wishes: [] };
      }

      // Statements below run sequentially on the transaction's single
      // connection (a Promise.all inside one interactive transaction
      // would only queue them), so keep them ordered and the
      // transaction short.
      //
      // Explicit `select` (not `include`) to control egress on the
      // Postgres → Vercel pooler wire, which Supabase meters
      // uncompressed (F24: ~207 KB → ~30-38 KB per call). Every field
      // below is read by the event-page render code. The per-row
      // `event` LATERAL the pre-n14 route carried for status is gone —
      // status now comes from the first statement.
      const items = await tx.setlistItem.findMany({
        where: { eventId, isDeleted: false },
        orderBy: { position: "asc" },
        select: {
          id: true,
          position: true,
          isEncore: true,
          stageType: true,
          unitName: true,
          status: true,
          performanceType: true,
          type: true,
          createdAt: true,
          // Per-item Confirm count: the ✓ count on rumoured rows, the
          // conflict-group sort key (confirmCount DESC, createdAt ASC)
          // and the promotion threshold's client-side mirror.
          _count: { select: { confirms: true } },
          songs: {
            orderBy: { order: "asc" },
            select: {
              order: true,
              song: {
                select: {
                  id: true,
                  slug: true,
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
                          type: true,
                          color: true,
                          originalName: true,
                          originalShortName: true,
                          originalLanguage: true,
                          translations: {
                            where: localeFilter,
                            select: { locale: true, name: true, shortName: true },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          performers: {
            select: {
              stageIdentity: {
                select: {
                  id: true,
                  slug: true,
                  originalName: true,
                  originalShortName: true,
                  originalLanguage: true,
                  translations: {
                    where: localeFilter,
                    select: { locale: true, name: true, shortName: true },
                  },
                  // Sidebar per-unit member sublist re-derivation
                  // (`src/lib/sidebarDerivations.ts`) needs each
                  // performer's unit memberships.
                  artistLinks: { select: { artistId: true } },
                },
              },
              realPerson: {
                select: {
                  id: true,
                  slug: true,
                  originalName: true,
                  originalLanguage: true,
                  translations: {
                    where: localeFilter,
                    select: { locale: true, name: true },
                  },
                },
              },
            },
          },
          artists: {
            select: {
              artist: {
                select: {
                  id: true,
                  slug: true,
                  type: true,
                  color: true,
                  originalName: true,
                  originalShortName: true,
                  originalLanguage: true,
                  translations: {
                    where: localeFilter,
                    select: { locale: true, name: true, shortName: true },
                  },
                },
              },
            },
          },
        },
      });
      const reactionGroups = await tx.setlistItemReaction.groupBy({
        by: ["setlistItemId", "reactionType"],
        where: { setlistItem: { eventId, isDeleted: false } },
        _count: true,
      });
      const top3Wishes = await fetchEventWishlistTop3(eventId, locale, tx);
      return { row, items, reactionGroups, top3Wishes };
    }),
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      // Reads only; a build that takes longer than this is a symptom
      // (pool starvation), and failing it lets the client retry
      // rather than pinning a pooler connection. `maxWait` above the
      // 2 s default because a burst of cold builds across locales can
      // briefly queue on the 2-connection pool; it equals the pool's
      // own connect timeout (`src/lib/prisma.ts`), so whichever fires
      // first, the wait is bounded at 5 s.
      maxWait: 5_000,
      timeout: 10_000,
    },
  ).catch((err: unknown) => {
    // Logged here, with the build's own duration, once per real
    // build — coalesced waiters and the route share this error object
    // and skip it (see `logSnapshotFailure`).
    logSnapshotFailure(eventId, locale, Date.now() - started, err);
    throw err;
  });

  // Serialization happens after the transaction released its
  // connection.
  const reactionCounts: Record<string, Record<string, number>> = {};
  for (const g of raw.reactionGroups) {
    const key = g.setlistItemId.toString();
    if (!reactionCounts[key]) reactionCounts[key] = {};
    reactionCounts[key][g.reactionType] = g._count;
  }
  // Flatten Prisma's `_count.confirms` → `confirmCount` (the
  // LiveSetlistItem contract), then BigInt → number for the wire.
  const items = serializeBigInt(
    raw.items.map(({ _count, ...rest }) => ({
      ...rest,
      confirmCount: _count.confirms,
    })),
  ) as unknown as LiveSetlistItem[];

  const { row } = raw;
  const snapshot: EventSnapshot = {
    found: row.found,
    isDeleted: row.isDeleted ?? false,
    rawStatus: row.status,
    startTime: row.startTime,
    rev: row.setlistRevision === null ? BigInt(0) : BigInt(row.setlistRevision),
    capturedAt: row.capturedAt,
    items,
    reactionCounts,
    top3Wishes: raw.top3Wishes,
    buildId: randomUUID(),
  };
  buildContext.getStore()?.builtIds.push(snapshot.buildId);
  // One line per real build, so builds per save can be counted from
  // the Vercel logs (the `x-snapshot-source` header is per-response
  // and misses builds that happened in background revalidation).
  console.log(
    `[liveSnapshot] build event=${eventId} locale=${locale} rev=${snapshot.rev} ` +
      `items=${items.length} ms=${Date.now() - started} instance=${INSTANCE_ID}`,
  );
  // Same instance, same moment: the summariser sums each building
  // instance's pool `total` within a burst to estimate how many pooler
  // clients the burst held (the pooler's own client count is not
  // observable from here).
  logPoolStats("build");
  return snapshot;
}

// Failures already logged, so one failure that propagates from the
// builder through the data cache and the coalescing map to every
// waiting request is logged once — by the builder, with the build's
// own duration — instead of once per request.
const loggedFailures = new WeakSet<object>();

/**
 * `[liveSnapshot] build-failed …`, one line per distinct failure. The
 * builder logs its own; the route calls this again for whatever reached
 * it, which is a no-op for an error the builder already logged and a
 * line for a failure raised outside the builder (e.g. the cache layer).
 */
export function logSnapshotFailure(
  eventId: bigint,
  locale: Locale,
  ms: number,
  err: unknown,
): void {
  if (err !== null && typeof err === "object") {
    if (loggedFailures.has(err)) return;
    loggedFailures.add(err);
  }
  console.log(
    `[liveSnapshot] build-failed event=${eventId} locale=${locale} ms=${ms} ` +
      `err=${describeError(err)} instance=${INSTANCE_ID}`,
  );
}

// The data-cache entries. Args are primitives (cachedQuery's key
// contract); the event id travels as a decimal string.
const SNAPSHOT_TTL_SECONDS = 2;

const cachedSnapshot = cachedQuery(
  "event-live-snapshot",
  (eventIdKey: string, locale: string) =>
    buildEventSnapshot(BigInt(eventIdKey), locale as Locale),
  { revalidate: SNAPSHOT_TTL_SECONDS, tags: (eventIdKey) => [eventTag(eventIdKey)] },
);

// Repair entries, keyed additionally by a revision the SERVER read from
// the database (never a client-supplied value — see `getLiveSnapshot`).
// Needed because `revalidateTag` inside a Route Handler is only applied
// when the request finishes (Next 16 queues it in
// `workStore.pendingRevalidatedTags` and runs it in
// `executeRevalidates` after the handler returns), so calling
// `cachedSnapshot` again in the same request would return the very
// entry we just found stale. A fresh key forces a build now; the
// entry is shared through the data cache, so concurrent repairs for
// the same revision on other instances hit it instead of rebuilding.
const cachedSnapshotAtRev = cachedQuery(
  "event-live-snapshot-rev",
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- key-only arg
  (eventIdKey: string, locale: string, _dbRev: string) =>
    buildEventSnapshot(BigInt(eventIdKey), locale as Locale),
  { revalidate: SNAPSHOT_TTL_SECONDS, tags: (eventIdKey) => [eventTag(eventIdKey)] },
);

type SnapshotResult = { snapshot: EventSnapshot; source: SnapshotSource };

/** `getLiveSnapshot`'s answer: the shared snapshot + this request's verification. */
export type LiveSnapshotResult = SnapshotResult & { verify: ServerSnapshotVerify };

// Per-instance coalescing. A broadcast makes hundreds of clients fetch
// within the jitter window; the ones landing on the same warm lambda
// while a build is running share it instead of each opening a
// REPEATABLE READ transaction. Entries are removed when they settle.
type InFlight<T> = { promise: Promise<T>; waiters: number; startedAt: number };
const inFlight = new Map<string, InFlight<SnapshotResult>>();
const inFlightRepair = new Map<string, InFlight<SnapshotResult>>();
const inFlightRevRead = new Map<string, InFlight<bigint | null>>();

/**
 * One caller's view of a coalesced run: the shared value, plus whether
 * THIS caller started the run (`initiator`) or joined one already in
 * flight, and when the run started (`Date.now()` ms). The revision
 * check needs the distinction: a read this request started began after
 * the request did, so it is fresh evidence about the database; a read
 * it merely joined may have run its SELECT before a save this request
 * was told about committed, so it only counts as remembered evidence
 * (see `x-snapshot-verify` in `src/lib/snapshotVerify.ts`).
 */
type Coalesced<T> = { value: T; initiator: boolean; startedAt: number };

/**
 * Run `run` once per key on this instance; concurrent callers share the
 * result. `onShared(waiters)` fires when an entry settles that more than
 * one caller waited on (first caller included) — diagnostics for how
 * much per-instance coalescing absorbs a burst.
 *
 * Single-flight is unchanged by the provenance wrapper: the map still
 * holds exactly one shared promise per key, `run` is still invoked
 * only by the first caller, and every caller still settles with that
 * one promise's value or rejection — each caller merely receives its
 * own small `{ value, initiator, startedAt }` envelope around it.
 */
function coalesce<T>(
  map: Map<string, InFlight<T>>,
  key: string,
  run: () => Promise<T>,
  onShared?: (waiters: number) => void,
): Promise<Coalesced<T>> {
  const existing = map.get(key);
  if (existing) {
    existing.waiters += 1;
    const { startedAt } = existing;
    return existing.promise.then((value) => ({ value, initiator: false, startedAt }));
  }
  const entry: InFlight<T> = {
    promise: undefined as never,
    waiters: 1,
    startedAt: Date.now(),
  };
  entry.promise = run().finally(() => {
    if (map.get(key) === entry) map.delete(key);
    if (entry.waiters > 1) onShared?.(entry.waiters);
  });
  map.set(key, entry);
  const { startedAt } = entry;
  return entry.promise.then((value) => ({ value, initiator: true, startedAt }));
}

function logCoalesced(
  label: "coalesced" | "coalesced-repair",
  eventId: bigint,
  locale: Locale,
): (waiters: number) => void {
  // `coalesced` (first read) and `coalesced-repair` are separate
  // prefixes on purpose: one request can wait on both maps, and a
  // parser keyed on `[liveSnapshot] coalesced ` must not count it twice.
  return (waiters) =>
    console.log(
      `[liveSnapshot] ${label} waiters=${waiters} event=${eventId} ` +
        `locale=${locale} instance=${INSTANCE_ID}`,
    );
}

async function readThroughCache(
  read: () => Promise<EventSnapshot>,
  sourceOnBuild: SnapshotSource,
): Promise<SnapshotResult> {
  const ctx = { builtIds: [] as string[] };
  const snapshot = await buildContext.run(ctx, read);
  return {
    snapshot,
    source: ctx.builtIds.includes(snapshot.buildId) ? sourceOnBuild : "cache",
  };
}

// Last revision this instance read from the database, per event. The
// revision only ever grows, so a remembered value is always a valid
// LOWER bound of the current one. `readAt` (when the read finished)
// drives the memo window; `startedAt` (when it began) is the age the
// `x-snapshot-verify: memo=…;age=…` header reports, because the SELECT
// may have run at any instant between the two — the evidence is only
// guaranteed to be as recent as the read's start.
const revMemo = new Map<
  string,
  { rev: bigint | null; readAt: number; startedAt: number }
>();
// How long a completed read refutes hints above it. Bounds the repair
// check to one 1-row read per instance per burst: the pooler is the
// scarce resource (an uncached-read burst exhausted the dev pooler's
// client connections in the n14 probe), and with a public broadcast
// channel the hint is untrusted. Cost: a save that commits within this
// window after a read can have its repair delayed by up to this long —
// the client's retry schedule (1 s, 2 s, …) covers it.
const REV_MEMO_MS = 1_000;

// Bounds of the repair check's 1-row read, ≈ 1.5 s end to end. The
// read only decides whether to repair; when it cannot answer in time the
// caller serves the snapshot it already holds (the client's own retry
// schedule repairs later), so waiting longer buys nothing and holds one
// of this instance's two pool slots during exactly the overload that
// made it slow.
//
// The bound is enforced on the DATABASE side, not with a
// `Promise.race` around the query: a race only stops waiting — the
// abandoned statement keeps running on its connection, keeps the pool
// slot, and still costs the database the work. Instead the read runs in
// a short transaction whose first statement sets a transaction-local
// `statement_timeout`, so Postgres itself cancels the SELECT (SQLSTATE
// 57014) and the connection is returned at once. `set_config(…, true)`
// is `SET LOCAL` in function form: it ends with the transaction, so the
// setting never leaks to the next user of the pooled connection (which
// matters behind a transaction-mode pooler). Pool acquisition, which no
// server setting can bound, is capped by `maxWait`; `timeout` is
// Prisma's own backstop for the whole transaction. Cost: four round
// trips (BEGIN, set_config, SELECT, COMMIT) instead of one, at most once
// per instance per `REV_MEMO_MS`.
const REV_READ_MAX_WAIT_MS = 1_000;
const REV_READ_STATEMENT_TIMEOUT_MS = 500;
const REV_READ_TX_TIMEOUT_MS = 1_500;

/**
 * One bounded `SELECT "setlistRevision"` (see the bounds above). Throws
 * when the bound is hit. Exported for the dev-DB integration suite,
 * which checks it against the real pooler; everything else goes
 * through `verifiedRevision`.
 */
export async function readRevisionBounded(
  eventId: bigint,
): Promise<bigint | null> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT set_config('statement_timeout', ${String(REV_READ_STATEMENT_TIMEOUT_MS)}, true)
      `;
      const rows = await tx.$queryRaw<{ setlistRevision: bigint }[]>`
        SELECT "setlistRevision" FROM "Event" WHERE id = ${eventId}
      `;
      return rows.length > 0 ? BigInt(rows[0].setlistRevision) : null;
    },
    { maxWait: REV_READ_MAX_WAIT_MS, timeout: REV_READ_TX_TIMEOUT_MS },
  );
}

/**
 * Outcome of the repair check's revision lookup, with its provenance.
 *
 *   - `fresh`: this request itself started the bounded read (it was the
 *     coalescing initiator), so the read began after the request did.
 *   - `memo`: the value came from older evidence — the instance's
 *     remembered revision, or a read already in flight that this
 *     request joined as a coalesced waiter. `startedAt` is when that
 *     read began.
 *
 * `rev: null` means "cannot verify" in both cases — the event is
 * missing, or the read failed / ran out of time (a remembered failure
 * included) — and the caller serves its cached snapshot.
 */
type RevCheck =
  | { source: "fresh"; rev: bigint | null }
  | { source: "memo"; rev: bigint | null; startedAt: number };

/**
 * Database revision for the repair check: a remembered value when it
 * already satisfies the hint (`rev >= minRev`) or is younger than
 * `REV_MEMO_MS`, otherwise ONE bounded, uncached
 * `SELECT "setlistRevision"`, coalesced across concurrent requests on
 * this instance.
 */
async function verifiedRevision(
  eventId: bigint,
  minRev: number,
  hint: boolean,
): Promise<RevCheck> {
  const key = eventId.toString();
  const memo = revMemo.get(key);
  if (
    memo &&
    ((memo.rev !== null && memo.rev >= BigInt(minRev)) ||
      Date.now() - memo.readAt < REV_MEMO_MS)
  ) {
    return { source: "memo", rev: memo.rev, startedAt: memo.startedAt };
  }
  const read = await coalesce(inFlightRevRead, key, async () => {
    const started = Date.now();
    let rev: bigint | null = null;
    let outcome: string;
    try {
      rev = await readRevisionBounded(eventId);
      outcome = rev === null ? "none" : rev.toString();
    } catch (err) {
      // Cannot verify. Remembered like a successful read (as `null`) so
      // that during an overload this instance retries the read at most
      // once per `REV_MEMO_MS` instead of on every hinted request.
      outcome = isDbTimeout(err) ? "timeout" : "error";
      if (outcome === "error") {
        console.error(
          // `rev-read-error`, not `rev-read …`: the summariser keys on
          // the `[liveSnapshot] rev-read ` prefix for one line per read.
          `[liveSnapshot] rev-read-error event=${eventId} err=${describeError(err)} ` +
            `instance=${INSTANCE_ID}`,
        );
      }
    }
    revMemo.set(key, { rev, readAt: Date.now(), startedAt: started });
    // One line per real database read (coalesced waiters share it).
    // `hint` is the INITIATING request's `?hint=1` flag: whether a
    // notification fetch or a maintenance fetch paid for this read.
    console.log(
      `[liveSnapshot] rev-read event=${eventId} rev=${outcome} ` +
        `ms=${Date.now() - started} hint=${hint ? 1 : 0} instance=${INSTANCE_ID}`,
    );
    return rev;
  });
  return read.initiator
    ? { source: "fresh", rev: read.value }
    : { source: "memo", rev: read.value, startedAt: read.startedAt };
}

/**
 * Classify how a `minRev` hint was resolved, against the snapshot that
 * is actually being SERVED (after any repair) — the `x-snapshot-verify`
 * header value. Only called with a `minRev` (no hint → `none`).
 *
 * Why the served `rev` and not the first read decides `satisfied`: a
 * repair rebuild that reached `minRev` answered the hint, whatever the
 * cached entry said before it.
 *
 * `fresh` / `memo` report the revision the check saw. With a non-null
 * check revision `dbRev`, a served `rev < minRev` implies `dbRev <
 * minRev`: `dbRev > first rev` triggers the repair, whose entry is
 * built after a read that saw `dbRev` and so has `rev ≥ dbRev`; and
 * `dbRev ≤ first rev < minRev` otherwise. So `fresh=<dbRev>` really is
 * "the database was below the hint when a read that began after this
 * request looked".
 */
function classifyVerify(
  minRev: number,
  servedRev: bigint,
  check: RevCheck,
  now: number,
): ServerSnapshotVerify {
  if (servedRev >= BigInt(minRev)) return { kind: "satisfied" };
  if (check.rev === null) return { kind: "deferred" };
  const rev = revToNumber(check.rev);
  if (check.source === "fresh") return { kind: "fresh", dbRev: rev };
  return { kind: "memo", rev, ageMs: Math.max(0, now - check.startedAt) };
}

/** Test-only: forget per-instance coalescing and revision memo state. */
export function __resetLiveSnapshotStateForTests(): void {
  inFlight.clear();
  inFlightRepair.clear();
  inFlightRevRead.clear();
  revMemo.clear();
  __resetLiveWarmStateForTests();
}

/**
 * Parse the client's `?minRev=` hint. Non-negative safe integers only
 * (decimal digits, no sign/exponent/whitespace); anything else is
 * ignored (null) rather than rejected, so a malformed hint degrades to
 * a plain cached read.
 */
export function parseMinRev(raw: string | null): number | null {
  if (raw === null || !/^\d{1,16}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Parse the client's `?hint=1` marker: the request is a notification
 * fetch (sent because a broadcast hint arrived), as opposed to a poll /
 * catch-up / resume / recheck. Exactly `"1"` counts; anything else —
 * absent, empty, `true`, `0` — is "no hint", so an unexpected value
 * degrades to a plain request. The server logs it; with writer warming
 * on (`LIVE_WARM_ENTRIES=1`) it also enables the warm-entry lookup in
 * `getLiveSnapshot` — nothing else depends on it.
 */
export function parseHint(raw: string | null): boolean {
  return raw === "1";
}

/**
 * The cached, coalesced snapshot read.
 *
 * Repair path (`minRev`): the client passes the highest revision it has
 * seen (from a broadcast or an earlier snapshot). When the cached
 * snapshot is older, ONE uncached 1-row revision read (coalesced per
 * instance, and remembered for `REV_MEMO_MS` — see `verifiedRevision`)
 * decides whether the cache is really behind the database:
 *   - DB revision > cached revision → expire the event tag (applies
 *     after this request) and serve a snapshot built now under a
 *     server-read-revision key (`source: "repair"`);
 *   - otherwise the client's hint is ahead of the database (forged, or
 *     from a rolled-back world) → serve the cache unchanged;
 *   - the read could not answer within its ≈ 1.5 s bound (overload) →
 *     also serve the cache unchanged; the client retries the hint.
 * A forged `minRev` (the broadcast channel is public, so hints are
 * untrusted) therefore costs at most one primary-key read per instance
 * per `REV_MEMO_MS` and can never trigger a build or mint a cache key.
 *
 * This is the only database read on the hot path outside the cached
 * builder; a cache hit with no (or a satisfied) `minRev` touches the
 * database not at all.
 *
 * `verify` says how the hint was resolved for THIS request (see
 * `classifyVerify` and `src/lib/snapshotVerify.ts`). It is per-request
 * metadata for the response header and is never stored with the
 * snapshot. `opts.hint` (`?hint=1`) labels the revision-read log line
 * and gates the warm lookup below.
 *
 * Warm lookup (flagged, `LIVE_WARM_ENTRIES=1`): a notification fetch —
 * `hint` AND `minRev` — first asks the Runtime Cache for the entry a
 * writer stored for exactly that revision (`warmLookup`, ≤ 300 ms). A
 * valid entry already has `rev ≥ minRev`, so it is served as
 * `source: "warm"`, `verify: satisfied` with no data-cache read and no
 * revision read. Any other outcome (miss, invalid, timeout, error) falls
 * through to the path below unchanged. Periodic / catch-up / resume /
 * recheck requests carry no `hint` and never look.
 */
export async function getLiveSnapshot(
  eventId: bigint,
  locale: Locale,
  minRev: number | null = null,
  opts: { hint?: boolean } = {},
): Promise<LiveSnapshotResult> {
  if (minRev !== null && opts.hint && liveWarmEnabled()) {
    const warm = await warmLookup(eventId, locale, minRev);
    if (warm.result === "hit") {
      return { snapshot: warm.snapshot, source: "warm", verify: { kind: "satisfied" } };
    }
  }
  const idKey = eventId.toString();
  const key = `${idKey}:${locale}`;
  const { value: first } = await coalesce(
    inFlight,
    key,
    () => readThroughCache(() => cachedSnapshot(idKey, locale), "build"),
    logCoalesced("coalesced", eventId, locale),
  );
  if (minRev === null) return { ...first, verify: { kind: "none" } };
  if (first.snapshot.rev >= BigInt(minRev)) {
    return { ...first, verify: { kind: "satisfied" } };
  }

  const check = await verifiedRevision(eventId, minRev, opts.hint ?? false);
  const dbRev = check.rev;
  let served = first;
  if (dbRev !== null && dbRev > first.snapshot.rev) {
    revalidateEventData(eventId);
    const { value: repaired } = await coalesce(
      inFlightRepair,
      `${key}:${dbRev}`,
      () =>
        readThroughCache(
          () => cachedSnapshotAtRev(idKey, locale, dbRev.toString()),
          "repair",
        ),
      logCoalesced("coalesced-repair", eventId, locale),
    );
    // A repair entry that is itself older than the first read (cannot
    // happen with a monotonic counter, but cheap to guard) never wins.
    if (repaired.snapshot.rev >= first.snapshot.rev) served = repaired;
  }
  return {
    ...served,
    verify: classifyVerify(minRev, served.snapshot.rev, check, Date.now()),
  };
}

/**
 * Response-time view of a snapshot: status resolved NOW from the cached
 * raw fields (so the scheduled → ongoing boundary needs no write), and
 * `rev` as a JSON-safe number.
 */
export function resolveSnapshotForResponse(
  snapshot: EventSnapshot,
  now: Date = new Date(),
): {
  status: ResolvedEventStatus | null;
  startTime: string | null;
  rev: number;
  capturedAt: string;
} {
  const live =
    snapshot.found &&
    !snapshot.isDeleted &&
    snapshot.rawStatus !== null &&
    snapshot.startTime !== null;
  return {
    status: live
      ? getEventStatus(
          { status: snapshot.rawStatus!, startTime: snapshot.startTime! },
          now,
        )
      : null,
    startTime: live ? snapshot.startTime!.toISOString() : null,
    rev: revToNumber(snapshot.rev),
    capturedAt: snapshot.capturedAt.toISOString(),
  };
}
