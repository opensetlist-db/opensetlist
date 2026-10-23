import Link from "next/link";
import EventStatusTicker from "@/components/EventStatusTicker";
import { EventArt } from "@/components/shared/EventArt";
import { ConcertStatusPill } from "@/components/events/ConcertStatusPill";
import { StatusBadge } from "@/components/StatusBadge";
import type { ResolvedEventStatus } from "@/lib/eventStatus";
import styles from "./eventDetail.module.css";

/*
 * Concert-detail Hero (18-v3 `.event-hero`): the event's logo slot beside
 * the series link, the per-day title (the page's only h1), date + venue,
 * and the status pill with the venue-local start time. The artist /
 * organizer credit and the city sit in the sidebar facts
 * (`<EventInfoCard>`), as the approved hero carries neither.
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
 *
 * LIVE (consistency-03-v3 §8): the hero gets a 3px coral rule and a faint
 * warm wash (`data-status="ongoing"` in the CSS module), and the pill is
 * the shared coral <StatusBadge> rather than the list pill's solid
 * raspberry. The badge is chosen here, not by changing
 * <ConcertStatusPill> — that pill belongs to the concert list, which
 * moves its own LIVE variant on its own schedule; rendering the shared
 * badge directly keeps this hero right whichever way the list pill
 * looks. The other states keep the list pill (approved 18-v3 hero).
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
  title,
  dateLabel,
  venueLine,
}: Props) {
  return (
    <header className={styles.hero} data-testid="event-hero" data-status={status}>
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
        <h1 className={styles.title}>{title}</h1>
        {(dateLabel || venueLine) && (
          <p className={styles.meta}>
            {dateLabel && <span>{dateLabel}</span>}
            {venueLine && <span>{venueLine}</span>}
          </p>
        )}
      </div>
      <div className={styles.stateLine}>
        {status === "ongoing" ? (
          <StatusBadge status={status} label={statusLabel} size="md" />
        ) : (
          <ConcertStatusPill status={status} label={statusLabel} />
        )}
        {startLabel && <span>{startLabel}</span>}
      </div>
    </header>
  );
}
