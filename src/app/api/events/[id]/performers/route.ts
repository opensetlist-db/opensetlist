import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type RouteProps = { params: Promise<{ id: string }> };

/**
 * GET /api/events/[id]/performers
 *
 *   → {
 *       performers: Array<{
 *         stageIdentityId: string,
 *         originalName: string | null,
 *         originalShortName: string | null,
 *         originalLanguage: string,
 *         translations: { locale: string, name: string, shortName: string | null }[],
 *         isGuest: boolean,
 *         artistLinks: { artistId: number }[],
 *       }>
 *     }
 *
 * Read-only endpoint backing the `<AddItemBottomSheet>` performer
 * checklist (Phase 1C). Returns every `EventPerformer` for the event —
 * host AND guest — with enough display metadata to render the
 * checklist locally (no follow-up name-resolution fetches).
 *
 * `artistLinks` carries each StageIdentity's unit memberships so the
 * client can intersect "unit's current members" (from
 * `/api/artists/[artistId]/current-members`) with "this event's
 * performers" without a second walk through the StageIdentity table.
 *
 * `artistId` in `artistLinks` is coerced to `number` by the manual
 * cast below — the underlying Prisma column is `BigInt` but the
 * client convention (matching `serializeBigInt` + the rest of the
 * fan-facing payload contracts) is JSON-number. Per-item cast keeps
 * this route from depending on `serializeBigInt`'s walk-everywhere
 * recursion when the payload is otherwise shallow scalars.
 *
 * Cached: event performer rosters change only on operator edits
 * (rare during a live show). 60s edge cache + 5min SWR is plenty;
 * the bottom sheet is opened post-show-start by ground-truth users
 * who need fresh enough data that the just-added guest is visible.
 */
export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { id: rawId } = await params;
  let eventId: bigint;
  try {
    eventId = BigInt(rawId);
  } catch {
    return NextResponse.json({ error: "Invalid eventId" }, { status: 400 });
  }

  try {
    const event = await prisma.event.findFirst({
      where: { id: eventId, isDeleted: false },
      select: {
        performers: {
          select: {
            stageIdentityId: true,
            isGuest: true,
            stageIdentity: {
              select: {
                originalName: true,
                originalShortName: true,
                originalLanguage: true,
                translations: {
                  select: {
                    locale: true,
                    name: true,
                    shortName: true,
                  },
                },
                artistLinks: {
                  select: { artistId: true },
                },
              },
            },
          },
        },
      },
    });

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const performers = event.performers.map((ep) => ({
      stageIdentityId: ep.stageIdentityId,
      isGuest: ep.isGuest,
      originalName: ep.stageIdentity.originalName,
      originalShortName: ep.stageIdentity.originalShortName,
      originalLanguage: ep.stageIdentity.originalLanguage,
      translations: ep.stageIdentity.translations,
      artistLinks: ep.stageIdentity.artistLinks.map((l) => ({
        artistId: Number(l.artistId),
      })),
    }));

    return NextResponse.json(
      { performers },
      {
        headers: {
          "Cache-Control": "s-maxage=60, stale-while-revalidate=300",
        },
      },
    );
  } catch (err) {
    // DB connection / Prisma errors — return a JSON 500 (not the
    // Next.js HTML error page) so the client's `await res.json()`
    // path keeps parsing. Same defensive pattern as
    // /api/songs/search.
    console.error("[GET /api/events/[id]/performers] DB error", err);
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500 },
    );
  }
}
