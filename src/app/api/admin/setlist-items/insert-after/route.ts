import { NextRequest, NextResponse } from "next/server";
import {
  liveWriterTransaction,
  withAdminLiveWriterBusy,
} from "@/lib/liveWriterTx";
import { serializeBigInt } from "@/lib/utils";
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
  // A save the database could not even start answers 503 + Retry-After
  // (see `withAdminLiveWriterBusy`); every other outcome is unchanged.
  return withAdminLiveWriterBusy(() => insertAfter(request));
}

async function insertAfter(request: NextRequest) {
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

  const result = await liveWriterTransaction("admin-insert-after", async (tx) => {
    // n14: lock the event FIRST so the position read below sees every
    // previously committed save and no concurrent same-event save can
    // shift rows between our read and our updates (before the lock, two
    // overlapping insert-afters could both read the same tail and the
    // second would trip the partial unique on (eventId, position)).
    if (!(await lockEvent(tx, eid))) return null;

    // Find items that need to shift, ordered by position DESC
    // to avoid unique constraint violations on [eventId, position].
    // Skip soft-deleted rows: the partial unique in post-deploy.sql
    // only applies to active rows, so deleted rows hold their original
    // slot harmlessly and must not be bumped.
    const itemsToShift = await tx.setlistItem.findMany({
      where: {
        eventId: eid,
        position: { gte: newPosition },
        isDeleted: false,
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

    // Default the performer list to the event's non-guest roster —
    // mirrors the client-side default in SetlistBuilder.resetForm()
    // for the "+ Add" button. Both new-item entry points (add-at-end
    // and insert-after) land on the same UX: full group pre-selected,
    // operator deselects for unit/solo songs. Guests stay explicit
    // per the EventPerformer schema comment ("isGuest=true → explicit
    // only", schema.prisma:502-505).
    const eventPerformers = await tx.eventPerformer.findMany({
      where: { eventId: eid, isGuest: false },
      select: { stageIdentityId: true },
    });

    // Create a blank item at the new position
    const item = await tx.setlistItem.create({
      data: {
        eventId: eid,
        position: newPosition,
        isEncore: false,
        stageType: "full_group",
        status: "confirmed",
        performanceType: "live_performance",
        type: "song",
        performers: eventPerformers.length
          ? {
              create: eventPerformers.map((ep) => ({
                stageIdentityId: ep.stageIdentityId,
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
          include: { stageIdentity: { include: { translations: true } } },
        },
        artists: {
          include: { artist: { include: { translations: true } } },
        },
      },
    });

    // One bump + one broadcast for the whole logical save, however many
    // rows were shifted above — clients refetch the snapshot once.
    const rev = await bumpSetlistRevisionAndBroadcast(tx, eid);
    return { item, rev };
  }, (r) => r?.rev);

  if (!result) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }
  revalidateEventData(eid);
  return NextResponse.json({
    ...serializeBigInt(result.item),
    rev: revToNumber(result.rev),
  });
}
