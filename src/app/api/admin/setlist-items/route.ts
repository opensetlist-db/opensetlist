import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { validateEncoreOrder } from "@/lib/validation";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    eventId,
    position,
    isEncore,
    stageType,
    unitName,
    note,
    status,
    performanceType,
    type,
    songIds,
    performerIds,
    artistIds,
  } = body;

  // Validate encore ordering: non-encore items must come before encore items
  const existingItems = await prisma.setlistItem.findMany({
    where: { eventId: BigInt(eventId), isDeleted: false },
    select: { position: true, isEncore: true },
  });
  const encoreError = validateEncoreOrder([
    ...existingItems,
    { position, isEncore: isEncore ?? false },
  ]);
  if (encoreError) {
    return NextResponse.json({ error: encoreError }, { status: 400 });
  }

  const item = await prisma.setlistItem.create({
    data: {
      eventId: BigInt(eventId),
      position,
      isEncore: isEncore ?? false,
      stageType: stageType ?? "full_group",
      unitName: unitName || null,
      note: note || null,
      status: status ?? "confirmed",
      performanceType: performanceType ?? "live_performance",
      type: type ?? "song",
      songs: songIds?.length
        ? {
            create: songIds.map((songId: number, i: number) => ({
              songId: BigInt(songId),
              order: i,
            })),
          }
        : undefined,
      performers: performerIds?.length
        ? {
            create: performerIds.map((siId: string) => ({
              stageIdentityId: siId,
            })),
          }
        : undefined,
      artists: artistIds?.length
        ? {
            create: artistIds.map((artistId: number) => ({
              artistId: BigInt(artistId),
            })),
          }
        : undefined,
    },
    include: {
      songs: {
        include: { song: { include: { translations: true } } },
        orderBy: { order: "asc" },
      },
      performers: {
        include: {
          stageIdentity: { include: { translations: true } },
        },
      },
      artists: {
        include: {
          artist: { include: { translations: true } },
        },
      },
    },
  });
  return NextResponse.json(serializeBigInt(item), { status: 201 });
}
