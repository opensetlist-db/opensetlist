import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { displayNameWithFallback } from "@/lib/display";
import { getEventStatus } from "@/lib/eventStatus";

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
  seriesId: string | null;
  seriesName: string | null;
  /**
   * Resolved short name of the root series's artist for the requested
   * locale. Drives the small artist pill at the start of each
   * series-header badge row. Null in two distinct cases:
   *   1. The series has no `artistId` (multi-artist festival — the
   *      relation is null end-to-end).
   *   2. The fallback chain in `displayNameWithFallback` exhausts
   *      without finding a non-empty value (locale shortName → locale
   *      name → originalShortName → originalName all blank); the
   *      empty-string return is coerced to null below so the
   *      consuming components can branch on a single nullish check.
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
   * Series with at least one active event (ongoing, upcoming, or a
   * future-dated cancelled show). All events of the series are kept
   * here so the user sees the full tour together — including
   * already-completed earlier days alongside today's ongoing show.
   */
  activeGroups: EventsListGroup[];
  /**
   * Series whose events have all already happened (completed or
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

const UNGROUPED_KEY = "__ungrouped__";

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
        _count: { select: { setlistItems: true } },
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

  // Group all events by root series id (no per-event status split). The
  // mockup shows mixed-status events from the same tour together — a
  // user looking at "Hasunosora 6th Live" wants to see today's ongoing
  // show next to yesterday's completed Day.1 and tomorrow's upcoming
  // Day.1, all in chronological order.
  const groupsMap = new Map<string, EventsListGroup>();

  for (const ev of events) {
    const rootId =
      ev.eventSeriesId != null
        ? getRootSeriesId(ev.eventSeriesId, ancestry)
        : null;
    const key = rootId != null ? String(rootId) : UNGROUPED_KEY;
    const existing = groupsMap.get(key);
    if (existing) {
      existing.events.push(ev);
    } else {
      const root = rootId != null ? ancestry.get(rootId) : null;
      const name = root
        ? displayNameWithFallback(root, root.translations, locale) || null
        : null;
      // Coerce empty-string returns from displayNameWithFallback to null
      // so the consuming components can branch on a single
      // `artistShortName != null` check. The fallback chain
      // (locale shortName → locale name → originalShortName →
      // originalName → "") only yields "" when every layer is missing.
      const artistShortName = root?.artist
        ? displayNameWithFallback(
            root.artist,
            root.artist.translations,
            locale,
            "short",
          ) || null
        : null;
      groupsMap.set(key, {
        seriesId: rootId != null ? String(rootId) : null,
        seriesName: name,
        artistShortName,
        events: [ev],
        earliestStart: 0,
        latestStart: 0,
        hasOngoing: false,
      });
    }
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
