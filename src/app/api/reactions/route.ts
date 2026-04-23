import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { parseAnonId } from "@/lib/anonId";

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

  // Default to {} so a literal JSON `null` body doesn't TypeError on
  // destructuring — same defensive pattern as impressions/route.ts.
  const { setlistItemId, reactionType, anonId } = body ?? {};

  if (!setlistItemId || !VALID_TYPES.includes(reactionType)) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const anonResult = parseAnonId(anonId);
  if (!anonResult.ok) {
    return NextResponse.json({ error: anonResult.message }, { status: 400 });
  }
  const dedupAnonId = anonResult.value;

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

  // Create-then-catch-P2002 idempotency. The partial unique
  // setlist_item_reaction_anon_unique enforces one row per
  // (setlistItemId, reactionType, anonId) when anonId is set; on conflict
  // we re-select the existing row and return its id so the client's UI
  // state stays consistent. Same pattern as
  // src/app/api/impressions/translate/route.ts:121-156.
  let reaction;
  try {
    reaction = await prisma.setlistItemReaction.create({
      data: {
        setlistItemId: siId,
        reactionType,
        anonId: dedupAnonId,
      },
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002" &&
      dedupAnonId
    ) {
      reaction = await prisma.setlistItemReaction.findFirst({
        where: { setlistItemId: siId, reactionType, anonId: dedupAnonId },
      });
      if (!reaction) throw e; // partial unique guarantees a row — fail loud
    } else {
      throw e;
    }
  }

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

  // Same null-body guard as POST — `body ?? {}` so a literal JSON null
  // doesn't TypeError on destructuring → we return 400, not 500.
  const { reactionId } = body ?? {};

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
