import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
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

  const [itemA, itemB] = await Promise.all([
    prisma.setlistItem.findUnique({
      where: { id: idA },
      select: { id: true, eventId: true, position: true },
    }),
    prisma.setlistItem.findUnique({
      where: { id: idB },
      select: { id: true, eventId: true, position: true },
    }),
  ]);

  if (!itemA || !itemB) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  if (itemA.eventId !== itemB.eventId) {
    return NextResponse.json(
      { error: "Items must belong to the same event" },
      { status: 400 }
    );
  }

  // Swap positions using temp value to avoid unique constraint conflicts
  await prisma.$transaction([
    prisma.setlistItem.update({
      where: { id: itemA.id },
      data: { position: -1 },
    }),
    prisma.setlistItem.update({
      where: { id: itemB.id },
      data: { position: itemA.position },
    }),
    prisma.setlistItem.update({
      where: { id: itemA.id },
      data: { position: itemB.position },
    }),
  ]);

  return NextResponse.json({ success: true });
}
