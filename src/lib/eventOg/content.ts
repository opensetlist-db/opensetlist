import { resolveDisplayPair } from "../display";
import { shareName } from "../shareNames";
import { formatVenueDate } from "../eventDateTime";

export const CARD_LOCALES = ["ja", "ko", "en"] as const;
export const CARD_MODES = ["prediction", "live", "setlist"] as const;
export type CardLocale = typeof CARD_LOCALES[number];
export type CardMode = typeof CARD_MODES[number];

type Named = {
  originalName: string;
  originalLanguage: string;
  translations: { locale: string; name: string; venue?: string | null }[];
};
export type CardEvent = Named & {
  id: string;
  slug: string;
  date: string | null;
  originalVenue: string | null;
  eventSeries: Named | null;
  artist: Named | null;
};

/** Resolve the paired labels once for the preview, its metadata, and the frozen publication. */
export function cardContent(event: CardEvent, locale: CardLocale) {
  const eventName = shareName(event, locale, "title");
  const seriesName = event.eventSeries ? shareName(event.eventSeries, locale, "title") : null;
  const title = seriesName?.main ? seriesName : eventName;
  if (!title.main.trim()) throw new Error("공식 공연명이 없습니다.");
  const performance = seriesName?.main && (seriesName.main !== eventName.main || seriesName.sub !== eventName.sub)
    ? eventName : null;
  const artist = event.artist ? shareName(event.artist, locale) : null;
  const context = artist?.main && ![title, eventName].some((name) =>
    name.main.includes(artist.main) && (!artist.sub || name.sub?.includes(artist.sub))
  ) ? artist : null;
  const { main: venueOriginal, sub: venueLocal } = resolveDisplayPair(
    { original: event.originalVenue ?? "", originalLanguage: event.originalLanguage },
    event.translations, locale, "venue",
  );
  const venue = venueOriginal ? { main: venueOriginal, sub: venueLocal, lang: event.originalLanguage }
    : venueLocal ? { main: venueLocal, sub: null, lang: locale } : null;

  return {
    eventId: event.id,
    locale,
    officialEventTitle: event.originalName,
    officialSeriesTitle: event.eventSeries?.originalName ?? null,
    localizedEventTitle: eventName.sub ?? eventName.main,
    localizedSeriesTitle: seriesName?.sub ?? seriesName?.main ?? "",
    names: { event: eventName, series: seriesName, venue, artist: context },
    title: title.main,
    titleSub: title.sub,
    performance: performance?.main ?? "",
    performanceSub: performance?.sub ?? null,
    context: context?.main ?? "",
    contextSub: context?.sub ?? null,
    date: formatVenueDate(event.date, locale),
    venue: venue?.main ?? "",
    venueSub: venue?.sub ?? null,
  };
}
export type CardContent = ReturnType<typeof cardContent>;
