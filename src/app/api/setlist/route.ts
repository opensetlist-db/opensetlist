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
  // Locale is normalized to one of the supported values and defaults
  // to "ko" (mirroring src/i18n/routing.ts). The polling hook and
  // realtime fetchSnapshot both always pass `?locale=`; the default
  // is defensive coverage for unauthenticated tooling / direct curls.
  //
  // The normalized locale drives both:
  //   1. `fetchEventWishlistTop3` — already locale-aware.
  //   2. The `{ in: [locale, "ja"] }` filter on every nested
  //      `translations` include below. The `"ja"` fallback row is
  //      load-bearing because `src/lib/display.ts` (displayOriginalName,
  //      resolveOriginalShortLabel) falls through to the
  //      `originalLanguage` row when the parent's `originalName`/
  //      `originalShortName` is null. All Phase 1 IPs are JP-origin,
  //      so `"ja"` is the universal fallback. Mirrors the SSR event-
  //      page filter at `src/app/[locale]/events/[id]/[[...slug]]/
  //      page.tsx:60`. When locale === "ja", Postgres dedupes the IN
  //      list and returns 1 row; for ko/en, 2 rows ship.
  const SUPPORTED_LOCALES = ["ko", "ja", "en"] as const;
  type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
  const localeParam = url.searchParams.get("locale");
  const locale: SupportedLocale = SUPPORTED_LOCALES.includes(
    localeParam as SupportedLocale,
  )
    ? (localeParam as SupportedLocale)
    : "ko";
  const localeFilter = { locale: { in: [locale, "ja"] } };

  let eventId: bigint;
  try {
    eventId = BigInt(eventIdParam);
  } catch {
    return NextResponse.json({ error: "invalid eventId" }, { status: 400 });
  }

  const [items, reactionGroups, top3Wishes] = await Promise.all([
    // Explicit `select` (not `include`) to control egress on the
    // Postgres → Vercel pooler wire. Supabase meters this hop
    // uncompressed; the wholesale include shape was 207 KB / call
    // (eventId=1, 39 SetlistItems), dominated by 3-locale translation
    // floods + junction-table primary keys + admin-only scalars. F24
    // narrows to ~30-38 KB / call by listing exactly the fields the
    // event-page reads. Every field below is grep-verified against
    // event-page render code; see plan file for the audit table.
    prisma.setlistItem.findMany({
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
        // Per-item Confirm count. Drives:
        //   1. The visual count rendered next to the ✓ button on
        //      rumoured rows.
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
        //
        // `isDeleted` is included alongside status/startTime so the
        // read site can preserve the original
        // `findFirst({ isDeleted: false })` semantics — a soft-
        // deleted parent (rare: admin removed an event mid-poll)
        // must resolve to `status: null` regardless of whether its
        // non-deleted children are still around. Without this guard
        // the polled status would flip from null → a stale value the
        // instant we stopped issuing the standalone findFirst.
        event: {
          select: { status: true, startTime: true, isDeleted: true },
        },
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
                  select: {
                    locale: true,
                    title: true,
                    variantLabel: true,
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
                          select: {
                            locale: true,
                            name: true,
                            shortName: true,
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
                  select: {
                    locale: true,
                    name: true,
                    shortName: true,
                  },
                },
                // Required by the sidebar's per-unit member sublist
                // re-derivation in `LiveEventLayout` /
                // `src/lib/sidebarDerivations.ts:133`. Without this,
                // a polled setlist that introduces a new performer
                // would render with no unit affiliation in the
                // `<UnitsCard>` member list. Mirrors the include
                // shape on the page-level event query
                // (`page.tsx:121-125`).
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
                  select: {
                    locale: true,
                    name: true,
                  },
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
                  select: {
                    locale: true,
                    name: true,
                    shortName: true,
                  },
                },
              },
            },
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
  // `items.length > 0` over `items[0]?.event ?? findFirst()` —
  // the project's tsconfig doesn't enable `noUncheckedIndexedAccess`,
  // so TS types `items[0]` as non-undefined and would either reject
  // the `??` fallback's nullable result or collapse the union back
  // to non-null. The explicit length check matches both the runtime
  // intent and the type system without an annotation crutch.
  //
  // The `!isDeleted` clause preserves the original
  // `findFirst({ isDeleted: false })` semantics for the rare case
  // where the event was soft-deleted but its non-deleted children
  // are still around (admin removed an event mid-poll). In that
  // case `liveEvent` is null and we fall through to the standalone
  // findFirst, which also filters `isDeleted: false` and returns
  // null — `status` becomes null and the client keeps its SSR-
  // initial value. Costs one wasted DB round-trip per soft-deleted-
  // event poll, acceptable trade for the safety: the alternative is
  // a stale `status` slipping past the guard and potentially
  // unlocking editors on a deleted event.
  const liveEvent =
    items.length > 0 && !items[0].event.isDeleted ? items[0].event : null;
  const event =
    liveEvent ??
    (await prisma.event.findFirst({
      where: { id: eventId, isDeleted: false },
      select: { status: true, startTime: true },
    }));
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
