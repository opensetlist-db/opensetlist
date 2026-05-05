import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import type { FanTop3Entry } from "@/lib/types/setlist";

export async function GET(req: NextRequest) {
  // `new URL(req.url)` over `req.nextUrl` so unit tests can invoke
  // the handler with a plain `Request`. Mirrors the wishes route.
  const url = new URL(req.url);
  const eventIdParam = url.searchParams.get("eventId");
  if (!eventIdParam) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }
  // Locale is optional — when absent, the wishlist top-3 song
  // payload returns every translation. Existing callers that don't
  // pass `?locale=` keep working byte-identically; the polling hook
  // (useSetlistPolling) threads the active locale through so the
  // payload stays as small as the per-page event query.
  const locale = url.searchParams.get("locale");
  const localeFilter = locale ? { locale: { in: [locale, "ja"] } } : undefined;

  let eventId: bigint;
  try {
    eventId = BigInt(eventIdParam);
  } catch {
    return NextResponse.json({ error: "invalid eventId" }, { status: 400 });
  }

  const [items, reactionGroups, wishGroups] = await Promise.all([
    prisma.setlistItem.findMany({
      where: { eventId, isDeleted: false },
      orderBy: { position: "asc" },
      omit: { note: true },
      include: {
        songs: {
          include: {
            song: {
              include: {
                translations: true,
                artists: {
                  include: {
                    artist: { include: { translations: true } },
                  },
                },
              },
            },
          },
          orderBy: { order: "asc" },
        },
        performers: {
          include: {
            stageIdentity: {
              include: {
                translations: true,
                // Required by the sidebar's per-unit member sublist
                // re-derivation in `LiveEventLayout`. Without this,
                // a polled setlist that introduces a new performer
                // would render with no unit affiliation in the
                // `<UnitsCard>` member list. Mirrors the include
                // shape on the page-level event query
                // (`page.tsx:88-98`).
                artistLinks: { select: { artistId: true } },
              },
            },
            realPerson: { include: { translations: true } },
          },
        },
        artists: {
          include: {
            artist: { include: { translations: true } },
          },
        },
      },
    }),
    prisma.setlistItemReaction.groupBy({
      by: ["setlistItemId", "reactionType"],
      where: { setlistItem: { eventId, isDeleted: false } },
      _count: true,
    }),
    // Wishlist fan TOP-3 — top 3 wished songs for this event by
    // SongWish row count. Bounded `take: 3`, indexed groupBy on
    // `SongWish(eventId, songId)`. Mirrors the standalone GET on
    // /api/events/[id]/wishes so a polled refresh and a direct fetch
    // produce identical shapes (`FanTop3Entry[]`).
    prisma.songWish.groupBy({
      by: ["songId"],
      where: { eventId },
      _count: { _all: true },
      orderBy: { _count: { id: "desc" } },
      take: 3,
    }),
  ]);

  const reactionCounts: Record<string, Record<string, number>> = {};
  for (const g of reactionGroups) {
    const key = g.setlistItemId.toString();
    if (!reactionCounts[key]) reactionCounts[key] = {};
    reactionCounts[key][g.reactionType] = g._count;
  }

  // Resolve song display payloads for the fan TOP-3 in a single
  // bounded findMany. Re-key by id so the returned order matches the
  // groupBy count ordering (DB might return findMany in arbitrary
  // order). Skipped entirely when there are zero wishes — same
  // pattern as the trending fetch in page.tsx.
  let top3Wishes: FanTop3Entry[] = [];
  if (wishGroups.length > 0) {
    const songIds = wishGroups.map((g) => g.songId);
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
    const songById = new Map(songs.map((s) => [s.id, s] as const));
    top3Wishes = wishGroups.flatMap((g) => {
      const song = songById.get(g.songId);
      if (!song) return [];
      // `as unknown as ...` per the project's serializeBigInt
      // boundary convention (page.tsx:617). Runtime values are
      // numbers; the generic just doesn't widen at the type level.
      return [
        {
          count: g._count._all,
          song: serializeBigInt(song) as unknown as FanTop3Entry["song"],
        },
      ];
    });
  }

  return NextResponse.json(
    {
      items: serializeBigInt(items),
      reactionCounts,
      top3Wishes,
      updatedAt: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}
