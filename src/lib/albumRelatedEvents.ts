import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { serializeBigIntAsString, type BigIntStringified } from "@/lib/utils";
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

/*
 * Shared WHERE-fragment for both the count helper and the full
 * fetch — keeps a standalone event (`eventSeriesId IS NULL`) in the
 * result while excluding events whose series has been soft-deleted.
 * Extracted to module scope so a future change to the soft-delete
 * semantics propagates to both helpers in one edit instead of two
 * identical literals that must be kept in sync.
 */
const EVENT_SERIES_FILTER: Prisma.EventWhereInput = {
  OR: [
    { eventSeriesId: null },
    { eventSeries: { isDeleted: false } },
  ],
};

// Wire-shape of one row after the JSON boundary
// (`serializeBigIntAsString` runs in the cached helper below).
// BigIntStringified rewrites every `bigint` → `string` and every
// `Date` → `string`, matching what JSON.stringify actually produces.
// Consumers (`<AlbumRelatedEventsTab>`) read ids as strings + dates
// as ISO strings; this alias keeps the type system in sync with the
// runtime instead of advertising raw Prisma `bigint`/`Date` shapes
// the wire payload no longer carries.
export type RelatedEvent = BigIntStringified<
  Prisma.EventGetPayload<{
    include: {
      translations: true;
      eventSeries: {
        include: { translations: true };
      };
    };
  }>
>;

/*
 * Cheap COUNT-only companion to `getAlbumRelatedEvents`. The tab label
 * on the album page needs the related-events total regardless of which
 * tab the user landed on; the full fetch (with its include tree + sort
 * + `take: 50` cap) is wasteful when the user isn't actually viewing
 * the events tab. Both helpers share the same WHERE shape per album
 * type, so the count is consistent with the eventual list render.
 *
 * react.cache wrap is independent of `getAlbumRelatedEvents` — they
 * each cache their own (albumId, type) tuple, no cross-talk. No
 * locale argument here because the count is locale-invariant; the
 * full fetch needs it for the translations filter inside the include.
 */
export const getAlbumRelatedEventsCount = cache(
  async (
    albumId: bigint,
    albumType: AlbumType,
  ): Promise<number> => {
    if (albumType === AlbumType.live_album) {
      return prisma.event.count({
        where: {
          bdAlbumId: albumId,
          isDeleted: false,
          ...EVENT_SERIES_FILTER,
        },
      });
    }

    const trackRows = await prisma.albumTrack.findMany({
      where: { albumId, songId: { not: null } },
      select: { songId: true },
    });
    const pattern1SongIds = trackRows
      .map((t) => t.songId)
      .filter((sid): sid is bigint => sid !== null);
    if (pattern1SongIds.length === 0) return 0;

    return prisma.event.count({
      where: {
        isDeleted: false,
        ...EVENT_SERIES_FILTER,
        setlistItems: {
          some: {
            isDeleted: false,
            status: {
              in: [SetlistItemStatus.confirmed, SetlistItemStatus.rumoured],
            },
            songs: { some: { songId: { in: pattern1SongIds } } },
          },
        },
      },
    });
  },
);

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
    // its translated label in the bucket header. Lifted to a
    // module-level `EVENT_SERIES_FILTER` const so the count helper
    // above + this full-fetch helper stay in lockstep.

    if (albumType === AlbumType.live_album) {
      const rows = await prisma.event.findMany({
        where: {
          bdAlbumId: albumId,
          isDeleted: false,
          ...EVENT_SERIES_FILTER,
        },
        include,
        // Event.startTime is NOT NULL in prisma/schema.prisma, so a
        // single-column desc sort is safe — no NULLS-LAST drift
        // to worry about. Event.date IS nullable and intentionally
        // not part of the sort key.
        orderBy: { startTime: "desc" },
        take: MAX_RELATED_EVENTS,
      });
      // String-coerce ids over the JSON boundary — the consumer
      // composes event hrefs and series-bucket keys off these values,
      // and ids past 2^53 - 1 would silently round through the
      // Number-targeted serializer.
      return serializeBigIntAsString(rows);
    }

    // Non-live_album path needs the album's Pattern 1 vocal song ids
    // to walk SetlistItemSong. We pull those directly from Prisma here
    // rather than accepting them from the page — the page's album
    // payload goes through a JSON serializer (originally the lossy
    // number-targeted one; now the string-coercing variant after the
    // v0.14.3 CR sweep), and either way the call site needs raw
    // `bigint` values to feed back into a Prisma `where: { songId: { in: ... } }`
    // clause. A separate query keeps the bigint pipeline-pure
    // end-to-end without parsing the string ids back.
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
        ...EVENT_SERIES_FILTER,
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
    return serializeBigIntAsString(rows);
  },
);
