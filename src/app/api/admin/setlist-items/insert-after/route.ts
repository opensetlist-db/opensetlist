import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";

export async function POST(request: NextRequest) {
  const { eventId, afterPosition } = await request.json();

  const eid = BigInt(eventId);
  const newPosition = afterPosition + 1;

  // Shift all items at newPosition and beyond up by 1
  await prisma.setlistItem.updateMany({
    where: {
      eventId: eid,
      position: { gte: newPosition },
      isDeleted: false,
    },
    data: { position: { increment: 1 } },
  });

  // Create a blank item at the new position
  const item = await prisma.setlistItem.create({
    data: {
      eventId: eid,
      position: newPosition,
      isEncore: false,
      stageType: "full_group",
      status: "confirmed",
      performanceType: "live_performance",
      type: "song",
    },
    include: {
      songs: {
        include: { song: { include: { translations: true } } },
        orderBy: { order: "asc" },
      },
      performers: {
        include: { stageIdentity: { include: { translations: true } } },
      },
      artists: {
        include: { artist: { include: { translations: true } } },
      },
    },
  });

  return NextResponse.json(serializeBigInt(item));
}
