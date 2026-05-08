import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type RouteProps = { params: Promise<{ id: string; wishId: string }> };

/**
 * DELETE /api/events/[id]/wishes/[wishId]
 *
 * Removes a wishlist row by its uuid scoped to the URL's event id.
 * Idempotent — `deleteMany` returns `{ count: 0 }` for a missing or
 * cross-event row, and we surface 200 either way so an undo race
 * (user removed, refreshed, removed again) doesn't surface as a
 * user-visible error. Mirrors the reactions/route.ts:135-139 DELETE
 * shape.
 *
 * Scoping by `(id: wishId, eventId)` rather than `(id: wishId)`
 * alone prevents a client that knows a wish-id from another event
 * from issuing a cross-event delete via this URL. Wish-ids are
 * uuids and not enumerable, but defense-in-depth: the URL already
 * carries the event id, so honoring it costs nothing.
 */
export async function DELETE(_req: Request, { params }: RouteProps) {
  const { id, wishId } = await params;
  if (typeof wishId !== "string" || wishId.length === 0) {
    return NextResponse.json({ error: "Invalid wishId" }, { status: 400 });
  }
  let eventId: bigint;
  try {
    eventId = BigInt(id);
  } catch {
    return NextResponse.json({ error: "Invalid eventId" }, { status: 400 });
  }

  // Lock check mirrors POST `/api/events/[id]/wishes`: deletes also
  // freeze at `event.startTime`, otherwise a long-open page could
  // remove a wish post-lock and corrupt the fan TOP-3 aggregate
  // mid-show. Soft-deleted events fall through to the 200-ok path
  // (no startTime narrowing) since the wish wouldn't exist anyway —
  // matches the existing idempotent-DELETE shape.
  const event = await prisma.event.findFirst({
    where: { id: eventId, isDeleted: false },
    select: { startTime: true },
  });
  if (event?.startTime && Date.now() >= event.startTime.getTime()) {
    return NextResponse.json(
      { error: "Wishlist is locked: event has started" },
      { status: 403 },
    );
  }

  await prisma.songWish.deleteMany({ where: { id: wishId, eventId } });
  return NextResponse.json({ ok: true });
}
