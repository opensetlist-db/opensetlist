import { revalidateTag, unstable_cache } from "next/cache";

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

// Deployment discriminator for cache keys. The Vercel Data Cache
// outlives deployments, and `unstable_cache` keys on our wrapper
// closure's source (identical for every query) + keyParts + args — not
// on the query's include tree. Without this, a deploy that changes a
// fetcher's result shape would keep serving the previous shape to the
// new code until the TTL ran out. `VERCEL_DEPLOYMENT_ID` is set at
// runtime on Vercel; the commit SHA is the fallback for other hosts;
// "local" covers dev, where a restart is the deploy boundary anyway.
const BUILD_KEY =
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

/** Expire every cached public read. Call after a committed admin write. */
export function revalidatePublicData(): void {
  expireTags([PUBLIC_DATA_TAG]);
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
