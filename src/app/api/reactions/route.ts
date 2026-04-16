import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const VALID_TYPES = ["waiting", "best", "surprise", "moved"];

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }

  let eid: bigint;
  try {
    eid = BigInt(eventId);
  } catch {
    return NextResponse.json({ error: "Invalid eventId" }, { status: 400 });
  }

  const groups = await prisma.setlistItemReaction.groupBy({
    by: ["setlistItemId", "reactionType"],
    where: {
      setlistItem: { eventId: eid, isDeleted: false },
    },
    _count: true,
  });

  const result: Record<string, Record<string, number>> = {};
  for (const g of groups) {
    const key = g.setlistItemId.toString();
    if (!result[key]) result[key] = {};
    result[key][g.reactionType] = g._count;
  }

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { setlistItemId, reactionType } = body;

  if (!setlistItemId || !VALID_TYPES.includes(reactionType)) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  let siId: bigint;
  try {
    siId = BigInt(setlistItemId);
  } catch {
    return NextResponse.json(
      { error: "Invalid setlistItemId" },
      { status: 400 }
    );
  }

  const item = await prisma.setlistItem.findFirst({
    where: { id: siId, isDeleted: false },
    select: { id: true },
  });
  if (!item) {
    return NextResponse.json(
      { error: "SetlistItem not found" },
      { status: 404 }
    );
  }

  const reaction = await prisma.setlistItemReaction.create({
    data: {
      setlistItemId: siId,
      reactionType,
    },
  });

  const counts = await getReactionCounts(siId);
  return NextResponse.json({
    reactionId: reaction.id,
    counts,
  });
}

export async function DELETE(req: NextRequest) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { reactionId } = body;

  if (!reactionId || typeof reactionId !== "string") {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  await prisma.setlistItemReaction.deleteMany({
    where: { id: reactionId },
  });

  return NextResponse.json({ ok: true });
}

async function getReactionCounts(setlistItemId: bigint) {
  const groups = await prisma.setlistItemReaction.groupBy({
    by: ["reactionType"],
    where: { setlistItemId },
    _count: true,
  });

  const counts: Record<string, number> = {};
  for (const g of groups) {
    counts[g.reactionType] = g._count;
  }
  return counts;
}
