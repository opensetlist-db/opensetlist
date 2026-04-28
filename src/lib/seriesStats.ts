import { getEventStatus } from "@/lib/eventStatus";
import { resolveLocalizedField } from "@/lib/display";
import type { SeriesEventInput } from "@/lib/seriesGrouping";

export interface SeriesStats {
  total: number;
  completed: number;
  ongoing: number;
  upcoming: number;
  /**
   * Distinct city count for the active locale, falling back to
   * `originalCity` (matches the bucketing rule used by `groupByCity`,
   * so this number lines up with the leg-card count by construction).
   */
  totalCities: number;
}

/**
 * Pure derivation. Distinct songs + units come from server queries
 * since they require Prisma joins (SetlistItemSong + SetlistItemArtist).
 */
export function getSeriesStats(
  events: SeriesEventInput[],
  locale: string,
  referenceNow: Date,
): SeriesStats {
  let completed = 0;
  let ongoing = 0;
  let upcoming = 0;
  const cities = new Set<string>();
  for (const ev of events) {
    const status = getEventStatus(ev, referenceNow);
    if (status === "completed") completed++;
    else if (status === "ongoing") ongoing++;
    else if (status === "upcoming") upcoming++;
    // cancelled events stay in `total` only — surfaced by `total - (sum)`.
    const city =
      resolveLocalizedField(
        ev as unknown as Record<string, unknown>,
        ev.translations,
        locale,
        "city",
        "originalCity",
      ) ?? "";
    if (city.length > 0) cities.add(city);
  }
  return {
    total: events.length,
    completed,
    ongoing,
    upcoming,
    totalCities: cities.size,
  };
}
