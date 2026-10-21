import Link from "next/link";
import EventStatusTicker from "@/components/EventStatusTicker";
import { EventArt } from "@/components/shared/EventArt";
import { ConcertStatusPill } from "@/components/events/ConcertStatusPill";
import type { ResolvedEventStatus } from "@/lib/eventStatus";
import styles from "./eventDetail.module.css";

/*
 * Concert-detail Hero (18-v3 `.event-hero`): the event's logo slot beside
 * the series link, the per-day title (the page's only h1), date + venue,
 * and the status pill with the venue-local start time.
 *
 * Server component: every value is resolved and formatted on the server
 * (venue-local, so SSR and hydration print the same text). The only
 * client piece is `<EventStatusTicker>`, which refreshes the route at the
 * start-time / +12h status boundaries — the same ticker the old sidebar
 * header card mounted, so the upcoming → LIVE → completed flips keep
 * their existing timing.
 *
 * The logo is 07's resolved event logo (override → inherited series
 * logo → typography). A missing or failed image falls back to the series
 * short name in the same reserved slot, so the Hero never changes height.
 */

interface Props {
  status: ResolvedEventStatus;
  statusLabel: string;
  /** ISO start instant for the status ticker; null when unknown. */
  startTimeIso: string | null;
  /** Venue-local start line ("11月14日 16:30 JST"); null hides it. */
  startLabel: string | null;
  logoUrl: string | null;
  logoTint: string | null;
  /** Typography fallback inside the logo slot. */
  artTitle: string;
  series: { href: string; name: string } | null;
  artist: { href: string; name: string } | null;
  organizerName: string | null;
  title: string;
  dateLabel: string | null;
  venueLine: string | null;
}

export function EventHero({
  status,
  statusLabel,
  startTimeIso,
  startLabel,
  logoUrl,
  logoTint,
  artTitle,
  series,
  artist,
  organizerName,
  title,
  dateLabel,
  venueLine,
}: Props) {
  return (
    <header className={styles.hero} data-testid="event-hero">
      <EventStatusTicker startTime={startTimeIso} />
      <EventArt
        variant="detail"
        logoUrl={logoUrl}
        tint={logoTint}
        title={artTitle}
        className={styles.heroArt}
      />
      <div className={styles.heroCopy}>
        {series && (
          <Link href={series.href} className={styles.seriesLink}>
            {series.name}
          </Link>
        )}
        {/* Artist / organizer credit, kept from the old header card:
            the series link names the tour, this line names who plays
            it (or the festival organizer when there is no artist). */}
        {artist ? (
          <Link href={artist.href} className={styles.artistLine}>
            {artist.name}
          </Link>
        ) : organizerName ? (
          <span className={styles.artistLine}>{organizerName}</span>
        ) : null}
        <h1 className={styles.title}>{title}</h1>
        {(dateLabel || venueLine) && (
          <p className={styles.meta}>
            {dateLabel && <span>{dateLabel}</span>}
            {venueLine && <span>{venueLine}</span>}
          </p>
        )}
      </div>
      <div className={styles.stateLine}>
        <ConcertStatusPill status={status} label={statusLabel} />
        {startLabel && <span>{startLabel}</span>}
      </div>
    </header>
  );
}
