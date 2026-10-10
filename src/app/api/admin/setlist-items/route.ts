import { NextRequest, NextResponse } from "next/server";
import {
  liveWriterTransaction,
  withAdminLiveWriterBusy,
} from "@/lib/liveWriterTx";
import { serializeBigInt } from "@/lib/utils";
import { validateEncoreOrder } from "@/lib/validation";
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
  return withAdminLiveWriterBusy(() => createItem(request));
}

async function createItem(request: NextRequest) {
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

  const eid = BigInt(eventId);

  // One interactive transaction per save (n14, see src/lib/liveBroadcast.ts):
  // lock the event → validate against the rows as of the lock → create
  // → bump revision + broadcast. The encore check used to read outside
  // any transaction, so two concurrent saves could each pass it against
  // a state the other was about to change; under the lock the second
  // save validates against the first one's committed rows.
  // `liveWriterTransaction`: explicit live-path limits + timing log.
  const result = await liveWriterTransaction("admin-create", async (tx) => {
    if (!(await lockEvent(tx, eid))) {
      return { kind: "not_found" as const };
    }

    // Validate encore ordering: non-encore items must come before encore items
    const existingItems = await tx.setlistItem.findMany({
      where: { eventId: eid, isDeleted: false },
      select: { position: true, isEncore: true },
    });
    const encoreError = validateEncoreOrder([
      ...existingItems,
      { position, isEncore: isEncore ?? false },
    ]);
    if (encoreError) {
      // Nothing written yet — returning (not throwing) commits an empty
      // transaction, which only releases the lock.
      return { kind: "invalid" as const, error: encoreError };
    }

    const item = await tx.setlistItem.create({
      data: {
        eventId: eid,
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
    const rev = await bumpSetlistRevisionAndBroadcast(tx, eid);
    return { kind: "ok" as const, item, rev };
  }, (r) => (r.kind === "ok" ? r.rev : null));

  if (result.kind === "not_found") {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }
  if (result.kind === "invalid") {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  // After commit: expire the event's cached reads (incl. the live
  // snapshot) so the broadcast's refetch wave sees the new revision.
  revalidateEventData(eid);
  return NextResponse.json(
    { ...serializeBigInt(result.item), rev: revToNumber(result.rev) },
    { status: 201 },
  );
}
