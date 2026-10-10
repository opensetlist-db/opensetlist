import { NextRequest, NextResponse } from "next/server";
import {
  getLiveSnapshot,
  parseMinRev,
  resolveSnapshotForResponse,
} from "@/lib/liveSnapshot";
import { locales, defaultLocale, type Locale } from "@/i18n/routing";

/**
 * GET /api/setlist?eventId=<id>&locale=<ko|ja|en>[&minRev=<n>]
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
 * Clients order snapshots by `(rev, capturedAt)`; `?minRev=` asks the
 * server to repair a cache entry older than a revision the client has
 * already seen (bounded — see `getLiveSnapshot`).
 *
 * `Cache-Control: public, max-age=0, must-revalidate`: no browser or
 * CDN reuse in R1 (CDN caching is a later, measured experiment); the
 * data cache behind this route does the deduplication.
 * `x-snapshot-source: build | cache | repair` is diagnostics only.
 */
export async function GET(req: NextRequest) {
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
  const { snapshot, source } = await getLiveSnapshot(eventId, locale, minRev);
  const resolved = resolveSnapshotForResponse(snapshot);
  const servedAt = new Date().toISOString();

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
      },
    },
  );
}
