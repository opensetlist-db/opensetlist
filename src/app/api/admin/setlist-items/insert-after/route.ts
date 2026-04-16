import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";

export async function POST(request: NextRequest) {
  const { eventId, afterPosition } = await request.json();

  if (!eventId) {
    return NextResponse.json(
      { error: "Invalid event ID" },
      { status: 400 }
    );
  }

  if (!Number.isInteger(afterPosition) || afterPosition < 0) {
    return NextResponse.json(
      { error: "Invalid insert position" },
      { status: 400 }
    );
  }

  let eid: bigint;
  try {
    eid = BigInt(eventId);
  } catch {
    return NextResponse.json(
      { error: "Invalid event ID" },
      { status: 400 }
    );
  }
  const newPosition = afterPosition + 1;

  const item = await prisma.$transaction(async (tx) => {
    // Find items that need to shift, ordered by position DESC
    // to avoid unique constraint violations on [eventId, position]
    const itemsToShift = await tx.setlistItem.findMany({
      where: {
        eventId: eid,
        position: { gte: newPosition },
      },
      orderBy: { position: "desc" },
      select: { id: true, position: true },
    });

    // Shift each one individually from highest to lowest
    for (const item of itemsToShift) {
      await tx.setlistItem.update({
        where: { id: item.id },
        data: { position: item.position + 1 },
      });
    }

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
