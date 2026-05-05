import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import type { FanTop3Entry } from "@/lib/types/setlist";

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
 */

async function fetchTop3(eventId: bigint, locale: string | null): Promise<FanTop3Entry[]> {
  const groups = await prisma.songWish.groupBy({
    by: ["songId"],
    where: { eventId },
    _count: { _all: true },
    // `_count.id` is the canonical "row count" orderBy on a groupBy
    // — Prisma's `_count: { _all: true }` shape and the orderBy
    // count are independent fields; using `id` here mirrors the
    // existing `getTrendingSongs` pattern in page.tsx:325.
    orderBy: { _count: { id: "desc" } },
    take: 3,
  });

  if (groups.length === 0) return [];

  const songIds = groups.map((g) => g.songId);
  // Same `[locale, "ja"]` translation filter as the rest of the
  // event page — trims the join while keeping the canonical-original
  // safety net. When no locale is provided (raw GET callers, or a
  // tooling consumer), pull every translation; the cost is bounded
  // (≤ 3 songs × locales).
  const localeFilter = locale ? { locale: { in: [locale, "ja"] } } : undefined;
  const songs = await prisma.song.findMany({
    where: { id: { in: songIds } },
    select: {
      id: true,
      originalTitle: true,
      originalLanguage: true,
      variantLabel: true,
      baseVersionId: true,
      translations: {
        where: localeFilter,
        select: { locale: true, title: true, variantLabel: true },
      },
    },
  });

  // Re-key by id so the returned order matches `groups` (the count
  // ordering — DB might return findMany in a different order).
  const songById = new Map(songs.map((s) => [s.id, s] as const));

  // `as unknown as FanTop3Entry["song"]` mirrors the project's
  // serializeBigInt boundary cast (see page.tsx:617). Runtime values
  // are numbers — `serializeBigInt` JSON-round-trips with a custom
  // BigInt replacer — but the generic preserves input types at the
  // type level, so we widen explicitly here.
  return groups.flatMap((g) => {
    const song = songById.get(g.songId);
    if (!song) return [];
    return [
      {
        count: g._count._all,
        song: serializeBigInt(song) as unknown as FanTop3Entry["song"],
      },
    ];
  });
}

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
  const top3 = await fetchTop3(eventId, locale);
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
  const [event, song] = await Promise.all([
    prisma.event.findFirst({
      where: { id: eventId, isDeleted: false },
      select: { id: true },
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
