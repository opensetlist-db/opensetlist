import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { revalidateEventData } from "@/lib/dataCache";
import { verifyAdminAPI } from "@/lib/admin-auth";
import {
  bumpSetlistRevisionAndBroadcast,
  lockEvent,
  revToNumber,
} from "@/lib/liveBroadcast";

export async function POST(request: NextRequest) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { itemIdA, itemIdB } = await request.json();

  if (!itemIdA || !itemIdB) {
    return NextResponse.json(
      { error: "Both item IDs are required" },
      { status: 400 }
    );
  }

  let idA: bigint;
  let idB: bigint;
  try {
    idA = BigInt(itemIdA);
    idB = BigInt(itemIdB);
  } catch {
    return NextResponse.json(
      { error: "Invalid item ID" },
      { status: 400 }
    );
  }

  // Event membership only — `eventId` is immutable on a SetlistItem, so
  // it is safe to read before the transaction and is what tells us
  // which event row to lock. Positions are NOT read here: they change
  // with every save, so they are re-read inside the transaction after
  // the lock (reading them outside, as this route used to, let a
  // concurrent insert-after shift the rows between the read and the
  // swap and write stale positions back).
  const owners = await prisma.setlistItem.findMany({
    where: { id: { in: [idA, idB] } },
    select: { id: true, eventId: true },
  });
  const ownerA = owners.find((o) => o.id === idA);
  const ownerB = owners.find((o) => o.id === idB);

  if (!ownerA || !ownerB) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  if (ownerA.eventId !== ownerB.eventId) {
    return NextResponse.json(
      { error: "Items must belong to the same event" },
      { status: 400 }
    );
  }
  const eventId = ownerA.eventId;

  const rev = await prisma.$transaction(async (tx) => {
    await lockEvent(tx, eventId);
    const rows = await tx.setlistItem.findMany({
      where: { id: { in: [idA, idB] } },
      select: { id: true, position: true },
    });
    const itemA = rows.find((r) => r.id === idA)!;
    const itemB = rows.find((r) => r.id === idB)!;

    // Swap positions using temp value to avoid unique constraint conflicts
    await tx.setlistItem.update({
      where: { id: itemA.id },
      data: { position: -1 },
    });
    await tx.setlistItem.update({
      where: { id: itemB.id },
      data: { position: itemA.position },
    });
    await tx.setlistItem.update({
      where: { id: itemA.id },
      data: { position: itemB.position },
    });
    return bumpSetlistRevisionAndBroadcast(tx, eventId);
  });

  revalidateEventData(eventId);
  return NextResponse.json({ success: true, rev: revToNumber(rev) });
}
