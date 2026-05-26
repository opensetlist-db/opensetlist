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

// Cap on the per-album related-events list. Matches the Phase 1
// catalog profile (a song appearing in 50+ events is exceptionally
// rare at this scale). Both query branches share the same ceiling
// so a future bump lands in one place; if a future album crosses
// the cap, b04 can add a "더 보기" page-2 surface.
const MAX_RELATED_EVENTS = 50;

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

    // Both query paths filter out soft-deleted EventSeries via the
    // outer where (Prisma doesn't support `where` on a to-one
    // `include`, and Event.eventSeries is to-one). The OR clause
    // keeps standalone events (eventSeriesId IS NULL) while
    // excluding events whose series has been soft-deleted by the
    // operator — without this, a deleted series would still surface
    // its translated label in the bucket header.
    const eventSeriesFilter = {
      OR: [
        { eventSeriesId: null },
        { eventSeries: { isDeleted: false } },
      ],
    };

    if (albumType === AlbumType.live_album) {
      const rows = await prisma.event.findMany({
        where: {
          bdAlbumId: albumId,
          isDeleted: false,
          ...eventSeriesFilter,
        },
        include,
        // Event.startTime is NOT NULL in prisma/schema.prisma, so a
        // single-column desc sort is safe — no NULLS-LAST drift
        // to worry about. Event.date IS nullable and intentionally
        // not part of the sort key.
        orderBy: { startTime: "desc" },
        take: MAX_RELATED_EVENTS,
      });
      return serializeBigInt(rows);
    }

    // Non-live_album path needs the album's Pattern 1 vocal song ids
    // to walk SetlistItemSong. We pull those directly from Prisma here
    // rather than accepting them from the page (where the page's
    // album.tracks comes from serializeBigInt — BigInt → number JSON
    // round-trip — which silently truncates any songId beyond 2^53).
    // A separate query keeps the bigint round-trip-free end-to-end.
    const trackRows = await prisma.albumTrack.findMany({
      where: { albumId, songId: { not: null } },
      select: { songId: true },
    });
    const pattern1SongIds = trackRows
      .map((t) => t.songId)
      .filter((sid): sid is bigint => sid !== null);

    // Empty Pattern 1 set short-circuits to no related events
    // without a DB hit (all-drama/bgm release, or an empty album
    // row pre-import).
    if (pattern1SongIds.length === 0) return [];

    const rows = await prisma.event.findMany({
      where: {
        isDeleted: false,
        ...eventSeriesFilter,
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
      // `distinct` on the relation-walked findMany guards against a
      // single Event surfacing once per match (would happen if an
      // event's setlist plays multiple tracks from this album — common
      // for any Hasunosora full-album set list). The `some` predicate
      // above already short-circuits at "any match," so distinct is
      // belt-and-suspenders without changing semantics.
      distinct: ["id"],
      // Event.startTime is NOT NULL per schema (see live_album branch
      // above for the same rationale).
      orderBy: { startTime: "desc" },
      take: MAX_RELATED_EVENTS,
    });
    return serializeBigInt(rows);
  },
);
