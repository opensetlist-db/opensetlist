import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";

export async function POST(request: NextRequest) {
  const { eventId, afterPosition } = await request.json();

  if (!Number.isInteger(afterPosition) || afterPosition < 0) {
    return NextResponse.json(
      { error: "Invalid insert position" },
      { status: 400 }
    );
  }

  const eid = BigInt(eventId);
  const newPosition = afterPosition + 1;

  // Wrap shift + create in a transaction for atomicity
  const item = await prisma.$transaction(async (tx) => {
    // Shift all items at newPosition and beyond up by 1
    await tx.setlistItem.updateMany({
      where: {
        eventId: eid,
        position: { gte: newPosition },
        isDeleted: false,
      },
      data: { position: { increment: 1 } },
    });

    // Create a blank item at the new position
    return tx.setlistItem.create({
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
  });

  return NextResponse.json(serializeBigInt(item));
}
