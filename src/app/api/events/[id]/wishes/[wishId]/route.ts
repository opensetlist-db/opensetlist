import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type RouteProps = { params: Promise<{ id: string; wishId: string }> };

/**
 * DELETE /api/events/[id]/wishes/[wishId]
 *
 * Removes a wishlist row by its uuid. Idempotent — `deleteMany`
 * returns `{ count: 0 }` for a missing id, and we surface 200 either
 * way so an undo race (user removed, refreshed, removed again)
 * doesn't surface as a user-visible error. Mirrors the
 * reactions/route.ts:135-139 DELETE shape.
 *
 * The `[id]` event-id segment in the URL is informational here: the
 * wish-id alone is unique, but routing the DELETE under the event
 * scope keeps the URL hierarchy consistent with POST/GET so a single
 * client helper can build all three from the same `(eventId, wishId)`
 * pair.
 */
export async function DELETE(_req: Request, { params }: RouteProps) {
  const { wishId } = await params;
  if (typeof wishId !== "string" || wishId.length === 0) {
    return NextResponse.json({ error: "Invalid wishId" }, { status: 400 });
  }

  await prisma.songWish.deleteMany({ where: { id: wishId } });
  return NextResponse.json({ ok: true });
}
