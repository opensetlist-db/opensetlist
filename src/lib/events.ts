import { prisma } from "@/lib/prisma";
import { serializeBigInt, pickTranslation } from "@/lib/utils";
import { getEventStatus } from "@/lib/eventStatus";

type SeriesTranslation = {
  locale: string;
  name: string;
  shortName: string | null;
  description: string | null;
};

type SeriesNode = {
  id: number;
  translations: SeriesTranslation[];
  parentSeries: SeriesNode | null;
};

type EventTranslation = {
  locale: string;
  name: string;
};

export type EventForList = {
  id: number;
  status: "scheduled" | "ongoing" | "completed" | "cancelled";
  date: string | null;
  startTime: string;
  translations: EventTranslation[];
  eventSeries: SeriesNode | null;
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

function getRootSeries(s: SeriesNode): SeriesNode {
  let cur = s;
  while (cur.parentSeries) cur = cur.parentSeries;
  return cur;
}

function groupBySeries(
  events: EventForList[],
  locale: string,
  sectionSort: "asc" | "desc",
): EventGroup[] {
  const groups = new Map<string, EventGroup>();
  const UNGROUPED = "__ungrouped__";

  for (const ev of events) {
    const root = ev.eventSeries ? getRootSeries(ev.eventSeries) : null;
    const key = root ? String(root.id) : UNGROUPED;
    const existing = groups.get(key);
    if (existing) {
      existing.events.push(ev);
    } else {
      const name = root
        ? pickTranslation(root.translations, locale)?.name ?? null
        : null;
      groups.set(key, {
        seriesId: root ? String(root.id) : null,
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
  const events = await prisma.event.findMany({
    where: { isDeleted: false },
    include: {
      translations: true,
      eventSeries: {
        include: {
          translations: true,
          parentSeries: {
            include: {
              translations: true,
              parentSeries: {
                include: { translations: true },
              },
            },
          },
        },
      },
    },
    orderBy: { startTime: "asc" },
  });

  const serialized = serializeBigInt(events) as unknown as EventForList[];

  const ongoing: EventForList[] = [];
  const upcoming: EventForList[] = [];
  const past: EventForList[] = [];

  for (const ev of serialized) {
    const resolved = getEventStatus(ev, referenceNow);
    if (resolved === "ongoing") ongoing.push(ev);
    else if (resolved === "upcoming") upcoming.push(ev);
    else past.push(ev);
  }

  return {
    ongoingGroups: groupBySeries(ongoing, locale, "asc"),
    upcomingGroups: groupBySeries(upcoming, locale, "asc"),
    pastGroups: groupBySeries(past, locale, "desc"),
  };
}
