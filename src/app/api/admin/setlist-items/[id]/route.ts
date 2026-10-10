import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { validateEncoreOrder } from "@/lib/validation";
import { revalidateEventData } from "@/lib/dataCache";
import { verifyAdminAPI } from "@/lib/admin-auth";
import {
  bumpSetlistRevisionAndBroadcast,
  lockEvent,
  revToNumber,
} from "@/lib/liveBroadcast";

type Props = { params: Promise<{ id: string }> };

/**
 * Resolve the item's event before opening the write transaction. The
 * event lock has to be the transaction's first statement, and we can
 * only lock an event we know — so this one read sits outside. Safe:
 * a SetlistItem's `eventId` never changes after creation (no writer
 * updates it), so the value cannot go stale between here and the lock.
 * Everything that CAN change (positions, encore flags, the row's own
 * soft-delete) is re-read inside the transaction.
 */
async function findItemEventId(itemId: bigint): Promise<bigint | null> {
  const row = await prisma.setlistItem.findUnique({
    where: { id: itemId },
    select: { eventId: true },
  });
  return row?.eventId ?? null;
}

export async function PUT(request: NextRequest, { params }: Props) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

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

  const eventId = await findItemEventId(itemId);
  if (eventId === null) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // One interactive transaction (n14): lock the event, validate encore
  // order against the rows as of the lock, clear + rewrite the item's
  // links, bump the revision and broadcast. A failure anywhere rolls the
  // whole save back — the item never ends up with its links deleted but
  // not rewritten, and no notification goes out for a save that didn't
  // happen. The event-cache expiry runs only after commit.
  const result = await prisma.$transaction(async (tx) => {
    await lockEvent(tx, eventId);

    const existingItems = await tx.setlistItem.findMany({
      where: { eventId, isDeleted: false, id: { not: itemId } },
      select: { position: true, isEncore: true },
    });
    const encoreError = validateEncoreOrder([
      ...existingItems,
      { position, isEncore: isEncore ?? false },
    ]);
    if (encoreError) {
      return { kind: "invalid" as const, error: encoreError };
    }

    await tx.setlistItemSong.deleteMany({ where: { setlistItemId: itemId } });
    await tx.setlistItemMember.deleteMany({ where: { setlistItemId: itemId } });
    await tx.setlistItemArtist.deleteMany({ where: { setlistItemId: itemId } });
    const item = await tx.setlistItem.update({
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
    const rev = await bumpSetlistRevisionAndBroadcast(tx, eventId);
    return { kind: "ok" as const, item, rev };
  });

  if (result.kind === "invalid") {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  revalidateEventData(eventId);
  return NextResponse.json({
    ...serializeBigInt(result.item),
    rev: revToNumber(result.rev),
  });
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const itemId = BigInt(id);
  const eventId = await findItemEventId(itemId);
  if (eventId === null) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Soft-delete + revision bump in one transaction (n14). Deleting an
  // already-deleted row still bumps: the request is a logical save from
  // the operator's point of view, and an extra refetch is harmless.
  const rev = await prisma.$transaction(async (tx) => {
    await lockEvent(tx, eventId);
    await tx.setlistItem.update({
      where: { id: itemId },
      data: { isDeleted: true, deletedAt: new Date() },
      select: { id: true },
    });
    return bumpSetlistRevisionAndBroadcast(tx, eventId);
  });
  revalidateEventData(eventId);
  return NextResponse.json({ success: true, rev: revToNumber(rev) });
}
