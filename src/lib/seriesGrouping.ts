import { resolveLocalizedField } from "@/lib/display";
import { getEventStatus } from "@/lib/eventStatus";

/**
 * Event shape accepted by `groupByCity` and `getSeriesStats`. Unions
 * cover both the raw Prisma row (BigInt id, Date startTime/date) and
 * the post-`serializeBigInt` shape (number/string/string). The page
 * passes the RAW Prisma row to preserve precision on autoincrementing
 * BigInt IDs that would lose bits during `Number(BigInt)` narrowing
 * for IDs > 2^53.
 */
export interface SeriesEventInput {
  id: number | string | bigint;
  slug: string;
  status: "scheduled" | "ongoing" | "completed" | "cancelled";
  date: string | Date | null;
  startTime: string | Date;
  // Identity-name fields needed by `displayNameWithFallback` so the
  // page doesn't have to fabricate synthetic objects with hard-coded
  // `originalLanguage: "ja"` (wrong for non-Japanese series).
  originalName: string | null;
  originalShortName: string | null;
  originalLanguage: string;
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
    // Normalize to epoch ms so comparison works regardless of whether
    // `startTime` is a Date (raw Prisma row) or an ISO string (post-
    // serialize). Output stays as ISO string for `formatDateRange`.
    const startMs = bucketEvents.map((e) => new Date(e.startTime).getTime());
    const start = new Date(Math.min(...startMs)).toISOString();
    const end = new Date(Math.max(...startMs)).toISOString();
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
