import { resolveLocalizedField } from "@/lib/display";
import { getEventStatus } from "@/lib/eventStatus";

/**
 * Post-`serializeBigInt` event shape consumed by `groupByCity` and
 * `getSeriesStats`. BigInt has been narrowed to JS `number` and Date
 * to ISO string at runtime (JSON round-trip in serializeBigInt). The
 * page caller hoists ONE `as unknown as SeriesEventInput[]` cast at
 * fetch time — the `unknown` step is intentional because Prisma's
 * pre-serialize type still says `bigint`/`Date` even though runtime
 * is `number`/`string`. Single cast > scattered ones.
 */
export interface SeriesEventInput {
  id: number;
  slug: string;
  status: "scheduled" | "ongoing" | "completed" | "cancelled";
  date: string | null;
  startTime: string;
  originalCity: string | null;
  originalVenue: string | null;
  translations: Array<{
    locale: string;
    name: string;
    shortName: string | null;
    city: string | null;
    venue: string | null;
  }>;
}

export interface Leg {
  /** Locale-resolved city. Falls back to `originalCity`, then "" if neither is set. */
  city: string;
  /** Locale-resolved venue from the *first* event in the leg. Most tours
   *  play the same venue for both Day.1/Day.2; multi-venue legs are rare. */
  venue: string | null;
  events: SeriesEventInput[];
  /** True when at least one event in the leg currently resolves to "ongoing". */
  hasOngoing: boolean;
  /** Earliest + latest `startTime` ISO strings within the leg. Caller
   *  formats via `formatDateRange` for display. */
  dateRange: { start: string; end: string };
}

/**
 * Group a series's events by city, sorted with ongoing-pinned legs at
 * the top of the tour. Empty `city` strings (events with no city
 * translation AND no `originalCity`) bucket under "" so the operator
 * can spot the data gap; rendering layer is responsible for showing
 * a meaningful placeholder.
 *
 * Within-leg event order is preserved from the input. The page query
 * already orders by `date asc, startTime asc`, so legs come out
 * chronologically inside each bucket.
 */
export function groupByCity(
  events: SeriesEventInput[],
  locale: string,
  referenceNow: Date,
): Leg[] {
  const buckets = new Map<string, SeriesEventInput[]>();
  for (const ev of events) {
    const city =
      resolveLocalizedField(
        ev as unknown as Record<string, unknown>,
        ev.translations,
        locale,
        "city",
        "originalCity",
      ) ?? "";
    const list = buckets.get(city);
    if (list) list.push(ev);
    else buckets.set(city, [ev]);
  }

  const legs: Leg[] = [];
  for (const [city, bucketEvents] of buckets) {
    // Stable: preserve input order. earliest = first event's startTime;
    // latest = last event's startTime (input is already date-sorted).
    const startTimes = bucketEvents.map((e) => e.startTime);
    const start = startTimes.reduce((min, t) => (t < min ? t : min));
    const end = startTimes.reduce((max, t) => (t > max ? t : max));
    const venue = resolveLocalizedField(
      bucketEvents[0] as unknown as Record<string, unknown>,
      bucketEvents[0].translations,
      locale,
      "venue",
      "originalVenue",
    );
    const hasOngoing = bucketEvents.some(
      (e) => getEventStatus(e, referenceNow) === "ongoing",
    );
    legs.push({ city, venue, events: bucketEvents, hasOngoing, dateRange: { start, end } });
  }

  // Sort: ongoing-pinned first; within each band, earliest start asc.
  // Legs that share `hasOngoing` keep tour-forward order.
  legs.sort((a, b) => {
    if (a.hasOngoing !== b.hasOngoing) return a.hasOngoing ? -1 : 1;
    return a.dateRange.start.localeCompare(b.dateRange.start);
  });
  return legs;
}
