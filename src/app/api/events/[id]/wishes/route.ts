import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchEventWishlistTop3 } from "@/lib/wishes/top3";
import { parseRequiredAnonId } from "@/lib/anonId";
import {
  ballotErrorResponse,
  ballotJson,
  checkBoardWritable,
} from "@/lib/board/ballot";
import { parseDecimalId } from "@/lib/board/ids";
import { validatePickTarget } from "@/lib/board/picks";
import { createWish } from "@/lib/board/wishes";

type RouteProps = { params: Promise<{ id: string }> };

/**
 * Wishlist (희망곡) endpoints.
 *
 *   GET  /api/events/[id]/wishes?locale=ko
 *        → { top3: FanTop3Entry[] }
 *
 *   POST /api/events/[id]/wishes  body { songId }
 *        → { id, songId }
 *
 * No `anonId` at 1B/1C — localStorage owns the per-user "already
 * wished this song" check before POST. Server happily accepts
 * duplicates if they slip through (operator monitor + Phase 2
 * full enforcement once accounts ship). DELETE lives in the sibling
 * `[wishId]/route.ts` so the wish-id is a path segment, not a body
 * field — matches the impressions DELETE convention.
 *
 * The TOP-3 query lives in `src/lib/wishes/top3.ts` so the polled
 * `/api/setlist` channel and this standalone GET stay in lockstep.
 *
 * Board-enabled events (n15) — POST changes contract:
 *
 *   POST body { groupId: "<root artist id>", songId: "<base song id>",
 *               anonId: "<browser id>" }
 *     → 201 { id, groupId, songId, createdAt }   new wish
 *     → 200 { …same… }                           exact retry
 *     → 400 / 403 / 404 / 409 / 503 `{ error: code }` — exactly the
 *       board pick contract (`board/picks/route.ts`): the anon id and
 *       group are required, the cap is 3 per (event, anon, group)
 *       under the ballot advisory lock, writes lock at the start time.
 *
 * The table is shared, so the cap can only hold if THIS endpoint
 * enforces it — a separate board endpoint would leave this one open.
 * Events without the flag keep the contract above unchanged; the only
 * difference on that path is the one extra flag read below. Neither
 * path calls a cache revalidate helper (the board aggregate is
 * TTL-only, and the overall TOP-3 never was invalidated by a wish).
 */

export async function GET(req: NextRequest, { params }: RouteProps) {
  const { id } = await params;
  let eventId: bigint;
  try {
    eventId = BigInt(id);
  } catch {
    return NextResponse.json({ error: "Invalid eventId" }, { status: 400 });
  }
  // `new URL(req.url)` works on both `NextRequest` (production) and
  // plain `Request` (tests). `req.nextUrl` is NextRequest-only and
  // would crash test runners that hit the route with a `Request`.
  const locale = new URL(req.url).searchParams.get("locale");
  const top3 = await fetchEventWishlistTop3(eventId, locale);
  return NextResponse.json(
    { top3 },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(req: NextRequest, { params }: RouteProps) {
  const { id } = await params;
  let eventId: bigint;
  try {
    eventId = BigInt(id);
  } catch {
    return NextResponse.json({ error: "Invalid eventId" }, { status: 400 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Board-enabled events take the per-group path. Read fresh (not the
  // cached control row): the kill switch must move writes back to the
  // legacy path on the very next request, as it does for picks. A
  // missing event reads as "not enabled" and gets the legacy 404 below.
  const control = await prisma.event.findFirst({
    where: { id: eventId, isDeleted: false },
    select: { boardEnabled: true },
  });
  if (control?.boardEnabled) return postBoardWish(eventId, body);

  // Same null-body guard as reactions/route.ts:49 — `body ?? {}` so
  // a literal JSON null returns 400, not 500.
  const { songId } = body ?? {};
  if (
    typeof songId !== "number" ||
    !Number.isFinite(songId) ||
    !Number.isInteger(songId) ||
    songId <= 0
  ) {
    return NextResponse.json({ error: "Invalid songId" }, { status: 400 });
  }
  const songIdBig = BigInt(songId);

  // Verify both event + song exist (and aren't soft-deleted) before
  // we write. The FK constraints would catch missing rows, but the
  // resulting Prisma error is opaque (P2003) — explicit 404s here
  // give the client a usable error shape and match the
  // reactions/route.ts:71-80 pre-check pattern.
  //
  // `event.startTime` is also selected here for the lock check
  // immediately below — wishlist writes close at `startTime` per
  // the wiki/engagement-features#Wishlist hard rules. Client-side
  // gates already hide the editor post-startTime, but a long-open
  // page (laptop sleep, tab background) or a curl/DevTools bypass
  // could still POST after the lock. v0.10.0 smoke caught the
  // open-page-across-startTime case; this 403 is the server-side
  // belt to the client wall-clock fallback in <EventWishSection>.
  const [event, song] = await Promise.all([
    prisma.event.findFirst({
      where: { id: eventId, isDeleted: false },
      select: { id: true, startTime: true },
    }),
    prisma.song.findFirst({
      where: { id: songIdBig, isDeleted: false },
      select: { id: true },
    }),
  ]);
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }
  if (!song) {
    return NextResponse.json({ error: "Song not found" }, { status: 404 });
  }
  if (event.startTime && Date.now() >= event.startTime.getTime()) {
    return NextResponse.json(
      { error: "Wishlist is locked: event has started" },
      { status: 403 },
    );
  }

  const wish = await prisma.songWish.create({
    data: { eventId, songId: songIdBig },
    select: { id: true, songId: true },
  });

  return NextResponse.json({
    id: wish.id,
    // serializeBigInt round-trip would also work; an explicit Number
    // cast here is clearer for a single field.
    songId: Number(wish.songId),
  });
}

/**
 * The per-group wish create on a board-enabled event (n15). Same
 * order as the pick create: cheap parse → fresh control check (flag +
 * lock) → static target validation → ballot lock → cap + insert.
 */
async function postBoardWish(eventId: bigint, body: unknown) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return ballotJson(400, { error: "invalid_body" });
  }
  const { groupId: rawGroup, songId: rawSong, anonId: rawAnon } =
    body as Record<string, unknown>;
  const anon = parseRequiredAnonId(rawAnon);
  if (!anon.ok) return ballotJson(400, { error: "invalid_anon_id" });
  const groupId = parseDecimalId(rawGroup);
  if (groupId === null) return ballotJson(400, { error: "invalid_group" });
  const songId = parseDecimalId(rawSong);
  if (songId === null) return ballotJson(400, { error: "invalid_song" });

  try {
    const control = await checkBoardWritable(eventId);
    if (!control.ok) return ballotJson(control.status, { error: control.code });
    await validatePickTarget(control.context, groupId, songId);
    const result = await createWish(eventId, anon.value, groupId, songId);
    return ballotJson(result.created ? 201 : 200, result.wish);
  } catch (err) {
    return ballotErrorResponse(err);
  }
}
