import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";

type Props = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const itemId = BigInt(id);
  const body = await request.json();
  const {
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

  // Validate encore ordering
  const currentItem = await prisma.setlistItem.findUnique({
    where: { id: itemId },
    select: { eventId: true },
  });
  if (currentItem) {
    const existingItems = await prisma.setlistItem.findMany({
      where: { eventId: currentItem.eventId, isDeleted: false, id: { not: itemId } },
      select: { position: true, isEncore: true },
    });
    const allItems = [...existingItems, { position, isEncore: isEncore ?? false }];
    const minEncorePos = Math.min(
      ...allItems.filter((i) => i.isEncore).map((i) => i.position),
      Infinity
    );
    const maxNonEncorePos = Math.max(
      ...allItems.filter((i) => !i.isEncore).map((i) => i.position),
      -Infinity
    );
    if (minEncorePos <= maxNonEncorePos) {
      return NextResponse.json(
        { error: "앙코르 항목은 모든 일반 항목 뒤에 위치해야 합니다." },
        { status: 400 }
      );
    }
  }

  // Clear existing links
  await prisma.setlistItemSong.deleteMany({ where: { setlistItemId: itemId } });
  await prisma.setlistItemMember.deleteMany({
    where: { setlistItemId: itemId },
  });
  await prisma.setlistItemArtist.deleteMany({
    where: { setlistItemId: itemId },
  });

  const item = await prisma.setlistItem.update({
    where: { id: itemId },
    data: {
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
  return NextResponse.json(serializeBigInt(item));
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  await prisma.setlistItem.update({
    where: { id: BigInt(id) },
    data: { isDeleted: true, deletedAt: new Date() },
  });
  return NextResponse.json({ success: true });
}
