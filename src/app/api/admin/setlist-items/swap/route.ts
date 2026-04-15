import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const { itemIdA, itemIdB } = await request.json();

  const [itemA, itemB] = await Promise.all([
    prisma.setlistItem.findUnique({
      where: { id: BigInt(itemIdA) },
      select: { id: true, position: true },
    }),
    prisma.setlistItem.findUnique({
      where: { id: BigInt(itemIdB) },
      select: { id: true, position: true },
    }),
  ]);

  if (!itemA || !itemB) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
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
