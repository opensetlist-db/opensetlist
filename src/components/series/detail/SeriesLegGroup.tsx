import Link from "next/link";
import type { ResolvedEventStatus } from "@/lib/eventStatus";
import type { LangText } from "./SeriesIdentity";
import { SeriesStatusPill } from "./SeriesStatusPill";
import styles from "./seriesDetail.module.css";

export interface SeriesLegEvent {
  /** String id: the key only; `href` was built from the raw BigInt. */
  id: string;
  /** Locale-prefixed canonical event path (`eventHref`). */
  href: string;
  status: ResolvedEventStatus;
  statusLabel: string;
  /** ISO value for `<time dateTime>` (the stored UTC date). */
  dateTime: string;
  formattedDate: string;
  name: LangText;
}

export interface SeriesLeg {
  key: string;
  /** Localized city, or the "unknown city" label with the page locale. */
  city: LangText;
  venue: LangText | null;
  dateRangeLabel: string;
  /**
   * Roll-up status pill, or null when every event is cancelled — 32-v1
   * omits the header badge then and keeps each row's own pill.
   */
  status: { status: ResolvedEventStatus; label: string } | null;
  countLabel: string;
  events: SeriesLegEvent[];
}

/*
 * One city group of the schedule tab (32-v1). A native `<details open>`
 * rather than a client toggle button: expanded
 * by default, each group collapses independently, the summary is
 * keyboard-operable and exposes its expanded state without any client
 * JavaScript.
 *
 * The summary holds the city heading, roll-up status, venue (first
 * event's) · date range, and the "N공연" count over a chevron that
 * rotates when open. The h2 is a DIRECT child of <summary> — the only
 * place its content model allows a heading (phrasing content plus one
 * heading); a heading nested in the layout spans would be invalid. So
 * the h2 itself is the middle flex cell and carries city, status and
 * the venue/date line. Rows link to the canonical event page with the
 * full calendar date, status and the full short name — wrapped, never
 * ellipsized. No per-event song count: the series query does not fetch
 * one and 32-v1 does not invent it.
 */
export function SeriesLegGroup({ leg }: { leg: SeriesLeg }) {
  return (
    <details className={styles.leg} open>
      <summary>
        <span className={styles.pin} aria-hidden="true">
          ⌖
        </span>
        <h2 className={styles.legHeading}>
          <span className={styles.legTitle}>
            <span className={styles.legCity} lang={leg.city.lang}>
              {leg.city.text}
            </span>
            {leg.status ? (
              <SeriesStatusPill
                status={leg.status.status}
                label={leg.status.label}
              />
            ) : null}
          </span>
          <span className={styles.legSub}>
            {leg.venue ? (
              <>
                <span lang={leg.venue.lang}>{leg.venue.text}</span>
                {" · "}
              </>
            ) : null}
            {leg.dateRangeLabel}
          </span>
        </h2>
        <span className={styles.legCount}>
          {leg.countLabel}
          <span className={styles.chevron} aria-hidden="true">
            ›
          </span>
        </span>
      </summary>
      <ul className={styles.legEvents}>
        {leg.events.map((ev) => (
          <li key={ev.id}>
            <Link href={ev.href} className={styles.eventRow}>
              <span className={styles.eventDate}>
                <time dateTime={ev.dateTime}>{ev.formattedDate}</time>
                <SeriesStatusPill status={ev.status} label={ev.statusLabel} />
              </span>
              <strong className={styles.eventName} lang={ev.name.lang}>
                {ev.name.text}
              </strong>
              <span className={styles.arrow} aria-hidden="true">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
