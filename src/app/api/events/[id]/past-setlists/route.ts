import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import {
  flattenSetlistToPredictions,
  type SetlistItemSlim,
} from "@/lib/copyPastSetlist";
import type { PredictionEntry } from "@/lib/predictionsStorage";

type RouteProps = { params: Promise<{ id: string }> };

/**
 * Cap on the number of past sibling events returned. 10 covers the
 * realistic ceiling: even an active tour series typically has ≤ 10
 * past dates by the time a user opens predictions for the next show,
 * and a long-running brand series (Animelo Summer Live's hierarchy)
 * is scoped to the direct `eventSeriesId` here — not parent traversal —
 * so it doesn't pile up either. Bumping this is cheap if a real
 * series eventually exceeds it; the trade-off is response size and
 * picker scroll length.
 */
const PAST_EVENTS_LIMIT = 10;

/**
 * `GET /api/events/[id]/past-setlists`
 *
 * Powers the "지난 공연 세트리스트로 예상 시드 채우기" affordance on
 * `<PredictedSetlist>`. Returns past sibling events (same
 * `eventSeriesId`, strictly before the current event's date) that
 * carry at least one `confirmed` song-type `SetlistItem`, along with
 * a pre-flattened/pre-deduped `PredictionEntry[]` per event so the
 * client can call `writePredictions` directly.
 *
 * The transform rules — first-song-of-medley only, variant → base,
 * songId dedup — live in `flattenSetlistToPredictions`. Keeping the
 * server as the single transform site means a future tweak to the
 * dedup contract doesn't have to ship to N clients.
 *
 * Empty results (no series; series exists but no confirmed-song
 * sibling) collapse to `{ ok: true, pastEvents: [] }` so the client
 * can render a single empty-state branch regardless of which
 * upstream condition was the cause.
 */
export async function GET(req: NextRequest, { params }: RouteProps) {
  const { id } = await params;

  let eventId: bigint;
  try {
    eventId = BigInt(id);
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_event_id" },
      { status: 400 },
    );
  }

  // Both Prisma calls fall back to `null` via a `.catch` so a
  // transient DB error (connection drop, Supabase pooler restart)
  // surfaces as a typed `{ ok: false, error: "db_error" }` 500
  // instead of an unformatted Next.js error page. The
  // `<CopyPastSetlistSheet>` client treats any `!res.ok` response as
  // `copy.fetchError`, but the typed code keeps server-side logs
  // greppable.
  //
  // `current` uses `undefined` as the db-error sentinel (since `null`
  // already means "not found"); the order of the next two checks
  // distinguishes them: db_error → 500, then event_not_found → 404.
  const current = await prisma.event
    .findFirst({
      where: { id: eventId, isDeleted: false },
      select: { id: true, date: true, eventSeriesId: true },
    })
    .catch((err: unknown) => {
      console.error("[past-setlists] event.findFirst failed", err);
      return undefined;
    });
  if (current === undefined) {
    return NextResponse.json(
      { ok: false, error: "db_error" },
      { status: 500 },
    );
  }
  if (current === null) {
    return NextResponse.json(
      { ok: false, error: "event_not_found" },
      { status: 404 },
    );
  }

  // No series → no siblings. Short-circuit before findMany to keep the
  // empty-state path cheap.
  if (current.eventSeriesId === null) {
    return NextResponse.json(
      { ok: true, pastEvents: [] },
      { headers: { "Cache-Control": "private, max-age=0, must-revalidate" } },
    );
  }

  // TBA current event (date === null): we still don't know the
  // ordering point, so there's no defensible "strictly before" filter
  // to apply. Treat as empty rather than silently widening to "any
  // sibling regardless of order" — which would let a future tour
  // bleed backwards into a TBA opener's seed.
  if (current.date === null) {
    return NextResponse.json(
      { ok: true, pastEvents: [] },
      { headers: { "Cache-Control": "private, max-age=0, must-revalidate" } },
    );
  }

  const siblings = await prisma.event
    .findMany({
    where: {
      eventSeriesId: current.eventSeriesId,
      isDeleted: false,
      id: { not: eventId },
      // Prisma Date columns are stored as UTC instants. `lt` is a
      // direct instant comparison — no server-local boundary games
      // (CLAUDE.md UTC hard rule).
      date: { lt: current.date },
      setlistItems: {
        some: { isDeleted: false, status: "confirmed", type: "song" },
      },
    },
    orderBy: { date: "desc" },
    take: PAST_EVENTS_LIMIT,
    select: {
      id: true,
      date: true,
      originalName: true,
      originalShortName: true,
      originalLanguage: true,
      originalVenue: true,
      translations: {
        select: { locale: true, name: true, shortName: true, venue: true },
      },
      setlistItems: {
        where: { isDeleted: false, status: "confirmed", type: "song" },
        orderBy: { position: "asc" },
        select: {
          position: true,
          // Pulling the full medley + base alongside the row keeps
          // this to a single round-trip. `take: 1` on `songs` would
          // shave bytes but the medley rule is enforced in the
          // flatten helper (which the unit tests cover), and a
          // single-source-of-truth rule beats a marginal byte saving.
          songs: {
            orderBy: { order: "asc" },
            select: {
              order: true,
              song: {
                select: {
                  id: true,
                  originalTitle: true,
                  originalLanguage: true,
                  variantLabel: true,
                  baseVersionId: true,
                  isDeleted: true,
                  translations: {
                    select: { locale: true, title: true, variantLabel: true },
                  },
                  // Self-relation defined at prisma/schema.prisma:736
                  // `baseVersion Song? @relation("SongVariants", ...)`.
                  baseVersion: {
                    select: {
                      id: true,
                      originalTitle: true,
                      originalLanguage: true,
                      variantLabel: true,
                      baseVersionId: true,
                      isDeleted: true,
                      translations: {
                        select: {
                          locale: true,
                          title: true,
                          variantLabel: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    })
    .catch((err: unknown) => {
      console.error("[past-setlists] event.findMany failed", err);
      return null;
    });
  if (siblings === null) {
    return NextResponse.json(
      { ok: false, error: "db_error" },
      { status: 500 },
    );
  }

  const pastEvents = siblings
    .map((ev) => {
      const songs: PredictionEntry[] = flattenSetlistToPredictions(
        ev.setlistItems as SetlistItemSlim[],
      );
      return {
        eventId: Number(ev.id),
        originalName: ev.originalName,
        originalShortName: ev.originalShortName,
        originalLanguage: ev.originalLanguage,
        originalVenue: ev.originalVenue,
        translations: ev.translations,
        date: ev.date ? ev.date.toISOString() : null,
        songCount: songs.length,
        songs,
      };
    })
    // A sibling whose every song was either soft-deleted or had a
    // broken base reference collapses to 0 songs after flatten. Hide
    // it — there's nothing to seed.
    .filter((e) => e.songCount > 0);

  return NextResponse.json(serializeBigInt({ ok: true, pastEvents }), {
    headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
  });
}
