import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { Prisma, type EventStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { fetchEventWishlistTop3 } from "@/lib/wishes/top3";
import { getEventStatus, type ResolvedEventStatus } from "@/lib/eventStatus";
import { cachedQuery, eventTag, revalidateEventData } from "@/lib/dataCache";
import { revToNumber } from "@/lib/liveBroadcast";
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

export type SnapshotSource = "build" | "cache" | "repair";

// Per-process id, so the build log lines can be grouped by instance
// when counting builds per save from Vercel logs.
const INSTANCE_ID = randomUUID().slice(0, 8);

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
 * Build one snapshot from the database. Uncached; exported for the
 * integration tests and wrapped by `getLiveSnapshot` for everything
 * else.
 */
export async function buildEventSnapshot(
  eventId: bigint,
  locale: Locale,
): Promise<EventSnapshot> {
  const started = Date.now();
  const localeFilter = { locale: { in: [locale, FALLBACK_LOCALE] } };

  const raw = await prisma.$transaction(
    async (tx) => {
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
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      // Reads only; a build that takes longer than this is a symptom
      // (pool starvation), and failing it lets the client retry
      // rather than pinning a pooler connection. `maxWait` above the
      // 2 s default because a burst of cold builds across locales can
      // briefly queue on the 5-connection pool.
      maxWait: 5_000,
      timeout: 10_000,
    },
  );

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
  return snapshot;
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

// Per-instance coalescing. A broadcast makes hundreds of clients fetch
// within the jitter window; the ones landing on the same warm lambda
// while a build is running share it instead of each opening a
// REPEATABLE READ transaction. Entries are removed when they settle.
const inFlight = new Map<string, Promise<SnapshotResult>>();
const inFlightRepair = new Map<string, Promise<SnapshotResult>>();
const inFlightRevRead = new Map<string, Promise<bigint | null>>();

function coalesce<T>(
  map: Map<string, Promise<T>>,
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  const existing = map.get(key);
  if (existing) return existing;
  const p = run().finally(() => {
    if (map.get(key) === p) map.delete(key);
  });
  map.set(key, p);
  return p;
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

/** Uncached, coalesced `SELECT "setlistRevision"` for the repair check. */
function readCurrentRevision(eventId: bigint): Promise<bigint | null> {
  return coalesce(inFlightRevRead, eventId.toString(), async () => {
    const rows = await prisma.$queryRaw<{ setlistRevision: bigint }[]>`
      SELECT "setlistRevision" FROM "Event" WHERE id = ${eventId}
    `;
    return rows.length > 0 ? BigInt(rows[0].setlistRevision) : null;
  });
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
 * The cached, coalesced snapshot read.
 *
 * Repair path (`minRev`): the client passes the highest revision it has
 * seen (from a broadcast or an earlier snapshot). When the cached
 * snapshot is older, ONE uncached 1-row revision read (coalesced per
 * instance) decides whether the cache is really behind the database:
 *   - DB revision > cached revision → expire the event tag (applies
 *     after this request) and serve a snapshot built now under a
 *     server-read-revision key (`source: "repair"`);
 *   - otherwise the client's hint is ahead of the database (forged, or
 *     from a rolled-back world) → serve the cache unchanged.
 * A forged `minRev` therefore costs at most one primary-key read per
 * instance per burst and can never trigger a build or mint a cache key.
 */
export async function getLiveSnapshot(
  eventId: bigint,
  locale: Locale,
  minRev: number | null = null,
): Promise<SnapshotResult> {
  const idKey = eventId.toString();
  const key = `${idKey}:${locale}`;
  const first = await coalesce(inFlight, key, () =>
    readThroughCache(() => cachedSnapshot(idKey, locale), "build"),
  );
  if (minRev === null || first.snapshot.rev >= BigInt(minRev)) return first;

  const dbRev = await readCurrentRevision(eventId);
  if (dbRev === null || dbRev <= first.snapshot.rev) return first;

  revalidateEventData(eventId);
  const repaired = await coalesce(inFlightRepair, `${key}:${dbRev}`, () =>
    readThroughCache(
      () => cachedSnapshotAtRev(idKey, locale, dbRev.toString()),
      "repair",
    ),
  );
  // A repair entry that is itself older than the first read (cannot
  // happen with a monotonic counter, but cheap to guard) never wins.
  return repaired.snapshot.rev >= first.snapshot.rev ? repaired : first;
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
