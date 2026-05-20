import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { displayNameWithFallback } from "@/lib/display";
import { getEventStatus } from "@/lib/eventStatus";
import { SONG_COUNT_WHERE } from "@/lib/setlistCounts";

type SeriesTranslation = {
  locale: string;
  name: string;
  shortName: string | null;
};

type SeriesAncestor = {
  id: number;
  parentSeriesId: number | null;
  originalName: string | null;
  originalShortName: string | null;
  originalLanguage: string;
  translations: SeriesTranslation[];
  artist: {
    originalName: string | null;
    originalShortName: string | null;
    originalLanguage: string;
    translations: {
      locale: string;
      name: string;
      shortName: string | null;
    }[];
  } | null;
};

type ArtistForGroup = {
  id: number;
  originalName: string | null;
  originalShortName: string | null;
  originalLanguage: string;
  translations: {
    locale: string;
    name: string;
    shortName: string | null;
  }[];
};

type EventTranslation = {
  locale: string;
  name: string;
  shortName: string | null;
  city: string | null;
  venue: string | null;
};

export type EventForList = {
  id: number;
  eventSeriesId: number | null;
  // Primary artist for series-less events. Populated explicitly via the
  // admin form, or backfilled by prisma/post-deploy.sql when the
  // performer roster resolves to exactly one top-level artist.
  // Ignored when eventSeriesId is set (series grouping wins).
  artistId: number | null;
  // Display name for multi-artist standalone events. Only consulted
  // when eventSeriesId AND artistId are both null.
  organizerName: string | null;
  status: "scheduled" | "ongoing" | "completed" | "cancelled";
  date: string | null;
  startTime: string;
  originalName: string | null;
  originalShortName: string | null;
  originalLanguage: string;
  originalCity: string | null;
  originalVenue: string | null;
  translations: EventTranslation[];
  // Relational count of the event's setlist items. Cheap at launch
  // catalog scale (~60 events). Used by the events list page to render
  // "🎵 N" on completed events; profile before introducing a denormal
  // `Event.setlistItemCount` field.
  _count: { setlistItems: number };
};

export type EventsListGroup = {
  /**
   * What classifies this group:
   *   - "series"    — events share a (root) EventSeries
   *   - "artist"    — series-less events share an Event.artistId
   *                   (e.g. "Hasunosora 단독 공연" bucket)
   *   - "organizer" — series-less events share an Event.organizerName
   *                   (multi-artist standalone shows)
   *   - "ungrouped" — series-less, no artistId, no organizerName
   *                   (genuine catchall — empty in well-curated data)
   */
  kind: "series" | "artist" | "organizer" | "ungrouped";
  /**
   * Stable group key — used for React keys and pagination identifiers.
   * Encodes the kind so different kinds with the same identifier (rare
   * but possible, e.g. seriesId="7" vs artistId="7") never collide.
   */
  id: string;
  /**
   * Display title resolved for the requested locale:
   *   - kind=series    → root series's name (locale-resolved)
   *   - kind=artist    → artist's name (locale-resolved). The page wraps
   *                      this in a "{artist} — 단독 공연" template.
   *   - kind=organizer → organizerName as stored (no translation table)
   *   - kind=ungrouped → null (page renders the locale "기타 이벤트")
   */
  title: string | null;
  /**
   * Resolved short name of the artist that owns this group, for the
   * requested locale. Drives the small artist pill at the start of
   * each series-header badge row. Null when:
   *   - kind=series and the series has no artistId (multi-artist
   *     festival series — pill is hidden)
   *   - kind=artist|organizer|ungrouped (the title itself already
   *     carries the artist/organizer identity; rendering a parallel
   *     pill would be redundant)
   *   - the fallback chain in `displayNameWithFallback` exhausts
   *     without finding a non-empty value
   */
  artistShortName: string | null;
  events: EventForList[];
  earliestStart: number;
  latestStart: number;
  /**
   * True when at least one event in the group resolves to "ongoing"
   * status. Drives the LIVE pill + always-expanded behavior on the
   * SeriesSection / SeriesBlock header.
   */
  hasOngoing: boolean;
};

export type EventsListData = {
  /**
   * Groups with at least one active event (ongoing, upcoming, or a
   * future-dated cancelled show). All events of the group are kept
   * here so the user sees the full tour together — including
   * already-completed earlier days alongside today's ongoing show.
   */
  activeGroups: EventsListGroup[];
  /**
   * Groups whose events have all already happened (completed or
   * past-dated cancellations). Group sort: most recent tour first.
   */
  pastGroups: EventsListGroup[];
};

const MAX_SERIES_DEPTH = 32;

function getRootSeriesId(
  startId: number,
  ancestry: Map<number, SeriesAncestor>,
): number {
  let cur = startId;
  for (let i = 0; i < MAX_SERIES_DEPTH; i++) {
    const node = ancestry.get(cur);
    if (!node || node.parentSeriesId == null) return cur;
    cur = node.parentSeriesId;
  }
  return cur;
}

const UNGROUPED_KEY = "ungrouped";

/**
 * Group-key derivation for a single event. Precedence:
 *   1. eventSeriesId → series:{rootSeriesId}  (multi-day tour wins)
 *   2. artistId      → artist:{artistId}      (artist's standalone shows)
 *   3. organizerName → org:{normalized}       (multi-artist standalone)
 *   4. ungrouped catchall
 *
 * organizerName is normalized via trim — operator typos like
 * "Bandai Namco" vs " Bandai Namco " collapse to one bucket.
 * Empty/whitespace-only organizerName falls through to ungrouped.
 */
function groupKeyForEvent(
  ev: EventForList,
  ancestry: Map<number, SeriesAncestor>,
): { kind: EventsListGroup["kind"]; key: string; ref: string | null } {
  if (ev.eventSeriesId != null) {
    const rootId = getRootSeriesId(ev.eventSeriesId, ancestry);
    return { kind: "series", key: `series:${rootId}`, ref: String(rootId) };
  }
  if (ev.artistId != null) {
    return { kind: "artist", key: `artist:${ev.artistId}`, ref: String(ev.artistId) };
  }
  const org = ev.organizerName?.trim();
  if (org) {
    return { kind: "organizer", key: `org:${org}`, ref: org };
  }
  return { kind: "ungrouped", key: UNGROUPED_KEY, ref: null };
}

export async function getEventsListGrouped(
  locale: string,
  referenceNow: Date,
): Promise<EventsListData> {
  const [eventsRaw, seriesRaw] = await Promise.all([
    prisma.event.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        eventSeriesId: true,
        artistId: true,
        organizerName: true,
        status: true,
        date: true,
        startTime: true,
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
        // See `src/lib/setlistCounts.ts` for what `SONG_COUNT_WHERE`
        // includes / excludes and why. Without a filter, `_count`
        // returns every row, so the events-list "🎵 N" badge would
        // disagree with the event-detail header on the same event.
        _count: { select: { setlistItems: { where: SONG_COUNT_WHERE } } },
      },
      orderBy: { startTime: "asc" },
    }),
    prisma.eventSeries.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        parentSeriesId: true,
        originalName: true,
        originalShortName: true,
        originalLanguage: true,
        translations: {
          select: { locale: true, name: true, shortName: true },
        },
        // The artist pill in each series header reads the locale-resolved
        // shortName. `artistId` is nullable for multi-artist festivals —
        // the relation falls through to null and the pill is hidden.
        artist: {
          select: {
            originalName: true,
            originalShortName: true,
            originalLanguage: true,
            translations: {
              select: { locale: true, name: true, shortName: true },
            },
          },
        },
      },
    }),
  ]);

  const events = serializeBigInt(eventsRaw) as unknown as EventForList[];
  const seriesList = serializeBigInt(seriesRaw) as unknown as SeriesAncestor[];
  const ancestry = new Map(seriesList.map((s) => [s.id, s]));

  // Second-pass fetch: artists referenced by series-less events. Done
  // after the events query so we know which artistIds to look up
  // (typically a small set — Hasunosora, Nijigasaki, ... — even at
  // scale). A separate query keeps the main `findMany` lean and lets
  // us skip the join entirely when no event uses Event.artistId yet.
  const standaloneArtistIds = new Set<string>();
  for (const ev of events) {
    if (ev.eventSeriesId == null && ev.artistId != null) {
      standaloneArtistIds.add(String(ev.artistId));
    }
  }
  const artistMap = new Map<string, ArtistForGroup>();
  if (standaloneArtistIds.size > 0) {
    const artistsRaw = await prisma.artist.findMany({
      where: {
        id: { in: Array.from(standaloneArtistIds).map((id) => BigInt(id)) },
      },
      select: {
        id: true,
        originalName: true,
        originalShortName: true,
        originalLanguage: true,
        translations: {
          select: { locale: true, name: true, shortName: true },
        },
      },
    });
    for (const a of serializeBigInt(artistsRaw) as unknown as ArtistForGroup[]) {
      artistMap.set(String(a.id), a);
    }
  }

  // Group all events by their derived key. The mockup shows
  // mixed-status events from the same tour together — a user looking
  // at "Hasunosora 6th Live" wants to see today's ongoing show next
  // to yesterday's completed Day.1 and tomorrow's upcoming Day.2, all
  // in chronological order. Same intuition for the per-artist
  // "단독 공연" bucket: a user looking at "하스노소라 단독 공연"
  // wants the full chronology in one place.
  const groupsMap = new Map<string, EventsListGroup>();

  for (const ev of events) {
    const { kind, key, ref } = groupKeyForEvent(ev, ancestry);
    const existing = groupsMap.get(key);
    if (existing) {
      existing.events.push(ev);
      continue;
    }

    let title: string | null = null;
    let artistShortName: string | null = null;

    if (kind === "series" && ref != null) {
      const root = ancestry.get(Number(ref));
      title = root
        ? displayNameWithFallback(root, root.translations, locale) || null
        : null;
      // Coerce empty-string returns from displayNameWithFallback to null
      // so consuming components can branch on a single nullish check.
      // The fallback chain (locale shortName → locale name →
      // originalShortName → originalName → "") only yields "" when
      // every layer is missing.
      artistShortName = root?.artist
        ? displayNameWithFallback(
            root.artist,
            root.artist.translations,
            locale,
            "short",
          ) || null
        : null;
    } else if (kind === "artist" && ref != null) {
      const a = artistMap.get(ref);
      title = a ? displayNameWithFallback(a, a.translations, locale) || null : null;
      // No parallel pill for artist groups — the title is the artist.
    } else if (kind === "organizer" && ref != null) {
      title = ref;
    }

    groupsMap.set(key, {
      kind,
      id: key,
      title,
      artistShortName,
      events: [ev],
      earliestStart: 0,
      latestStart: 0,
      hasOngoing: false,
    });
  }

  const activeGroups: EventsListGroup[] = [];
  const pastGroups: EventsListGroup[] = [];
  const nowMs = referenceNow.getTime();

  for (const g of groupsMap.values()) {
    // Parse each startTime once. Sort + earliest/latest + the
    // cancelled-future check all reuse the cached numeric value.
    const dated = g.events.map((ev) => ({
      ev,
      ts: new Date(ev.startTime).getTime(),
    }));
    dated.sort((a, b) => a.ts - b.ts);
    g.events = dated.map((d) => d.ev);
    g.earliestStart = dated[0]?.ts ?? 0;
    g.latestStart = dated[dated.length - 1]?.ts ?? 0;

    let hasOngoing = false;
    let hasActive = false;
    for (const { ev, ts } of dated) {
      const resolved = getEventStatus(ev, referenceNow);
      if (resolved === "ongoing") {
        hasOngoing = true;
        hasActive = true;
      } else if (resolved === "upcoming") {
        hasActive = true;
      } else if (resolved === "cancelled") {
        // A cancelled-but-future show stays "active" so it appears in
        // the upcoming-aware section with its cancelled badge, matching
        // the per-event routing the previous helper used.
        if (ts >= nowMs) hasActive = true;
      }
    }
    g.hasOngoing = hasOngoing;

    if (hasActive) activeGroups.push(g);
    else pastGroups.push(g);
  }

  activeGroups.sort((a, b) => a.earliestStart - b.earliestStart);
  pastGroups.sort((a, b) => b.latestStart - a.latestStart);

  return { activeGroups, pastGroups };
}
