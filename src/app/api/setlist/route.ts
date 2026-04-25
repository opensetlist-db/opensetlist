import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const eventIdParam = req.nextUrl.searchParams.get("eventId");
  if (!eventIdParam) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }

  let eventId: bigint;
  try {
    eventId = BigInt(eventIdParam);
  } catch {
    return NextResponse.json({ error: "invalid eventId" }, { status: 400 });
  }

  const [items, reactionGroups] = await Promise.all([
    prisma.setlistItem.findMany({
      where: { eventId, isDeleted: false },
      orderBy: { position: "asc" },
      include: {
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
            stageIdentity: { include: { translations: true } },
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
  ]);

  const reactionCounts: Record<string, Record<string, number>> = {};
  for (const g of reactionGroups) {
    const key = g.setlistItemId.toString();
    if (!reactionCounts[key]) reactionCounts[key] = {};
    reactionCounts[key][g.reactionType] = g._count;
  }

  return NextResponse.json(
    {
      items: serializeBigInt(items),
      reactionCounts,
      updatedAt: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}
