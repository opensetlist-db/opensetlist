import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { displayNameWithFallback } from "@/lib/display";
import { getEventStatus } from "@/lib/eventStatus";

type SeriesTranslation = { locale: string; name: string; shortName: string | null };

type SeriesAncestor = {
  id: number;
  parentSeriesId: number | null;
  originalName: string | null;
  originalShortName: string | null;
  originalLanguage: string;
  translations: SeriesTranslation[];
};

type EventTranslation = {
  locale: string;
  name: string;
  shortName: string | null;
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
  translations: EventTranslation[];
};

export type EventGroup = {
  seriesId: string | null;
  seriesName: string | null;
  events: EventForList[];
  earliestStart: number;
  latestStart: number;
};

export type GroupedEvents = {
  ongoingGroups: EventGroup[];
  upcomingGroups: EventGroup[];
  pastGroups: EventGroup[];
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

function groupBySeries(
  events: EventForList[],
  locale: string,
  ancestry: Map<number, SeriesAncestor>,
  sectionSort: "asc" | "desc",
): EventGroup[] {
  const groups = new Map<string, EventGroup>();
  const UNGROUPED = "__ungrouped__";

  for (const ev of events) {
    const rootId =
      ev.eventSeriesId != null
        ? getRootSeriesId(ev.eventSeriesId, ancestry)
        : null;
    const key = rootId != null ? String(rootId) : UNGROUPED;
    const existing = groups.get(key);
    if (existing) {
      existing.events.push(ev);
    } else {
      const root = rootId != null ? ancestry.get(rootId) : null;
      const name = root
        ? displayNameWithFallback(root, root.translations, locale) || null
        : null;
      groups.set(key, {
        seriesId: rootId != null ? String(rootId) : null,
        seriesName: name,
        events: [ev],
        earliestStart: 0,
        latestStart: 0,
      });
    }
  }

  for (const g of groups.values()) {
    g.events.sort(
      (a, b) =>
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    );
    const times = g.events.map((e) => new Date(e.startTime).getTime());
    g.earliestStart = times.length ? Math.min(...times) : 0;
    g.latestStart = times.length ? Math.max(...times) : 0;
  }

  return [...groups.values()].sort((a, b) =>
    sectionSort === "asc"
      ? a.earliestStart - b.earliestStart
      : b.latestStart - a.latestStart,
  );
}

export async function getAllEventsGrouped(
  locale: string,
  referenceNow: Date,
): Promise<GroupedEvents> {
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
        translations: {
          select: { locale: true, name: true, shortName: true },
        },
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
      },
    }),
  ]);

  const events = serializeBigInt(eventsRaw) as unknown as EventForList[];
  const seriesList = serializeBigInt(seriesRaw) as unknown as SeriesAncestor[];
  const ancestry = new Map(seriesList.map((s) => [s.id, s]));

  const ongoing: EventForList[] = [];
  const upcoming: EventForList[] = [];
  const past: EventForList[] = [];

  for (const ev of events) {
    const resolved = getEventStatus(ev, referenceNow);
    if (resolved === "ongoing") {
      ongoing.push(ev);
    } else if (resolved === "upcoming") {
      upcoming.push(ev);
    } else if (resolved === "cancelled") {
      // Route by startTime so a cancelled-but-not-yet-happened show stays in
      // Upcoming (with the cancelled badge); only past-dated cancellations
      // drop into Past.
      const startMs = new Date(ev.startTime).getTime();
      if (startMs >= referenceNow.getTime()) upcoming.push(ev);
      else past.push(ev);
    } else {
      past.push(ev);
    }
  }

  return {
    ongoingGroups: groupBySeries(ongoing, locale, ancestry, "asc"),
    upcomingGroups: groupBySeries(upcoming, locale, ancestry, "asc"),
    pastGroups: groupBySeries(past, locale, ancestry, "desc"),
  };
}
