import { getTranslations } from "next-intl/server";
import { colors, radius } from "@/styles/tokens";
import {
  PerformanceGroup,
  type PerformanceEvent,
  type PerformanceSeries,
} from "@/components/PerformanceGroup";
import { getEventStatus, type ResolvedEventStatus } from "@/lib/eventStatus";
import { formatDate } from "@/lib/utils";
import { displayNameWithFallback } from "@/lib/display";
import { AlbumType } from "@/generated/prisma/enums";
import type { RelatedEvent } from "@/lib/albumRelatedEvents";

/*
 * Related-events tab content for the Album page (b04). Consumes the
 * already-fetched RelatedEvent[] from getAlbumRelatedEvents and
 * renders a series-grouped collapsible list of events via the shared
 * <PerformanceGroup> primitive (the same one Artist / Song / Member /
 * Series pages use for their history tabs — keeps the visual rhythm
 * consistent across detail pages).
 *
 * Type-aware subtitle string:
 *   live_album → "Events linked to this BD"
 *   else       → "Events where these tracks were performed"
 *
 * Grouping shape mirrors the song-page history tab exactly:
 *   - Per-series bucket sorted desc-by-date inside the bucket
 *   - Series bucket sortKey = MAX_SAFE_INTEGER when any event is
 *     ongoing (ongoing-pinned), else most-recent-event timestamp
 *   - Events with no eventSeries land in a synthetic "Other" bucket
 *     pinned to the end (sortKey 0) so standalone events stay
 *     discoverable instead of disappearing from the list
 */

interface Props {
  events: RelatedEvent[];
  albumType: AlbumType | string;
  locale: string;
}

export async function AlbumRelatedEventsTab({
  events,
  albumType,
  locale,
}: Props) {
  const tNs = await getTranslations({ locale, namespace: "Album.events" });
  const et = await getTranslations({ locale, namespace: "Event" });
  // Series-namespace translator covers the per-bucket series-header
  // fallback when the row carries no translated name — Event.unknownEvent
  // reads as an event label and would confuse the series-context
  // header. The synthetic "Other" bucket still uses Event.ungrouped
  // below: that label is event-context ("events with no series"), and
  // EventSeries doesn't ship an equivalent key.
  const st = await getTranslations({ locale, namespace: "EventSeries" });

  if (events.length === 0) {
    return (
      <div
        style={{
          background: colors.bgCard,
          borderRadius: radius.card,
          padding: "32px 20px",
          textAlign: "center",
          color: colors.textMuted,
          fontSize: 14,
        }}
      >
        {tNs("empty")}
      </div>
    );
  }

  const referenceNow = new Date();

  // PerformanceGroup is locale-agnostic by design — it accepts a
  // pre-resolved statusLabels map so the component stays out of
  // next-intl. Mirror the song page's mapping (ongoing → "LIVE"
  // instead of "진행중" to match the row-shaped status pill UX).
  const statusLabels: Record<ResolvedEventStatus, string> = {
    ongoing: et("live"),
    upcoming: et("status.upcoming"),
    completed: et("status.completed"),
    cancelled: et("status.cancelled"),
  };

  // Flat per-event view-model, with the series id/name extracted so the
  // grouping pass below doesn't have to traverse the nested relation
  // again. rawDateMs is the sort key inside + across buckets.
  //
  // seriesId is stored as a string straight through — every consumer
  // below already coerces it back via String(...) for Map keys and
  // PerformanceSeries.seriesId, and the source value is a
  // serializeBigInt result that's lossy at >2^53. Keeping it as a
  // string preserves precision without the pointless Number round-trip.
  type EventView = PerformanceEvent & {
    seriesId: string | null;
    seriesName: string | null;
    rawDateMs: number;
  };

  const views: EventView[] = events.map((event) => {
    const status = getEventStatus(
      { status: event.status, startTime: event.startTime },
      referenceNow,
    );
    const seriesId = event.eventSeries ? String(event.eventSeries.id) : null;
    const seriesName = event.eventSeries
      ? displayNameWithFallback(
          event.eventSeries,
          event.eventSeries.translations,
          locale,
        ) || null
      : null;
    const eventName =
      displayNameWithFallback(event, event.translations, locale) ||
      et("unknownEvent");
    return {
      id: String(event.id),
      seriesId,
      seriesName,
      status,
      // event.date is nullable per schema; formatDate is null-safe
      // (returns "" on null) but an empty cell looks like missing data
      // to a viewer. Fall back to event.startTime (NOT NULL) so the
      // row always carries the display timestamp the event actually
      // happened at — same source the sort key uses below.
      formattedDate: formatDate(event.date ?? event.startTime, locale),
      name: eventName,
      href: `/${locale}/events/${event.id}/${event.slug}`,
      // sort key uses event.startTime (NOT NULL per schema) rather
      // than event.date (nullable — `new Date("null").getTime()` is
      // NaN, which would break the in-bucket sort + the mostRecentMs
      // reduce below).
      rawDateMs: new Date(String(event.startTime)).getTime(),
    };
  });

  // Group by series id; events with seriesId === null bucket into the
  // synthetic "Other" group pinned at the end.
  const seriesBuckets = new Map<string, EventView[]>();
  const ungrouped: EventView[] = [];
  for (const view of views) {
    if (view.seriesId === null) {
      ungrouped.push(view);
      continue;
    }
    const bucket = seriesBuckets.get(view.seriesId);
    if (bucket) bucket.push(view);
    else seriesBuckets.set(view.seriesId, [view]);
  }

  type AlbumSeriesView = PerformanceSeries & { sortKey: number };
  const seriesViews: AlbumSeriesView[] = [];
  for (const bucket of seriesBuckets.values()) {
    bucket.sort((a, b) => b.rawDateMs - a.rawDateMs);
    const hasOngoing = bucket.some((v) => v.status === "ongoing");
    const mostRecentMs = bucket.reduce(
      (m, v) => (v.rawDateMs > m ? v.rawDateMs : m),
      0,
    );
    // bucket[0].seriesId is non-null here by construction — the loop
    // above only inserts into seriesBuckets when view.seriesId !==
    // null, so the non-null assertion documents that invariant.
    seriesViews.push({
      seriesId: bucket[0].seriesId!,
      // Series header fallback — use the EventSeries namespace's
      // unknownSeries label rather than Event.unknownEvent so the
      // unnamed-series header doesn't accidentally read as "Unknown
      // Event" (CR-driven fix; the header is a series-context label,
      // not an event one).
      seriesShort: bucket[0].seriesName ?? st("unknownSeries"),
      hasOngoing,
      events: bucket,
      sortKey: hasOngoing ? Number.MAX_SAFE_INTEGER : mostRecentMs,
    });
  }
  seriesViews.sort((a, b) => b.sortKey - a.sortKey);

  if (ungrouped.length > 0) {
    ungrouped.sort((a, b) => b.rawDateMs - a.rawDateMs);
    seriesViews.push({
      seriesId: "ungrouped",
      seriesShort: et("ungrouped"),
      hasOngoing: ungrouped.some((v) => v.status === "ongoing"),
      events: ungrouped,
      sortKey: 0,
    });
  }

  const subtitle =
    albumType === AlbumType.live_album
      ? tNs("subtitle.bd")
      : tNs("subtitle.songsAppeared");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p
        style={{
          margin: "0 0 4px",
          fontSize: 13,
          color: colors.textSubtle,
        }}
      >
        {subtitle}
      </p>
      <div
        style={{
          background: colors.bgCard,
          borderRadius: radius.card,
          overflow: "hidden",
        }}
      >
        {seriesViews.map((series) => (
          <PerformanceGroup
            key={series.seriesId}
            series={series}
            statusLabels={statusLabels}
            eventCountLabel={tNs("eventCountLabel", {
              count: series.events.length,
            })}
          />
        ))}
      </div>
    </div>
  );
}
