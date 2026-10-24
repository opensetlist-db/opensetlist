import { displayNameWithFallback, resolveLocalizedField } from "@/lib/display";
import { eventHref } from "@/lib/eventHref";
import { daysUntil, shouldShowWishBadge } from "@/lib/eventTiming";
import type { HomeEvent } from "@/lib/homeEvents";
import { formatDate, nonBlank } from "@/lib/utils";

/*
 * Locale projection of a cached `HomeEvent` into what a home card shows
 * (14-v1 contract, "Upcoming" / "Past"):
 *
 *   title     the series' full name when the event belongs to one, else
 *             the event's own full name — never truncated, the card
 *             wraps it.
 *   dayLabel  the event's own name (e.g. "Day.1") when a series title
 *             is shown above, so multi-day shows stay distinguishable.
 *             It is live text in the card body, never part of the art.
 *   artTitle  short name for the typography fallback in the art slot.
 *   place     "city · venue", whichever parts exist.
 *   tint      the 07 representative colour, washed into the art slot
 *             background by EventArt (text tones stay fixed), as on the
 *             concert list.
 *   dateLabel year + 2-digit month/day + weekday, formatted in UTC so the
 *             printed day is the stored UTC startTime's day (same as the
 *             pre-redesign home and the concert list).
 */

export const HOME_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  timeZone: "UTC",
};

export interface HomeCardView {
  id: string;
  href: string;
  startTimeIso: string;
  dateLabel: string;
  title: string;
  dayLabel: string | null;
  artTitle: string;
  place: string | null;
  logoUrl: string | null;
  /** 07 representative colour for EventArt's background wash; null = neutral. */
  tint: string | null;
  songCount: number | null;
}

export interface UpcomingCardView extends HomeCardView {
  /** Whole 24h periods until start, from the cache bucket instant. */
  daysLeft: number;
  /** Same open-window rule as the event page (D-7 default or override). */
  showWishBadge: boolean;
}

export function projectHomeCard(
  event: HomeEvent,
  locale: string,
  unknownName: string,
): HomeCardView {
  const eventFull = nonBlank(
    displayNameWithFallback(event, event.translations, locale, "full"),
  );
  const eventShort = nonBlank(
    displayNameWithFallback(event, event.translations, locale, "short"),
  );
  const series = event.eventSeries;
  const seriesFull = series
    ? nonBlank(
        displayNameWithFallback(series, series.translations, locale, "full"),
      )
    : null;
  const seriesShort = series
    ? nonBlank(
        displayNameWithFallback(series, series.translations, locale, "short"),
      )
    : null;

  const title = seriesFull ?? eventFull ?? unknownName;
  const city = resolveLocalizedField(
    event,
    event.translations,
    locale,
    "city",
    "originalCity",
  );
  const venue = resolveLocalizedField(
    event,
    event.translations,
    locale,
    "venue",
    "originalVenue",
  );
  const place = [city, venue].filter((v): v is string => !!nonBlank(v));

  return {
    id: event.id,
    href: eventHref(locale, event.id, event.slug),
    startTimeIso: event.startTime,
    dateLabel: formatDate(event.startTime, locale, HOME_DATE_FORMAT),
    title,
    // Only a series-titled card needs the event name as its day label;
    // a standalone event's own name is already the title.
    dayLabel: seriesFull ? eventFull : null,
    artTitle: seriesShort ?? eventShort ?? title,
    place: place.length > 0 ? place.join(" · ") : null,
    logoUrl: event.logo.image?.url ?? null,
    tint: event.logo.color,
    songCount: event.songCount,
  };
}

export function projectUpcomingCard(
  event: HomeEvent,
  locale: string,
  unknownName: string,
  now: Date,
): UpcomingCardView {
  const start = new Date(event.startTime);
  return {
    ...projectHomeCard(event, locale, unknownName),
    daysLeft: daysUntil(start, now),
    showWishBadge: shouldShowWishBadge(start, now, event.engagementOpensAt),
  };
}
