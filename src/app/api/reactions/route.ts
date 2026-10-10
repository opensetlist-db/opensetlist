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

  // SELECT the parent's eventId in the same lookup that validates
  // existence — denormalization for Realtime R2 (SetlistItemReaction
  // needs `eventId` directly so Supabase Realtime's column-only
  // `postgres_changes` filter can route pushes by event). Free join
  // since we were already going to read the row.
  const item = await prisma.setlistItem.findFirst({
    where: { id: siId, isDeleted: false },
    select: { id: true, eventId: true },
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
  //
  // `select: { id: true }` on both the create and the catch's
  // re-select narrows the returned row to just the UUID we actually
  // serialize back to the client. Without an explicit select, Prisma
  // returns every scalar including the new `eventId BigInt?` (R2
  // denormalization). The current response body only references
  // `reaction.id`, so a stray BigInt wouldn't reach JSON.stringify
  // today — but a future spread (`...reaction` in a debug log, an
  // expanded response shape) would silently throw at runtime.
  // Mirroring the parent SetlistItem.findFirst's `select: { id, eventId }`
  // shape just above keeps the convention uniform.
  let reaction;
  try {
    reaction = await prisma.setlistItemReaction.create({
      data: {
        setlistItemId: siId,
        eventId: item.eventId,
        reactionType,
        anonId: dedupAnonId,
      },
      select: { id: true },
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002" &&
      dedupAnonId
    ) {
      reaction = await prisma.setlistItemReaction.findFirst({
        where: { setlistItemId: siId, reactionType, anonId: dedupAnonId },
        select: { id: true },
      });
      if (!reaction) throw e; // partial unique guarantees a row — fail loud
    } else {
      throw e;
    }
  }

  // Counts first, THEN the ack watermark (separate statement, see
  // `readAckAt`). The client holds the `counts` we return until a
  // snapshot captured after `ackAt` arrives, so `ackAt` must be later
  // than every write those counts already include. If the watermark
  // were read before the counts, another user's reaction committed in
  // between would be in `counts` but could be missing from a snapshot
  // captured just after `ackAt`, and the client would briefly step the
  // count back by one when it adopted that snapshot. Reactions never
  // bump the setlist revision or expire the snapshot cache.
  const counts = await getReactionCounts(siId);
  const ackAt = await readAckAt();
  return NextResponse.json({
    reactionId: reaction.id,
    counts,
    ackAt,
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

  // Resolve the reaction's item before deleting so the response can
  // carry that item's post-delete counts (the client needs them to
  // hold its acknowledged state, same as POST). A reaction that is
  // already gone (double-tap, retry) still gets a watermark and, when
  // the row was never found, empty counts — the client keeps its own
  // state and the next snapshot settles it.
  const existing = await prisma.setlistItemReaction.findUnique({
    where: { id: reactionId },
    select: { setlistItemId: true },
  });
  await prisma.setlistItemReaction.deleteMany({
    where: { id: reactionId },
  });

  // Same order as POST: counts, then the watermark that covers them.
  const counts = existing ? await getReactionCounts(existing.setlistItemId) : {};
  const ackAt = await readAckAt();
  return NextResponse.json({ ok: true, counts, ackAt });
}

/**
 * Reaction ack watermark (n14): `clock_timestamp()` read in its own
 * statement AFTER the write's auto-commit returned AND after the
 * counts query — i.e. strictly after every write the returned counts
 * reflect, on the database's clock. A live snapshot whose `capturedAt`
 * (its transaction's `now()`) is later than this instant started after
 * those commits and therefore includes them, so the client can release
 * its held count for it. Not `now()`: inside an
 * implicit single-statement transaction that is this statement's
 * start, which is also fine, but `clock_timestamp()` states the intent
 * and stays correct if this ever moves into a larger transaction.
 */
async function readAckAt(): Promise<string> {
  const rows = await prisma.$queryRaw<{ ackAt: Date }[]>`
    SELECT clock_timestamp() AS "ackAt"
  `;
  return rows[0].ackAt.toISOString();
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
