import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { byStageIdentityOrderBy } from "@/lib/memberOrder";
import { eventRosterSelect, serializeEventRoster } from "@/lib/eventRoster";
import { deriveLineupFromRoster } from "@/lib/sidebarDerivations";

type RouteProps = { params: Promise<{ id: string }> };

/** The input checklist shares the lineup order and retains all event performers. */
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
          orderBy: byStageIdentityOrderBy(),
          select: eventRosterSelect(),
        },
      },
    });

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const roster = serializeEventRoster(event.performers);
    const byId = new Map(roster.map((row) => [row.stageIdentity.id, row]));
    const lineup = deriveLineupFromRoster(roster, "ja", "", "");
    const performers = lineup.performers.map(({ id }) => {
      const { isGuest, stageIdentity } = byId.get(id)!;
      return {
        stageIdentityId: id,
        isGuest,
        originalName: stageIdentity.originalName,
        originalShortName: stageIdentity.originalShortName,
        originalLanguage: stageIdentity.originalLanguage,
        translations: stageIdentity.translations,
        sortOrder: stageIdentity.sortOrder,
        createdAt: stageIdentity.createdAt,
        artistLinks: stageIdentity.artistLinks.map(({ artist, sortOrder }) => ({
          artistId: artist.id,
          orderArtistId: artist.orderId,
          sortOrder,
        })),
      };
    });

    return NextResponse.json(
      { performers },
      {
        headers: {
          "Cache-Control": "private, no-store",
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
