import { prisma } from "@/lib/prisma";
import { CACHE_TTL, cachedQuery } from "@/lib/dataCache";
import { getLogoSeriesGraph } from "@/lib/logoSeriesGraph";
import { MS_PER_DAY } from "@/lib/eventTiming";
import { SONG_COUNT_WHERE } from "@/lib/setlistCounts";
import {
  LOGO_EVENT_SELECT,
  resolveEventLogo,
  type LogoSeriesGraph,
  type PublicLogo,
} from "@/lib/logoResolution";

/*
 * Home page data (redesign 14-v1.3 / ticket 15).
 *
 * Three sections, each with its own eligibility rule:
 *
 *   ongoing   unchanged from the pre-redesign home: manual `ongoing`, or
 *             `scheduled` inside the 12h buffer after startTime. No cap —
 *             the approved design keeps every live show visible.
 *   upcoming  the pre-redesign rule with ONLY the 30-day horizon removed:
 *             `scheduled`, not deleted, startTime after `now`, nearest
 *             five. Cancelled events never match (`status: scheduled`).
 *             The concert list deliberately keeps future cancelled rows
 *             visible with their own treatment — that is a different
 *             surface with a different rule, so do not merge the two.
 *   past      concerts with at least one visible song-bearing setlist
 *             item (`SONG_COUNT_WHERE`: not deleted, type song, a song
 *             linked). Newest first, at most five, within the previous
 *             30 days. Only when that window is EMPTY does the query
 *             drop the horizon and show the latest five overall
 *             ("archive" mode, labelled so old shows don't read as
 *             recent). A non-empty short recent list is never topped up
 *             with older rows.
 *
 * All boundaries are absolute UTC instants (`now` ± ms), never server-
 * local or calendar-day floors — see CLAUDE.md "Date & Time".
 */

export const HOME_TAKE = 5;
export const ONGOING_BUFFER_MS = 12 * 60 * 60 * 1000;
export const HOME_PAST_WINDOW_MS = 30 * MS_PER_DAY;

// Everything a home card renders, plus the logo inputs. Translations are
// loaded for every locale so one cache entry serves ja/ko/en.
const HOME_EVENT_SELECT = {
  id: true,
  slug: true,
  startTime: true,
  engagementOpensAt: true,
  originalName: true,
  originalShortName: true,
  originalLanguage: true,
  originalCity: true,
  originalVenue: true,
  translations: {
    select: {
      locale: true,
      name: true,
      shortName: true,
      city: true,
      venue: true,
    },
  },
  eventSeries: {
    select: {
      originalName: true,
      originalShortName: true,
      originalLanguage: true,
      translations: {
        select: { locale: true, name: true, shortName: true },
      },
    },
  },
  ...LOGO_EVENT_SELECT,
} as const;

/**
 * Song-bearing predicate for the past section. Mirrors the badge count
 * (`SONG_COUNT_WHERE`) so a card can never say "0 songs" in the archive.
 */
const HAS_VISIBLE_SONG = {
  setlistItems: { some: SONG_COUNT_WHERE },
} as const;

/**
 * Past-status predicate for `now`. Each branch carries its own startTime
 * range so a `completed` row dated in the future (data anomaly) can't
 * leak in, and a `scheduled` row only counts once the 12h ongoing buffer
 * has passed (mirrors `getEventStatus`; the boundary instant itself is
 * completed there, hence `lte`). `since` adds the 30-day lower bound.
 */
function pastStatusWhere(now: Date, since: Date | null) {
  const completedCutoff = new Date(now.getTime() - ONGOING_BUFFER_MS);
  const from = since ? { gte: since } : {};
  return {
    OR: [
      { status: "completed" as const, startTime: { ...from, lte: now } },
      {
        status: "scheduled" as const,
        startTime: { ...from, lte: completedCutoff },
      },
    ],
  };
}

type HomeEventDbRow = Awaited<ReturnType<typeof findOngoing>>[number];

function findOngoing(now: Date) {
  const ongoingStart = new Date(now.getTime() - ONGOING_BUFFER_MS);
  return prisma.event.findMany({
    where: {
      isDeleted: false,
      OR: [
        { status: "ongoing" },
        {
          status: "scheduled",
          // startTime === now-12h is already completed (see above), so
          // `gt` here and `lte` in the past predicate.
          startTime: { gt: ongoingStart, lte: now },
        },
      ],
    },
    select: HOME_EVENT_SELECT,
    orderBy: { startTime: "asc" },
  });
}

function findUpcoming(now: Date) {
  return prisma.event.findMany({
    where: {
      isDeleted: false,
      status: "scheduled",
      startTime: { gt: now },
    },
    select: HOME_EVENT_SELECT,
    orderBy: { startTime: "asc" },
    take: HOME_TAKE,
  });
}

function findPast(now: Date, since: Date | null) {
  return prisma.event.findMany({
    where: {
      isDeleted: false,
      ...HAS_VISIBLE_SONG,
      ...pastStatusWhere(now, since),
    },
    select: HOME_EVENT_SELECT,
    // id breaks ties so two shows at the same instant keep a stable order.
    orderBy: [{ startTime: "desc" }, { id: "desc" }],
    take: HOME_TAKE,
  });
}

/** `recent` = within 30 days; `archive` = older fallback; `none` = no rows. */
export type HomePastMode = "recent" | "archive" | "none";

/**
 * Recent-first past selection. The archive query runs only when the
 * recent window returned nothing — never to fill a short list.
 */
export async function findPastWithFallback(now: Date) {
  const recent = await findPast(
    now,
    new Date(now.getTime() - HOME_PAST_WINDOW_MS),
  );
  if (recent.length > 0) return { mode: "recent" as const, rows: recent };
  const archive = await findPast(now, null);
  return {
    mode: archive.length > 0 ? ("archive" as const) : ("none" as const),
    rows: archive,
  };
}

/**
 * Visible song-bearing item count per event, one batched aggregate for
 * every card that shows a count (a per-row `_count` would emit repeated
 * identical spans that Sentry's N+1 detector flags).
 */
async function countSongs(eventIds: bigint[]): Promise<Map<string, number>> {
  if (eventIds.length === 0) return new Map();
  const groups = await prisma.setlistItem.groupBy({
    by: ["eventId"],
    where: { ...SONG_COUNT_WHERE, eventId: { in: eventIds } },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [String(g.eventId), g._count._all]));
}

type NameRow = { locale: string; name: string; shortName: string | null };

/**
 * Cache-safe, locale-independent card row. The logo inputs (asset row,
 * artist colour, series id) are resolved here and dropped: only the
 * public projection crosses into the cache and on to the client.
 */
// A type alias (not an interface) so it satisfies the
// `Record<string, unknown>` bound of `resolveLocalizedField`.
export type HomeEvent = {
  id: string;
  slug: string;
  startTime: string;
  engagementOpensAt: string | null;
  originalName: string;
  originalShortName: string | null;
  originalLanguage: string;
  originalCity: string | null;
  originalVenue: string | null;
  translations: (NameRow & { city: string | null; venue: string | null })[];
  eventSeries: {
    originalName: string;
    originalShortName: string | null;
    originalLanguage: string;
    translations: NameRow[];
  } | null;
  logo: PublicLogo;
  /** Visible song-bearing items; null where the section shows no count. */
  songCount: number | null;
};

function toHomeEvent(
  row: HomeEventDbRow,
  graph: LogoSeriesGraph,
  songCount: number | null,
): HomeEvent {
  return {
    id: String(row.id),
    slug: row.slug,
    startTime: row.startTime.toISOString(),
    engagementOpensAt: row.engagementOpensAt?.toISOString() ?? null,
    originalName: row.originalName,
    originalShortName: row.originalShortName,
    originalLanguage: row.originalLanguage,
    originalCity: row.originalCity,
    originalVenue: row.originalVenue,
    translations: row.translations,
    eventSeries: row.eventSeries,
    logo: resolveEventLogo(row, graph),
    songCount,
  };
}

export interface HomeData {
  ongoing: HomeEvent[];
  upcoming: HomeEvent[];
  past: HomeEvent[];
  pastMode: HomePastMode;
}

/**
 * Every home query against one reference instant, so an event near a
 * boundary is classified consistently across sections. The caller wraps
 * this in the home `cachedQuery` (and passes the cached series graph),
 * which is what makes logo edits — all of which call
 * `revalidatePublicData()` — refresh the home together with the graph.
 */
export async function loadHomeData(
  now: Date,
  graph: LogoSeriesGraph,
): Promise<HomeData> {
  const [ongoing, upcoming, past] = await Promise.all([
    findOngoing(now),
    findUpcoming(now),
    findPastWithFallback(now),
  ]);
  const counts = await countSongs([
    ...ongoing.map((e) => e.id),
    ...past.rows.map((e) => e.id),
  ]);
  const count = (id: bigint) => counts.get(String(id)) ?? 0;
  return {
    ongoing: ongoing.map((e) => toHomeEvent(e, graph, count(e.id))),
    upcoming: upcoming.map((e) => toHomeEvent(e, graph, null)),
    past: past.rows.map((e) => toHomeEvent(e, graph, count(e.id))),
    pastMode: past.mode,
  };
}

/*
 * The home page's whole DB footprint, cached as one unit per 5-minute
 * bucket. Home is the most-hit route (uptime probe, every crawler's
 * entry point, every fan opening the site at show time), and every list
 * on it is "relative to now" — so the key is the bucket start, not `now`
 * itself (a raw timestamp would make every request a miss). The bucket
 * instant is also the reference time for the queries, so an event moves
 * from upcoming to ongoing at the first bucket boundary at/after its
 * startTime, i.e. up to `CACHE_TTL.home` late. The event page itself
 * resolves status with the real clock.
 *
 * Logos are resolved inside the entry (ticket 07 contract): the series
 * graph is itself a cached public read, and every logo/series/event/
 * artist writer calls `revalidatePublicData()`, which expires this entry
 * and the graph together. Locale-independent (all translations are
 * loaded), so one entry serves ja/ko/en. The key changed with the
 * entry's shape so a deploy never decodes an old-shape value.
 */
export const getCachedHomeData = cachedQuery(
  "home-events-v2",
  async (bucketMs: number) =>
    loadHomeData(new Date(bucketMs), await getLogoSeriesGraph()),
  { revalidate: CACHE_TTL.home },
);
