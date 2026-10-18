import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseRequiredAnonId } from "@/lib/anonId";
import {
  ballotErrorResponse,
  ballotJson,
  checkBoardWritable,
} from "@/lib/board/ballot";
import { deleteWish, isWishIdShape } from "@/lib/board/wishes";

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
 *
 * Board-enabled events (n15) use the board pick contract instead:
 *
 *   DELETE body { anonId }   (optional — see below)
 *     → 200 { id }
 *     → 400 malformed wish id / body / anonId
 *     → 403 board disabled; at or after start time; another anon's wish
 *     → 404 no such wish on this event (a retried delete — the client
 *           treats it as "already gone")
 *
 * A wish written with an anon id can only be removed by that anon. A
 * LEGACY wish (written before per-group wishes, no anon id) stays removable by
 * whoever holds its id — the browser that made it keeps that id in its
 * local wishlist — with or without an anon id in the body, and is
 * deleted as-is: never adopted into the caller's ballot.
 */
export async function DELETE(req: Request, { params }: RouteProps) {
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
    select: { startTime: true, boardEnabled: true },
  });
  if (event?.boardEnabled) return deleteBoardWish(req, eventId, wishId);
  if (event?.startTime && Date.now() >= event.startTime.getTime()) {
    return NextResponse.json(
      { error: "Wishlist is locked: event has started" },
      { status: 403 },
    );
  }

  await prisma.songWish.deleteMany({ where: { id: wishId, eventId } });
  return NextResponse.json({ ok: true });
}

/**
 * The wish delete on a board-enabled event (n15). An absent body,
 * or a body without `anonId`, is an anonymous delete — enough for a
 * legacy row, refused (`not_owner`) for a ballot row. A body that HAS
 * an `anonId` must carry a valid one: a malformed id is a client bug,
 * not an anonymous request.
 */
async function deleteBoardWish(req: Request, eventId: bigint, wishId: string) {
  if (!isWishIdShape(wishId)) {
    return ballotJson(400, { error: "invalid_wish_id" });
  }
  let anonId: string | null = null;
  const text = await req.text();
  if (text.trim().length > 0) {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return ballotJson(400, { error: "invalid_body" });
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return ballotJson(400, { error: "invalid_body" });
    }
    const raw = (body as Record<string, unknown>).anonId;
    if (raw !== undefined) {
      const anon = parseRequiredAnonId(raw);
      if (!anon.ok) return ballotJson(400, { error: "invalid_anon_id" });
      anonId = anon.value;
    }
  }

  try {
    const control = await checkBoardWritable(eventId);
    if (!control.ok) return ballotJson(control.status, { error: control.code });
    return ballotJson(200, await deleteWish(eventId, anonId, wishId));
  } catch (err) {
    return ballotErrorResponse(err);
  }
}
