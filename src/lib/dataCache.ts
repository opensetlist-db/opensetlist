import { createHash } from "node:crypto";
import { revalidateTag, unstable_cache } from "next/cache";
import { getCache, waitUntil, type RuntimeCache } from "@vercel/functions";
import { INSTANCE_ID } from "@/lib/instanceId";

/**
 * Cross-request data cache for public SSR reads.
 *
 * Why this exists: every `[locale]` page is a dynamic route (most read
 * `searchParams` for tabs/pagination), Next forces `Cache-Control:
 * private, no-cache, no-store` on dynamic routes, and each render runs
 * a wide Prisma `relationJoins` query. Supabase meters egress on the
 * uncompressed pooler wire, so every crawler hit used to cost one
 * 50–500 KB read — the September 2026 recrawl after the sitemap/308
 * change burned the whole Free-tier quota with zero users. Caching the
 * DB *results* in the Next data cache (Vercel Data Cache in prod)
 * means Postgres answers once per TTL per key, regardless of how many
 * bots or fans render the page.
 *
 * `react.cache` (per-request dedup between `generateMetadata` and the
 * page body) and this (cross-request) are complementary — callers keep
 * both: `cache(cachedQuery(...))` or a `cache()` wrapper that calls a
 * cached query inside.
 *
 * Mechanism: `unstable_cache`, not `'use cache'`. The directive needs
 * the build-wide `cacheComponents` flag, which changes prerender
 * semantics for every route — out of proportion for a data-layer fix.
 */

// TTLs in seconds, per entity kind. Kept in one table so the trade-off
// (freshness vs. pooler egress) is visible in one place.
export const CACHE_TTL = {
  // Event detail: short, because "upcoming" pages tick toward a show
  // and operators fill setlists right after it. While a show is
  // ongoing the event fetch bypasses the cache entirely (see the event
  // page), so this only governs scheduled/completed events.
  event: 60,
  // The narrow status/startTime read that decides whether the event
  // detail fetch may use the cache at all.
  eventStatus: 30,
  // Catalog-shaped entities (songs, artists, albums, members, series):
  // they change when an operator edits them, and admin writes expire
  // the cache explicitly — the TTL is only the backstop for edits that
  // reach the DB some other way (scripts, CSV import, Supabase UI).
  entity: 3600,
  // Home lists: the most-hit route (uptime probe + every bot's entry
  // point), but it also has to notice a show starting. Five minutes,
  // keyed on a 5-minute `now` bucket (see `timeBucket`).
  home: 300,
  sitemap: 3600,
  // Fan board aggregate (n15). Fan writes never invalidate it (they
  // must not touch any cache the live path shares), so the TTL alone
  // bounds staleness — ~2 minutes is the promised "as of" lag, and a
  // promo spike costs one aggregation per key per window.
  board: 120,
} as const;

/**
 * Every cached public read carries this tag, so a single
 * `revalidatePublicData()` from an admin write expires all of them.
 *
 * Coarse on purpose: the public pages denormalize heavily (an artist
 * rename shows up on song, event, series, album and home pages; a
 * setlist edit changes song performance histories and member pages),
 * so per-entity tags would need a dependency map that silently rots.
 * Admin writes are rare and operator-initiated; the cost of a full
 * expiry is one re-read per page that is actually visited afterwards.
 * The exception is setlist editing during a live show, which is
 * frequent — those routes expire only the event's own tag (see
 * `revalidateEventData`), and the event page bypasses the cache while
 * ongoing anyway.
 */
export const PUBLIC_DATA_TAG = "public-data";

export function eventTag(eventId: bigint | number | string): string {
  return `event:${eventId.toString()}`;
}

/**
 * Narrower tag for an event's cached impressions page (n14). Impression
 * posts/edits/reports are fan-driven and can be frequent during a show;
 * expiring the whole `event:<id>` tag on each one would also throw away
 * the live setlist snapshot (`src/lib/liveSnapshot.ts`) and force a
 * rebuild per post. The impressions entry carries BOTH tags, so setlist
 * writes and public purges still expire it, while impression writes
 * expire only this one. (Tags are exact strings — no prefix matching —
 * so `event:1:impressions` never matches `event:1`.)
 */
export function eventImpressionsTag(eventId: bigint | number | string): string {
  return `event:${eventId.toString()}:impressions`;
}

/**
 * Own tag for the fan board aggregate (n15). Deliberately NOT
 * `eventTag(id)`: board entries must not be expired by — or expire —
 * the event/live entries. Nothing calls a revalidate helper for it
 * today (board writes are TTL-only); it exists so an operator purge can
 * target the board alone if one is ever needed.
 */
export function eventBoardTag(eventId: bigint | number | string): string {
  return `event:${eventId.toString()}:board`;
}

// Deployment discriminator for cache keys. The Vercel Data Cache
// outlives deployments, and `unstable_cache` keys on our wrapper
// closure's source (identical for every query) + keyParts + args — not
// on the query's include tree. Without this, a deploy that changes a
// fetcher's result shape would keep serving the previous shape to the
// new code until the TTL ran out. `VERCEL_DEPLOYMENT_ID` is set at
// runtime on Vercel; the commit SHA is the fallback for other hosts;
// "local" covers dev, where a restart is the deploy boundary anyway.
export const BUILD_KEY =
  process.env.VERCEL_DEPLOYMENT_ID ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  "local";

// ---------------------------------------------------------------------
// Lossless JSON codec
//
// The data cache stores results with `JSON.stringify`. Raw Prisma rows
// carry `bigint` ids (which `JSON.stringify` throws on) and `Date`
// columns (which silently become strings). Some fetchers already
// flatten their result with `serializeBigInt`; others (series, member
// helpers) deliberately return raw BigInt rows so ids survive exactly.
// Rather than changing every consumer's types to the post-JSON shape,
// the cache boundary tags bigint/Date values on the way in and revives
// them on the way out, so a cached call returns exactly what the
// uncached call would have — same types, same runtime values.
//
// The marker keys can't collide with Prisma model fields (no column
// name starts with `__$`). A `Json` column containing a literal
// `{"__$bigint": "…"}` object would be revived as a bigint — no
// public fetcher reads Json columns today.
// ---------------------------------------------------------------------

const BIGINT_MARK = "__$bigint";
const DATE_MARK = "__$date";

export function encodeCacheValue(value: unknown): string {
  return JSON.stringify(value, function (this: Record<string, unknown>, key, v) {
    // `this[key]` is the value BEFORE `toJSON` ran — the only way to
    // see a Date as a Date inside a replacer (`v` is already the ISO
    // string by the time we're called).
    const raw = this[key];
    if (typeof raw === "bigint") return { [BIGINT_MARK]: raw.toString() };
    if (raw instanceof Date) {
      // An invalid Date has no ISO form; `JSON.stringify` would emit
      // null for it, so do the same rather than throwing.
      return Number.isNaN(raw.getTime()) ? null : { [DATE_MARK]: raw.toISOString() };
    }
    return v;
  });
}

export function decodeCacheValue<T>(text: string): T {
  return JSON.parse(text, (_key, v) => {
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length === 1) {
        if (keys[0] === BIGINT_MARK) return BigInt(v[BIGINT_MARK]);
        if (keys[0] === DATE_MARK) return new Date(v[DATE_MARK]);
      }
    }
    return v;
  }) as T;
}

type CacheKeyArg = string | number | bigint | boolean | null;

type CachedQueryOptions<A extends CacheKeyArg[]> = {
  revalidate: number;
  // Extra tags beyond PUBLIC_DATA_TAG, computed from the call's args
  // (e.g. `eventTag(id)`).
  tags?: (...args: A) => string[];
};

/**
 * Wrap an async DB read in the cross-request data cache.
 *
 * `name` must be unique across all `cachedQuery` call sites: it is the
 * key prefix, and the wrapper closure's source text (which
 * `unstable_cache` also folds into the key) is identical for every
 * query, so two call sites sharing a name would read each other's
 * entries.
 *
 * Arguments are restricted to primitives so the key is exactly the
 * argument list — no object identity, no `Date` (round a timestamp to
 * a bucket with `timeBucket` and pass the number instead, otherwise
 * every request is a new key and nothing is ever a hit).
 */
export function cachedQuery<A extends CacheKeyArg[], R>(
  name: string,
  fn: (...args: A) => Promise<R>,
  options: CachedQueryOptions<A>,
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    const keyParts = [
      name,
      BUILD_KEY,
      ...args.map((a) => (a === null ? "null" : a.toString())),
    ];
    const tags = [PUBLIC_DATA_TAG, ...(options.tags?.(...args) ?? [])];
    const text = await unstable_cache(
      async () => encodeCacheValue(await fn(...args)),
      keyParts,
      { revalidate: options.revalidate, tags },
    )();
    return decodeCacheValue<R>(text);
  };
}

/**
 * Id lists as cache-key arguments. `cachedQuery` only takes primitive
 * args, but some reads are parameterized by a derived id set (the song
 * ids on an album, the completed events of a series). The set must be
 * part of the key — two calls with different sets can't share an
 * entry — so it travels as a comma-joined string and is split back
 * inside the cached function.
 */
export function joinIdKey(ids: readonly (bigint | number | string)[]): string {
  return ids.map(String).join(",");
}

export function splitIdKey(key: string): bigint[] {
  return key === "" ? [] : key.split(",").map((id) => BigInt(id));
}

/**
 * Round `now` down to a `seconds`-wide bucket, in epoch ms. Used as a
 * cache-key argument for "relative to now" queries (home page lists):
 * the bucket start is a stable key for the whole window, and the
 * fetcher reconstructs `new Date(bucket)` as its reference time.
 * Epoch arithmetic is timezone-free, so this is UTC by construction.
 */
export function timeBucket(now: Date, seconds: number): number {
  const width = seconds * 1000;
  return Math.floor(now.getTime() / width) * width;
}

// `{ expire: 0 }` = expire immediately, so the very next request after
// an admin write re-reads the DB. The `"max"` profile Next recommends
// is stale-while-revalidate: the first visitor after the edit would
// still see the old page, which is exactly what an operator checking
// their edit doesn't want. (`updateTag` has the immediate semantics
// but only works inside Server Actions; these are Route Handlers.)
const EXPIRE_NOW = { expire: 0 };

function expireTags(tags: string[]): void {
  for (const tag of tags) {
    try {
      revalidateTag(tag, EXPIRE_NOW);
    } catch (err) {
      // Never fail an admin write that already committed because the
      // cache couldn't be told about it — worst case the public page
      // is stale for one TTL. Throws outside a Next request scope
      // (unit tests, scripts).
      console.error(`[dataCache] revalidateTag(${tag}) failed`, err);
    }
  }
}

// ---------------------------------------------------------------------
// Runtime Cache handle for the live snapshot's warm entries
//
// The flagged writer-warming path (`src/lib/liveWarm.ts`) stores
// revision-keyed live snapshots in Vercel's Runtime Cache — a different
// store from the Next data cache above, with its own tag space. The
// handle lives HERE rather than in `liveWarm.ts` so that
// `revalidatePublicData` can expire warm entries without this module
// importing `liveWarm.ts` (which imports this module for the codec — a
// cycle otherwise).
//
// Namespace: versioned, so a change of the stored envelope's shape can
// move to `-v2` and never read a `-v1` entry. Key hash: the SDK default
// is a 32-bit djb2-style hash; with keys minted per (event, locale,
// revision) a collision would hand one event's snapshot to another
// event's reader (the envelope check would reject it, but it would
// still turn a hit into a miss), so a SHA-256 hex digest is used.
// ---------------------------------------------------------------------

export const WARM_CACHE_NAMESPACE = "n14-snap-v1";

/** Tag on every warm entry; expired by `revalidatePublicData`. */
export const WARM_PUBLIC_DATA_TAG = "warm-public-data";

/** Per-event tag on warm entries (no caller expires it today). */
export function warmEventTag(eventId: bigint | number | string): string {
  return `warm-event-${eventId.toString()}`;
}

function sha256Hex(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * The Runtime Cache client for warm entries. `getCache` is cheap (it
 * resolves the backing store lazily, per call), so no memoisation.
 * Backing store: the Vercel request context's cache on Vercel, else the
 * `RUNTIME_CACHE_ENDPOINT` HTTP client, else a per-process in-memory
 * fallback (local dev, tests) — see `src/lib/liveWarm.ts`.
 */
export function warmEntryCache(): RuntimeCache {
  return getCache({ namespace: WARM_CACHE_NAMESPACE, keyHashFunction: sha256Hex });
}

/**
 * Expire every warm live-snapshot entry. Best-effort and asynchronous:
 * the Runtime Cache call is a network round trip that must not delay or
 * fail the admin write that already committed, so it is started here,
 * handed to `waitUntil` (keeps the Vercel function alive until it
 * settles; a no-op off Vercel, where the promise simply runs) and every
 * error is logged, never thrown.
 *
 * Why at all: a warm entry is keyed by setlist revision, and a catalog
 * edit (song title, artist name, …) changes what a snapshot renders
 * WITHOUT bumping any event's revision — so an entry built before the
 * edit would keep serving the old name to every notification fetch
 * that still asks for that revision (late jitter, retries) for up to
 * its 90 s TTL. A warm job that was already building when this runs
 * can still store a pre-edit snapshot after the expiry (late fill);
 * that window is accepted.
 *
 * Logged as two lines with explicit server-clock timestamps:
 *   [dataCache] expire-warm phase=start at=<ms> instance=<id>
 *   [dataCache] expire-warm phase=done ok=<bool> ms=<n> at=<ms> instance=<id>
 * `start` is right before the `expireTag` call (the catalog write has
 * committed by then — this runs after it), `done` when its promise
 * settled. The overlap drills place a catalog edit between a warm job's
 * capture and its `set` from these (the late-fill race above); Vercel's
 * history-mode logs stamp a request's lines with the request START, so
 * the line's own timestamp cannot tell when the expiry actually ran.
 */
function expireWarmPublicData(): void {
  const startedAt = Date.now();
  console.log(`[dataCache] expire-warm phase=start at=${startedAt} instance=${INSTANCE_ID}`);
  const settled = (ok: boolean) => {
    const at = Date.now();
    console.log(
      `[dataCache] expire-warm phase=done ok=${ok} ms=${at - startedAt} at=${at} ` +
        `instance=${INSTANCE_ID}`,
    );
  };
  const fail = (err: unknown) =>
    console.error(`[dataCache] expireTag(${WARM_PUBLIC_DATA_TAG}) failed`, err);
  let pending: Promise<void>;
  try {
    pending = warmEntryCache()
      .expireTag(WARM_PUBLIC_DATA_TAG)
      .then(
        () => settled(true),
        (err: unknown) => {
          fail(err);
          settled(false);
        },
      );
  } catch (err) {
    fail(err);
    settled(false);
    return;
  }
  try {
    waitUntil(pending);
  } catch (err) {
    fail(err);
  }
}

/**
 * Expire every cached public read — the Next data cache entries and the
 * live path's warm Runtime Cache entries. Call after a committed admin
 * write.
 */
export function revalidatePublicData(): void {
  expireTags([PUBLIC_DATA_TAG]);
  expireWarmPublicData();
}

/**
 * Expire only one event's cached reads. For setlist-item edits, which
 * happen many times per show: expiring everything on each one would
 * throw away the whole cache repeatedly during exactly the
 * high-traffic window the cache exists for. Other pages that list the
 * event's songs (song histories, member pages) catch up within one
 * entity TTL.
 */
export function revalidateEventData(eventId: bigint | number | string): void {
  expireTags([eventTag(eventId)]);
}

/** Expire only an event's cached impressions page (see `eventImpressionsTag`). */
export function revalidateEventImpressions(eventId: bigint | number | string): void {
  expireTags([eventImpressionsTag(eventId)]);
}
