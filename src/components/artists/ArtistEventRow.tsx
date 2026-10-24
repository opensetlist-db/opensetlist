import Link from "next/link";
import type { ResolvedEventStatus } from "@/lib/eventStatus";
import styles from "./artistDetail.module.css";

/*
 * One concert row on the artist page — used by both the overview's
 * "recent concerts" panel and the grouped history tab (approved packet
 * 20-v1). The markup is the same in both; `.history` in the CSS module
 * re-lays it out as the date·status / concert / songs / arrow grid and
 * hides the series subtitle (the group header already names the
 * series).
 *
 * Full titles wrap instead of truncating: event names on this catalog
 * routinely run past 60 characters ("ラブライブ！蓮ノ空女学院…") and the
 * old one-line ellipsis hid the part that tells Day.1 from Day.2.
 */

export interface ArtistEventView {
  id: string;
  href: string;
  status: ResolvedEventStatus;
  statusLabel: string;
  /** Locale-formatted UTC date (`formatDate` + HISTORY_ROW_DATE_FORMAT). */
  formattedDate: string;
  /** `YYYY-MM-DD` for the `<time datetime>` attribute; null when the
   *  concert has no date yet (TBA). */
  isoDate: string | null;
  name: string;
  nameLang?: string;
  seriesName: string | null;
  seriesLang?: string;
  /** Pre-formatted "🎵 N" label; only for completed events with songs. */
  songCountLabel: string | null;
}

export function ArtistEventRow({ event }: { event: ArtistEventView }) {
  return (
    <Link href={event.href} className={styles.eventRow}>
      <span className={styles.eventContent}>
        <span className={styles.eventMeta}>
          <span className={styles.status} data-status={event.status}>
            {event.statusLabel}
          </span>{" "}
          {event.isoDate && (
            <time dateTime={event.isoDate}>{event.formattedDate}</time>
          )}
        </span>
        <span>
          <span className={styles.eventName} lang={event.nameLang}>
            {event.name}
          </span>
          {event.seriesName && (
            <span className={styles.series} lang={event.seriesLang}>
              {event.seriesName}
            </span>
          )}
        </span>
        {/* Rendered even when empty: on the history grid this span is
            the songs track, and dropping it would shift the arrow into
            that column. */}
        <span className={styles.songCount}>{event.songCountLabel}</span>
      </span>
      <span className={styles.arrow} aria-hidden="true">
        ›
      </span>
    </Link>
  );
}
