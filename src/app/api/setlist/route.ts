import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { fetchEventWishlistTop3 } from "@/lib/wishes/top3";
import { getEventStatus } from "@/lib/eventStatus";

export async function GET(req: NextRequest) {
  // `new URL(req.url)` over `req.nextUrl` so unit tests can invoke
  // the handler with a plain `Request`. Mirrors the wishes route.
  const url = new URL(req.url);
  const eventIdParam = url.searchParams.get("eventId");
  if (!eventIdParam) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }
  // Locale is optional — when absent, the wishlist top-3 song
  // payload returns every translation. Existing callers that don't
  // pass `?locale=` keep working byte-identically; the polling hook
  // (useSetlistPolling) threads the active locale through so the
  // payload stays as small as the per-page event query.
  const locale = url.searchParams.get("locale");

  let eventId: bigint;
  try {
    eventId = BigInt(eventIdParam);
  } catch {
    return NextResponse.json({ error: "invalid eventId" }, { status: 400 });
  }

  const [items, reactionGroups, top3Wishes] = await Promise.all([
    prisma.setlistItem.findMany({
      where: { eventId, isDeleted: false },
      orderBy: { position: "asc" },
      omit: { note: true },
      include: {
        // Per-item Confirm count. Drives:
        //   1. The visual count rendered next to the ✓ button on
        //      rumoured rows (existing PR #283 UX, currently
        //      derives the count from a separate path on the
        //      client; this surface unifies it).
        //   2. The conflict-handling sort order — sibling rumoured
        //      rows at the same position render top-down by
        //      confirmCount DESC, createdAt ASC. See
        //      `<ActualSetlist>` position-bucketing logic.
        //   3. The N-confirm-tap promotion threshold check in
        //      `/api/setlist-items/[id]/confirm` (server reads from
        //      DB; client uses the polled count for the sort key).
        _count: { select: { confirms: true } },
        // Event status + startTime folded onto each row so the polled
        // `status` field doesn't need its own slot in this route's
        // Promise.all. Pre-fold, the route fanned out to 4 concurrent
        // connections and Sentry trace
        // 9dc342f6b276465c8ebbb1964ac8ae70 caught the cheapest query
        // — a 3-column Event.findFirst PK lookup — queueing ~1.08 s
        // for a connection slot under the prior `max: 3` cap.
        // PR #431 raised the cap to 5; this fold drops the
        // steady-state fan-out from 4 → 3 so a future +1 awaited
        // query doesn't silently re-introduce the queue wait.
        //
        // Same value across every row (Prisma materializes via a
        // LATERAL join on the same parent event), stripped before
        // serialization below so the wire shape is byte-identical.
        // Empty-items fallback handled after the Promise.all —
        // scheduled-but-empty events still need the authoritative
        // status so the wishlist/predicted-setlist editors lock at
        // startTime regardless of client clock skew (the original
        // motivation for surfacing status here at all; see v0.10.0
        // smoke note below).
        event: { select: { status: true, startTime: true } },
        songs: {
          include: {
            song: {
              include: {
                translations: true,
                artists: {
                  include: {
                    artist: { include: { translations: true } },
                  },
                },
              },
            },
          },
          orderBy: { order: "asc" },
        },
        performers: {
          include: {
            stageIdentity: {
              include: {
                translations: true,
                // Required by the sidebar's per-unit member sublist
                // re-derivation in `LiveEventLayout`. Without this,
                // a polled setlist that introduces a new performer
                // would render with no unit affiliation in the
                // `<UnitsCard>` member list. Mirrors the include
                // shape on the page-level event query
                // (`page.tsx:88-98`).
                artistLinks: { select: { artistId: true } },
              },
            },
            realPerson: { include: { translations: true } },
          },
        },
        artists: {
          include: {
            artist: { include: { translations: true } },
          },
        },
      },
    }),
    prisma.setlistItemReaction.groupBy({
      by: ["setlistItemId", "reactionType"],
      where: { setlistItem: { eventId, isDeleted: false } },
      _count: true,
    }),
    // Wishlist fan TOP-3 — shared loader in src/lib/wishes/top3.ts so
    // the polled `/api/setlist` channel and the standalone GET on
    // `/api/events/[id]/wishes` always return identical shapes. Two
    // round-trips internally (groupBy + findMany) but they're
    // sequential against the DB; from this Promise.all's point of
    // view it's a single awaited slot.
    fetchEventWishlistTop3(eventId, locale),
  ]);

  const reactionCounts: Record<string, Record<string, number>> = {};
  for (const g of reactionGroups) {
    const key = g.setlistItemId.toString();
    if (!reactionCounts[key]) reactionCounts[key] = {};
    reactionCounts[key][g.reactionType] = g._count;
  }

  // Event status + startTime are needed so the client can lock the
  // wishlist + predicted-setlist editors when the server's
  // authoritative clock crosses startTime, even if the client's
  // local clock is skewed (e.g. a user with a slow device clock
  // would see the editor remain open past startTime because their
  // `Date.now() < startMs`; the polled status overrides the client
  // wall-clock check). v0.10.0 smoke caught the symptom + the
  // operator confirmed clock-skew is the realistic bypass at this
  // scale (manipulating localStorage requires understanding the
  // format; changing device time is trivial).
  //
  // Sourced from the first setlistItem's `event` LATERAL include
  // above (every row carries the same parent's status/startTime).
  // The fallback below runs only when the event has zero non-
  // deleted setlist items — a scheduled-but-empty event polled by a
  // client watching for the first item to appear, or an event whose
  // items have all been soft-deleted. Sequential not parallel so it
  // doesn't reintroduce the pool contention this fold removes.
  // `items.length > 0` branch over `items[0]?.event ?? findFirst()` —
  // the project's tsconfig doesn't enable `noUncheckedIndexedAccess`,
  // so TS types `items[0]` as non-undefined and would either reject
  // the `??` fallback's nullable result or collapse the union back to
  // non-null. The explicit length check matches both the runtime
  // intent and the type system without an annotation crutch.
  const event =
    items.length > 0
      ? items[0].event
      : await prisma.event.findFirst({
          where: { id: eventId, isDeleted: false },
          select: { status: true, startTime: true },
        });
  // Resolve status server-side via the same `getEventStatus`
  // helper the page uses at SSR. `null` when the event was missing
  // or soft-deleted — clients treat null as "no fresh status; keep
  // the SSR-initial value" (see `<LiveEventLayout>`).
  const status = event ? getEventStatus(event) : null;

  // Flatten Prisma's `_count: { confirms }` → top-level
  // `confirmCount` so the LiveSetlistItem type stays a flat shape
  // (and the client doesn't have to know about Prisma's `_count`
  // convention). Done BEFORE serializeBigInt so the recursive walk
  // sees the renamed property; serializeBigInt only cares about
  // BigInt values and passes the rest through unchanged. The
  // `event` field (populated by the LATERAL include for the status
  // derivation above) is dropped here so the wire shape stays
  // byte-identical to the pre-fold response — shipping 25 copies
  // of the same parent's status/startTime to the client would be
  // pure bloat.
  const itemsWithConfirmCount = items.map(({ _count, event: _event, ...rest }) => ({
    ...rest,
    confirmCount: _count.confirms,
  }));

  return NextResponse.json(
    {
      items: serializeBigInt(itemsWithConfirmCount),
      reactionCounts,
      top3Wishes,
      status,
      updatedAt: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}
