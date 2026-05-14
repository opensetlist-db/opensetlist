import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type RouteProps = { params: Promise<{ artistId: string }> };

/**
 * GET /api/artists/[artistId]/current-members
 *
 *   → { stageIdentityIds: string[] }
 *
 * Returns the StageIdentity ids currently linked to a unit (or any
 * Artist) — i.e. the rows in `StageIdentityArtist` whose date range
 * brackets "now":
 *
 *   (startDate IS NULL OR startDate <= now)
 *     AND
 *   (endDate IS NULL OR endDate >= now)
 *
 * Consumed by `<AddItemBottomSheet>` (Phase 1C): when the user picks
 * a unit-type song, the sheet auto-checks the unit's current members
 * in the performer list. The intersection with the event's actual
 * performers happens client-side — a unit member who isn't in the
 * event's performer list (e.g. didn't attend that show) just stays
 * unchecked.
 *
 * Pre-loading these on the event page payload would bloat the
 * cold-load for the 99% of viewers who never open the sheet, so this
 * is an on-demand lookup gated by the SongSearch v2 song-pick event.
 *
 * Cached: unit membership rarely changes mid-tour — 5 minute edge
 * cache + 10 minute SWR is plenty, and lets repeat opens of the
 * sheet (try one song, back, try another song with the same unit)
 * skip the round-trip entirely.
 *
 * Path-param name is `[artistId]` to match the Artist.id semantics
 * (any Artist row is valid input, not just units — the route doesn't
 * filter by `Artist.type === 'unit'`; that classification happens
 * upstream in `deriveStageType`).
 */
export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { artistId } = await params;
  let id: bigint;
  try {
    id = BigInt(artistId);
  } catch {
    return NextResponse.json({ error: "Invalid artistId" }, { status: 400 });
  }

  const now = new Date();
  const links = await prisma.stageIdentityArtist.findMany({
    where: {
      artistId: id,
      AND: [
        { OR: [{ startDate: null }, { startDate: { lte: now } }] },
        { OR: [{ endDate: null }, { endDate: { gte: now } }] },
      ],
    },
    select: { stageIdentityId: true },
  });

  return NextResponse.json(
    { stageIdentityIds: links.map((l) => l.stageIdentityId) },
    {
      headers: {
        "Cache-Control": "s-maxage=300, stale-while-revalidate=600",
      },
    },
  );
}
