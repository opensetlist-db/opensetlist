import { displayNameWithFallback, resolveLocalizedField } from "../display";
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

export function cardContent(event: CardEvent, locale: CardLocale) {
  const eventTitle = displayNameWithFallback(event, event.translations, locale);
  const seriesTitle = event.eventSeries
    ? displayNameWithFallback(event.eventSeries, event.eventSeries.translations, locale) : "";
  const title = seriesTitle || eventTitle;
  if (!title.trim()) throw new Error("공식 공연명이 없습니다.");
  const artist = event.artist
    ? displayNameWithFallback(event.artist, event.artist.translations, locale) : "";
  return {
    eventId: event.id,
    locale,
    officialEventTitle: event.originalName,
    officialSeriesTitle: event.eventSeries?.originalName ?? null,
    localizedEventTitle: eventTitle,
    localizedSeriesTitle: seriesTitle,
    title,
    performance: seriesTitle && seriesTitle !== eventTitle ? eventTitle : "",
    context: artist && !title.includes(artist) && !eventTitle.includes(artist) ? artist : "",
    date: formatVenueDate(event.date, locale),
    venue: resolveLocalizedField(event, event.translations, locale, "venue", "originalVenue") ?? "",
  };
}
export type CardContent = ReturnType<typeof cardContent>;
