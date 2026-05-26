import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { AlbumType, SetlistItemStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

/*
 * Type-aware "related events" fetch for the Album page's events tab
 * (b04). Two distinct query paths driven by Album.type:
 *
 *   live_album → Reverse lookup via Event.bdAlbumId.
 *                Multi-day BD shows commonly share one Memorial BOX
 *                (Saitama Day 1 + Day 2 → same Album), so the cardinality
 *                is "1 album → N events" and the join is just a column
 *                filter. The BD's setlist is implicit (the BD IS the show
 *                recording), so we don't need a setlist-side join.
 *
 *   any other  → Song↔AlbumTrack↔SetlistItem walk over Pattern 1 song
 *                ids on the album. "These tracks were performed at these
 *                events." Pattern 2/3 AlbumTrack rows have no songId so
 *                they're naturally excluded. SetlistItem status filter
 *                keeps the join honest (rumoured + confirmed only —
 *                live is a transient real-time state, not something a
 *                related-events page should pin).
 *
 * Both paths share the same include + ordering shape so the consumer
 * component renders identically downstream — only the WHERE clause
 * diverges.
 *
 * `take: 50` ceiling matches the spec + the album-events traffic
 * profile (a song appearing in 50+ events is exceptionally rare at
 * Phase 1 catalog scale). If a future album crosses that threshold,
 * b04 can add a "더 보기" page-2 surface; today's data doesn't need it.
 *
 * react.cache wrap mirrors getAlbum's pattern in page.tsx so
 * generateMetadata + the page render + the events-tab component all
 * collapse to one DB roundtrip per request even if they each call
 * through to here independently.
 */

export type RelatedEvent = Prisma.EventGetPayload<{
  include: {
    translations: true;
    eventSeries: {
      include: { translations: true };
    };
  };
}>;

export const getAlbumRelatedEvents = cache(
  async (
    albumId: bigint,
    albumType: AlbumType,
    pattern1SongIds: bigint[],
    locale: string,
  ): Promise<RelatedEvent[]> => {
    const localeFilter = { locale: { in: [locale, "ja"] } };
    const include = {
      translations: { where: localeFilter },
      eventSeries: {
        include: {
          translations: { where: localeFilter },
        },
      },
    };

    if (albumType === AlbumType.live_album) {
      const rows = await prisma.event.findMany({
        where: { bdAlbumId: albumId, isDeleted: false },
        include,
        orderBy: { startTime: "desc" },
        take: 50,
      });
      return serializeBigInt(rows);
    }

    // Non-live_album path needs at least one vocal songId to walk
    // through SetlistItemSong; an album with zero Pattern 1 tracks
    // (all-drama/bgm releases, or an empty album row pre-import)
    // resolves to no related events without a DB hit.
    if (pattern1SongIds.length === 0) return [];

    const rows = await prisma.event.findMany({
      where: {
        isDeleted: false,
        setlistItems: {
          some: {
            isDeleted: false,
            status: {
              in: [SetlistItemStatus.confirmed, SetlistItemStatus.rumoured],
            },
            songs: {
              some: { songId: { in: pattern1SongIds } },
            },
          },
        },
      },
      include,
      orderBy: { startTime: "desc" },
      // `distinct` on the relation-walked findMany guards against a
      // single Event surfacing once per match (would happen if an
      // event's setlist plays multiple tracks from this album — common
      // for any Hasunosora full-album set list). The `some` predicate
      // above already short-circuits at "any match," so distinct is
      // belt-and-suspenders without changing semantics.
      distinct: ["id"],
      take: 50,
    });
    return serializeBigInt(rows);
  },
);
