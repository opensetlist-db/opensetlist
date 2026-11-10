import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AlbumType } from "@/generated/prisma/enums";
import type { RelatedEvent } from "@/lib/albumRelatedEvents";
import { resolveDisplayPair } from "@/lib/display";
import { getEventStatus, type ResolvedEventStatus } from "@/lib/eventStatus";
import { entityPath } from "@/lib/seo/entityUrl";
import { formatDate } from "@/lib/utils";
import { ALBUM_DATE_FORMAT } from "./albumDate";
import styles from "./albumDetail.module.css";

/*
 * Related-events tab of the Album detail page (22-v1): series-grouped,
 * collapsible sections of event rows (status + date, name + venue).
 *
 * The data rules are the pre-redesign tab's, unchanged:
 *   - Rows come from `getAlbumRelatedEvents` (live_album → Event.bdAlbumId;
 *     audio → events whose setlists contain the album's vocal songs),
 *     capped at 50 there; the tab badge shows the full COUNT.
 *   - Inside a series, newest first by `startTime` (NOT NULL; `date` is
 *     nullable and is only the display value).
 *   - Series order: a series with an ongoing event is pinned first, the
 *     rest by their newest event; events without a series form the
 *     "Other" section, always last.
 *   - Status from `getEventStatus` (manual cancelled/ongoing/completed
 *     win; otherwise startTime + 12h). Absolute instants on both sides,
 *     so no timezone is involved (CLAUDE.md "Date & Time").
 *
 * Native <details open> instead of the shared client PerformanceGroup:
 * the 22-v1 row (status stacked over the date, venue under the name)
 * differs from the history-tab grid, and a disclosure element collapses
 * without JS and announces its expanded state for free.
 */

type RelatedLabel = { main: string; sub: string | null; originalLanguage: string };

type EventView = {
  id: string;
  href: string;
  name: RelatedLabel;
  venue: RelatedLabel | null;
  status: ResolvedEventStatus;
  formattedDate: string;
  dateTime: string;
  startMs: number;
};

type SeriesView = {
  key: string;
  label: RelatedLabel;
  events: EventView[];
  sortKey: number;
};

function toMs(value: unknown): number {
  // Post-serializer payloads carry ISO strings; a raw Prisma caller would
  // pass a Date. Invalid input sorts last instead of poisoning the sort
  // with NaN.
  const ms =
    value instanceof Date
      ? value.getTime()
      : typeof value === "string"
        ? new Date(value).getTime()
        : NaN;
  return Number.isNaN(ms) ? 0 : ms;
}

function relatedTitle(
  row: { originalName: string; originalLanguage: string; translations: { locale: string; name: string }[] },
  locale: string,
  fallback: string,
): RelatedLabel {
  if (!row.originalName) return { main: fallback, sub: null, originalLanguage: locale };
  return {
    originalLanguage: row.originalLanguage,
    ...resolveDisplayPair(
      { original: row.originalName, originalLanguage: row.originalLanguage },
      row.translations, locale, "name", { kind: "title" },
    ),
  };
}

export async function AlbumEventsPanel({
  events,
  albumType,
  locale,
}: {
  events: RelatedEvent[];
  albumType: AlbumType;
  locale: string;
}) {
  const t = await getTranslations({ locale, namespace: "Album" });
  const et = await getTranslations({ locale, namespace: "Event" });
  const st = await getTranslations({ locale, namespace: "EventSeries" });

  // 22-v1 empty states are the bare panel, the same on all three tabs.
  if (events.length === 0) {
    return (
      <div className={`${styles.panel} ${styles.empty}`}>
        {t("events.empty")}
      </div>
    );
  }

  const statusLabels: Record<ResolvedEventStatus, string> = {
    ongoing: et("live"),
    upcoming: et("status.upcoming"),
    completed: et("status.completed"),
    cancelled: et("status.cancelled"),
  };

  const now = new Date();
  const buckets = new Map<string, { label: RelatedLabel; events: EventView[] }>();
  const other: EventView[] = [];
  for (const event of events) {
    const displayDate = event.date ?? event.startTime;
    const localizedVenue = event.translations.find((row) => row.locale === locale)?.venue;
    const venue = event.originalVenue ? {
      originalLanguage: event.originalLanguage,
      ...resolveDisplayPair(
        { original: event.originalVenue, originalLanguage: event.originalLanguage },
        event.translations, locale, "venue",
      ),
    } : localizedVenue ? { main: localizedVenue, sub: null, originalLanguage: locale } : null;
    const view: EventView = {
      id: String(event.id),
      href: entityPath("events", locale, event.id, event.slug),
      name: relatedTitle(event, locale, et("unknownEvent")),
      venue,
      status: getEventStatus(
        { status: event.status, startTime: event.startTime },
        now,
      ),
      formattedDate: formatDate(displayDate, locale, ALBUM_DATE_FORMAT),
      // The wire type is an ISO string (serializeBigIntAsString), so the
      // first 10 characters are the UTC calendar date.
      dateTime: displayDate.slice(0, 10),
      startMs: toMs(event.startTime),
    };
    if (!event.eventSeries) {
      other.push(view);
      continue;
    }
    const key = String(event.eventSeries.id);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.events.push(view);
    } else {
      buckets.set(key, {
        label: relatedTitle(event.eventSeries, locale, st("unknownSeries")),
        events: [view],
      });
    }
  }

  const series: SeriesView[] = [...buckets].map(([key, bucket]) => {
    bucket.events.sort((a, b) => b.startMs - a.startMs);
    const hasOngoing = bucket.events.some((e) => e.status === "ongoing");
    return {
      key,
      label: bucket.label,
      events: bucket.events,
      sortKey: hasOngoing ? Number.MAX_SAFE_INTEGER : bucket.events[0].startMs,
    };
  });
  series.sort((a, b) => b.sortKey - a.sortKey);
  if (other.length > 0) {
    other.sort((a, b) => b.startMs - a.startMs);
    series.push({
      key: "other",
      label: { main: et("ungrouped"), sub: null, originalLanguage: locale },
      events: other,
      sortKey: 0,
    });
  }

  return (
    <>
      <h2 className={styles.sectionTitle}>{t("tab.events")}</h2>
      <p className={styles.sectionSub}>
        {albumType === AlbumType.live_album
          ? t("events.subtitle.bd")
          : t("events.subtitle.songsAppeared")}
      </p>
      {series.map((group) => (
        <details key={group.key} className={styles.eventGroup} open>
          <summary>
            <span lang={group.label.originalLanguage}>{group.label.main}</span>{" "}
            <span className={styles.count}>{group.events.length}</span>
            {group.label.sub && <small className={styles.eventTranslation} lang={locale}>{group.label.sub}</small>}
          </summary>
          {group.events.map((event) => (
            <Link key={event.id} href={event.href} className={styles.eventRow}>
              <span className={styles.eventDate}>
                <span className={styles.eventStatus} data-status={event.status}>
                  {statusLabels[event.status]}
                </span>
                <time dateTime={event.dateTime}>{event.formattedDate}</time>
              </span>
              <span className={styles.eventCopy}>
                <strong lang={event.name.originalLanguage}>{event.name.main}</strong>
                {event.name.sub && <small lang={locale}>{event.name.sub}</small>}
                {event.venue && (
                  <span className={styles.eventVenue}>
                    <span lang={event.venue.originalLanguage}>{event.venue.main}</span>
                    {event.venue.sub && <small lang={locale}>{event.venue.sub}</small>}
                  </span>
                )}
              </span>
              <span className={styles.arrow} aria-hidden="true">
                ›
              </span>
            </Link>
          ))}
        </details>
      ))}
    </>
  );
}
