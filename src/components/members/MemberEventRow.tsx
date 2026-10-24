import Link from "next/link";
import type { ResolvedEventStatus } from "@/lib/eventStatus";
import styles from "./memberDetail.module.css";

/*
 * One concert row on the member page (approved packet 30-v1). Used by
 * the overview's recent-3 panel (with the series subtitle) and inside
 * the history groups (without it — the group header already names the
 * series). `.historyGroup` in the CSS module re-lays the row out with
 * the date and status side by side.
 *
 * Full titles wrap: event names here run past 60 characters and the
 * part that tells Day.1 from Day.2 sits at the end.
 */

export interface MemberEventView {
  id: string;
  href: string;
  status: ResolvedEventStatus;
  statusLabel: string;
  formattedDate: string;
  /** `YYYY-MM-DD` for `<time datetime>`; null when the event has no date. */
  isoDate: string | null;
  name: string;
  nameLang?: string;
  seriesName: string | null;
  seriesLang?: string;
}

export function MemberEventRow({
  event,
  showSeries,
}: {
  event: MemberEventView;
  showSeries: boolean;
}) {
  return (
    <Link href={event.href} className={styles.eventRow}>
      <span className={styles.eventDate}>
        {event.isoDate && (
          <time dateTime={event.isoDate}>{event.formattedDate}</time>
        )}
        <span className={styles.status} data-status={event.status}>
          {event.statusLabel}
        </span>
      </span>
      <span className={styles.eventCopy}>
        <span className={styles.eventName} lang={event.nameLang}>
          {event.name}
        </span>
        {showSeries && event.seriesName && (
          <span className={styles.eventSeries} lang={event.seriesLang}>
            {event.seriesName}
          </span>
        )}
      </span>
      <span className={styles.arrow} aria-hidden="true">
        ›
      </span>
    </Link>
  );
}
