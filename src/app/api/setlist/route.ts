import { NextRequest, NextResponse } from "next/server";
import {
  getLiveSnapshot,
  logSnapshotFailure,
  parseHint,
  parseMinRev,
  resolveSnapshotForResponse,
} from "@/lib/liveSnapshot";
import { INSTANCE_ID } from "@/lib/instanceId";
import {
  formatSnapshotVerify,
  SNAPSHOT_VERIFY_HEADER,
} from "@/lib/snapshotVerify";
import { locales, defaultLocale, type Locale } from "@/i18n/routing";

const SLOW_HIT_MS = 500;

/**
 * `[setlist] hint-fetch …` — exactly one line per request that carried
 * `?hint=1`, so the load harness can count hint outcomes (satisfied /
 * fresh / memo / deferred) per save from the Vercel logs. `verify` is
 * the `x-snapshot-verify` kind (without its `=…` detail), or `error`
 * for a 503 — that response carries no header, but the request still
 * happened and must be counted. `minRev=none` when absent/invalid.
 */
function logHintFetch(
  eventId: bigint,
  locale: Locale,
  minRev: number | null,
  verify: string,
): void {
  console.log(
    `[setlist] hint-fetch event=${eventId} locale=${locale} ` +
      `minRev=${minRev ?? "none"} verify=${verify} instance=${INSTANCE_ID}`,
  );
}

/**
 * 503 for a snapshot that could not be built (pool / pooler exhausted,
 * build timeout, any database error on the build or repair path).
 *
 * `Retry-After` is a random 1–3 s: every client of a burst failed at
 * about the same moment, and a fixed value would send them all back in
 * the same instant to repeat the overload. By the time they return the
 * first successful build has usually filled the data cache, so the
 * retry is a cache hit. `no-store` so no intermediary keeps the error.
 *
 * Deliberately NOT a "last good snapshot" fallback (yet). Serving an
 * older snapshot with 200 needs per-instance memory of the last good
 * value, and to be honest it must carry that value's own `rev` /
 * `capturedAt` (never a fresh `servedAt`-like stamp), a degraded flag
 * the client can see, and a scheduled refresh — otherwise a 200 would
 * hide a failed update and the client would stop asking for the
 * revision it was told about. That is a larger change; an explicit 503
 * keeps the client's retry logic in charge meanwhile.
 */
function snapshotUnavailable(): NextResponse {
  const retryAfterSeconds = 1 + Math.floor(Math.random() * 3);
  return NextResponse.json(
    { error: "snapshot_unavailable" },
    {
      status: 503,
      headers: {
        "Retry-After": String(retryAfterSeconds),
        "Cache-Control": "no-store",
        "x-snapshot-source": "error",
      },
    },
  );
}

/**
 * GET /api/setlist?eventId=<id>&locale=<ko|ja|en>[&minRev=<n>][&hint=1]
 *
 * The live event page's snapshot: setlist items, reaction counts, the
 * wish TOP-3 and the event status, all from ONE consistent database
 * snapshot (see `src/lib/liveSnapshot.ts`), served from a 2 s data
 * cache that every setlist writer expires after commit.
 *
 *   → 200 {
 *       items, reactionCounts, top3Wishes,   // unchanged shapes
 *       status,       // resolved at response time from the cached raw
 *                     // status + startTime; null when the event is
 *                     // missing or soft-deleted
 *       startTime,    // ISO | null
 *       rev,          // Event.setlistRevision of the snapshot (number)
 *       capturedAt,   // ISO, Postgres now() of the snapshot transaction
 *       servedAt,     // ISO, response time — never a freshness signal
 *       updatedAt,    // = servedAt; kept for v0.18.x clients, which
 *                     // read it into `lastUpdated`
 *     }
 *
 *   → 503 { error: "snapshot_unavailable" }, Retry-After: 1..3,
 *         Cache-Control: no-store — the snapshot could not be built
 *         (see `snapshotUnavailable`)
 *
 * Clients order snapshots by `(rev, capturedAt)`; `?minRev=` asks the
 * server to repair a cache entry older than a revision the client has
 * already seen (bounded — see `getLiveSnapshot`).
 *
 * `Cache-Control: public, max-age=0, must-revalidate`: no browser or
 * CDN reuse in R1 (CDN caching is a later, measured experiment); the
 * data cache behind this route does the deduplication.
 * `x-snapshot-source: build | cache | repair | error` is diagnostics
 * only.
 *
 * `x-snapshot-verify: none | satisfied | fresh=<dbRev> |
 * memo=<rev>;age=<ms> | deferred` (200 only) tells the client how its
 * `minRev` was resolved — see `src/lib/snapshotVerify.ts` for the
 * grammar and what each value proves.
 *
 * `?hint=1` marks a notification fetch (sent because a broadcast hint
 * arrived). It is accepted and logged (`[setlist] hint-fetch`, and
 * `hint=` on the revision-read line) and changes nothing else, so old
 * clients that never send it and new clients against an older server
 * both keep working.
 */
export async function GET(req: NextRequest) {
  const started = Date.now();
  // `new URL(req.url)` over `req.nextUrl` so unit tests can invoke
  // the handler with a plain `Request`. Mirrors the wishes route.
  const url = new URL(req.url);
  const eventIdParam = url.searchParams.get("eventId");
  if (!eventIdParam) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }
  // Locale is normalized to one of the supported values from
  // `src/i18n/routing.ts`; the hooks always pass `?locale=`, the
  // default-on-miss covers direct curls. It trims every nested
  // translation join to `[locale, FALLBACK_LOCALE]` and is part of the
  // cache key, so an unknown value must never reach it.
  const localeParam = url.searchParams.get("locale");
  const locale: Locale = locales.includes(localeParam as Locale)
    ? (localeParam as Locale)
    : defaultLocale;

  let eventId: bigint;
  try {
    eventId = BigInt(eventIdParam);
  } catch {
    return NextResponse.json({ error: "invalid eventId" }, { status: 400 });
  }

  const minRev = parseMinRev(url.searchParams.get("minRev"));
  const hint = parseHint(url.searchParams.get("hint"));
  let result: Awaited<ReturnType<typeof getLiveSnapshot>>;
  try {
    result = await getLiveSnapshot(eventId, locale, minRev, { hint });
  } catch (err) {
    logSnapshotFailure(eventId, locale, Date.now() - started, err);
    if (hint) logHintFetch(eventId, locale, minRev, "error");
    return snapshotUnavailable();
  }
  const { snapshot, source, verify } = result;
  const resolved = resolveSnapshotForResponse(snapshot);
  const servedAt = new Date().toISOString();

  // Instrumentation for one open question: is a response that is served
  // from the cache (the stale value of a stale-while-revalidate entry)
  // held until the background rebuild it triggered finishes, instead
  // of returning at once? A cache hit by itself is a data-cache read and
  // should take a few ms; anything over 500 ms end to end in this
  // handler is logged so the load test can correlate it with build
  // lines on the same instance. A hinted request whose revision read
  // could not verify also ends as a slow "cache" response; those pair
  // with a `[liveSnapshot] rev-read … rev=timeout` line on the same
  // instance. Measurement only — no behaviour depends on it.
  const ms = Date.now() - started;
  if (source === "cache" && ms > SLOW_HIT_MS) {
    console.log(
      `[setlist] slow-hit ms=${ms} event=${eventId} locale=${locale} ` +
        `instance=${INSTANCE_ID}`,
    );
  }
  if (hint) logHintFetch(eventId, locale, minRev, verify.kind);

  return NextResponse.json(
    {
      items: snapshot.items,
      reactionCounts: snapshot.reactionCounts,
      top3Wishes: snapshot.top3Wishes,
      status: resolved.status,
      startTime: resolved.startTime,
      rev: resolved.rev,
      capturedAt: resolved.capturedAt,
      servedAt,
      updatedAt: servedAt,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=0, must-revalidate",
        "x-snapshot-source": source,
        // Verification is a HEADER, never a body field, on purpose. The
        // body is the shared snapshot: one data-cache entry per
        // (event, locale), built once and handed to every request on
        // every instance (and, if CDN caching is ever enabled for this
        // route, potentially to other viewers too). The verification
        // result is not a property of that snapshot — it depends on
        // this request's `minRev`, on whether this request started or
        // merely joined the revision read, and on the instance's memo
        // at this moment. Stored in the body it would leak one
        // request's evidence (e.g. `fresh=…`) into another request's
        // answer, where it would be false. `Cache-Control` is left
        // unchanged: nothing reuses responses today, and the URL
        // carries `minRev`, so a future CDN experiment must revisit this
        // header (a cached `fresh` would turn into stale evidence)
        // before turning reuse on.
        [SNAPSHOT_VERIFY_HEADER]: formatSnapshotVerify(verify),
      },
    },
  );
}
