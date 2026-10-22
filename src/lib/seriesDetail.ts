import { cache } from "react";
import { prisma } from "@/lib/prisma";
import {
  CACHE_TTL,
  cachedQuery,
  joinIdKey,
  splitIdKey,
} from "@/lib/dataCache";
import { serializeBigInt } from "@/lib/utils";
import { resolveSeriesLogo, type PublicLogo } from "@/lib/logoResolution";
import { getLogoSeriesGraph } from "@/lib/logoSeriesGraph";

/*
 * Data side of the series detail page (`/[locale]/series/[id]`).
 *
 * Every read here is a `cachedQuery`, so every entry carries
 * PUBLIC_DATA_TAG and expires on `revalidatePublicData()` — the call
 * every EventSeries / Event / Artist admin writer already makes.
 *
 * Logo (07 contract): the series page starts the inheritance walk at
 * its OWN node (`resolveSeriesLogo`). The resolution happens INSIDE the
 * cached `series-detail` read, next to the row it belongs to, so the
 * cached payload holds the resolved `PublicLogo`. That is safe only
 * because the logo graph is itself a PUBLIC_DATA_TAG read: when an
 * ancestor's mode or asset changes, the writer's
 * `revalidatePublicData()` expires both this entry and the graph, and
 * the next request re-resolves against the fresh graph. An event-scoped
 * expiry (`revalidateEventData`) would NOT refresh it — pinned by
 * `unit/series-detail-cache.test.ts`. The key carries a `-v2` suffix
 * because the payload shape changed from the bare row to `{ series,
 * logo }`; an old entry must never be decoded as the new shape.
 *
 * Only `PublicLogo` (`{ image: {url,width,height} | null, color }`)
 * leaves this module for the logo — `EventSeries.imageUrl` (generic
 * image) and `Event.posterUrl` are not read for it, so neither is ever
 * promoted to a logo.
 */

// Returns the raw Prisma row — NOT `serializeBigInt(series)` — so BigInt
// ids (parent / child series, events) survive for link construction.
// `serializeBigInt` narrows to JS `number`, which loses bits above 2^53.
// The cache codec revives bigint and Date values (`encodeCacheValue`),
// so the cached row keeps the raw types.
async function fetchEventSeries(id: bigint) {
  return prisma.eventSeries.findFirst({
    where: { id, isDeleted: false },
    include: {
      translations: true,
      artist: { include: { translations: true } },
      parentSeries: { include: { translations: true } },
      childSeries: {
        where: { isDeleted: false },
        include: { translations: true },
        orderBy: { createdAt: "asc" },
      },
      events: {
        where: { isDeleted: false },
        include: { translations: true },
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
      },
    },
  });
}

export type SeriesDetailRow = NonNullable<
  Awaited<ReturnType<typeof fetchEventSeries>>
>;

export type SeriesDetail = { series: SeriesDetailRow; logo: PublicLogo };

/** Exported for the cache test; pages use `getSeriesDetail`. */
export async function fetchSeriesDetail(
  id: bigint,
): Promise<SeriesDetail | null> {
  const series = await fetchEventSeries(id);
  if (!series) return null;
  const logo = resolveSeriesLogo(series.id, await getLogoSeriesGraph());
  return { series, logo };
}

// `react.cache` dedups the metadata + page calls within one request.
export const getSeriesDetail = cache(
  cachedQuery("series-detail-v2", fetchSeriesDetail, {
    revalidate: CACHE_TTL.entity,
  }),
);

export type SongRowHydrated = {
  id: number;
  slug: string;
  originalTitle: string;
  originalLanguage: string;
  variantLabel: string | null;
  translations: Array<{
    locale: string;
    title: string;
    variantLabel: string | null;
  }>;
  artists: Array<{
    artist: {
      id: number;
      originalName: string | null;
      originalShortName: string | null;
      originalLanguage: string;
      translations: Array<{
        locale: string;
        name: string;
        shortName: string | null;
      }>;
    };
  }>;
};

export type SongAppearance = {
  songId: string;
  count: number;
  song: SongRowHydrated | null;
};

/**
 * Song appearance counts across the series' completed events. Counts
 * are SetlistItemSong occurrences (a medley or a repeat counts again),
 * not the number of shows — the existing meaning, kept by 32-v1.
 *
 * Order: count descending, then song id ascending. The id tiebreak is
 * the 32-v1 capture order (source audit "Song-count ties get ID
 * ascending"): without it equal counts come back in Postgres' arbitrary
 * order and the list reshuffles between builds. It is a stable display
 * order, not a ranking feature.
 */
async function fetchSongAppearances(
  completedEventIds: bigint[],
): Promise<SongAppearance[]> {
  if (completedEventIds.length === 0) return [];
  const counts = await prisma.setlistItemSong.groupBy({
    by: ["songId"],
    where: {
      setlistItem: {
        eventId: { in: completedEventIds },
        isDeleted: false,
      },
      // Soft-deleted songs drop out at aggregation, so the hydration
      // query fetches fewer ids and the page-side `song !== null`
      // filter stays a race-condition safety net only.
      song: { isDeleted: false },
    },
    _count: { songId: true },
    orderBy: [{ _count: { songId: "desc" } }, { songId: "asc" }],
  });

  const songIds = counts.map((c) => c.songId);
  const songs = await prisma.song.findMany({
    where: { id: { in: songIds }, isDeleted: false },
    include: {
      translations: true,
      artists: {
        where: { role: "primary" },
        include: { artist: { include: { translations: true } } },
        // `take: 1` picks the label shown on the row. Without an order
        // a song with two primary artists could show either one
        // depending on the plan; lowest artist id is the 32-v1 pin.
        orderBy: { artistId: "asc" },
        take: 1,
      },
    },
  });

  // Keyed off the RAW BigInt ids: `String(BigInt)` is exact for any
  // magnitude, while a serialized `number` would lose bits above 2^53.
  const rawById = new Map(songs.map((s) => [String(s.id), s] as const));

  return counts.map((c) => {
    const raw = rawById.get(String(c.songId));
    return {
      songId: String(c.songId),
      count: c._count.songId,
      song: raw ? (serializeBigInt(raw) as unknown as SongRowHydrated) : null,
    };
  });
}

/**
 * Distinct unit-type artists credited on any setlist item of the
 * series' own events (all statuses — a unit counts once its first set
 * is entered). Ordered by id: the 32-v1 capture order, so the chip row
 * does not reshuffle between builds. Raw rows (BigInt id intact): they
 * are rendered by server components only.
 */
async function fetchSeriesUnits(allEventIds: bigint[]) {
  if (allEventIds.length === 0) return [];
  const links = await prisma.setlistItemArtist.findMany({
    where: {
      setlistItem: { eventId: { in: allEventIds }, isDeleted: false },
      artist: { type: "unit", isDeleted: false },
    },
    select: { artistId: true },
    distinct: ["artistId"],
  });
  if (links.length === 0) return [];
  return prisma.artist.findMany({
    where: { id: { in: links.map((l) => l.artistId) }, isDeleted: false },
    include: { translations: true },
    orderBy: { id: "asc" },
  });
}

// Cached per event-id set (joined into the key — see `joinIdKey`). The
// sets derive from the cached series row + the request clock, so the
// key changes exactly when an event completes or the event list
// changes.
const getSongAppearancesCached = cachedQuery(
  "series-song-appearances-v2",
  (completedEventIdsKey: string) =>
    fetchSongAppearances(splitIdKey(completedEventIdsKey)),
  { revalidate: CACHE_TTL.entity },
);

const getSeriesUnitsCached = cachedQuery(
  "series-units-v2",
  (allEventIdsKey: string) => fetchSeriesUnits(splitIdKey(allEventIdsKey)),
  { revalidate: CACHE_TTL.entity },
);

// Schedule-tab label count: distinct visible songs across the completed
// events — the same filter as `fetchSongAppearances`' groupBy, without
// hydrating the rows the schedule tab never shows.
const getScheduleSongCountCached = cachedQuery(
  "series-schedule-song-count",
  (completedEventIdsKey: string) =>
    prisma.setlistItemSong
      .groupBy({
        by: ["songId"],
        where: {
          setlistItem: {
            eventId: { in: splitIdKey(completedEventIdsKey) },
            isDeleted: false,
          },
          song: { isDeleted: false },
        },
      })
      .then((rows) => rows.length),
  { revalidate: CACHE_TTL.entity },
);

export function getSongAppearances(completedEventIds: bigint[]) {
  return getSongAppearancesCached(joinIdKey(completedEventIds));
}

export function getSeriesUnits(allEventIds: bigint[]) {
  return getSeriesUnitsCached(joinIdKey(allEventIds));
}

export function getScheduleSongCount(completedEventIds: bigint[]) {
  return getScheduleSongCountCached(joinIdKey(completedEventIds));
}
