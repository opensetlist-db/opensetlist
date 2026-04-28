import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import { EventDateTime } from "@/components/EventDateTime";
import EventStatusTicker from "@/components/EventStatusTicker";
import { colors, radius, shadows } from "@/styles/tokens";
import type { ResolvedEventStatus } from "@/lib/eventStatus";

interface Props {
  status: ResolvedEventStatus;
  statusLabel: string;
  date: Date | string | null;
  startTime: Date | string | null;
  /**
   * Active locale, used to build artist + series link hrefs as
   * `/${locale}/...`. Required: `next/link` does NOT auto-prefix the
   * way `@/i18n/navigation`'s wrapper does, so callers must pass the
   * locale explicitly. Matches the convention every other detail
   * page uses for `next/link` hrefs.
   */
  locale: string;
  /**
   * Caller-resolved owning artist (via the series). Renders as a Link
   * to the artist detail page. Null when the series has no artistId
   * (multi-artist festivals) — the page should set `organizerName`
   * instead in that case.
   */
  artist: { id: number; slug: string; name: string } | null;
  /**
   * Multi-artist festival fallback — rendered as plain text when
   * `artist` is null. Mirrors the `series.organizerName` field.
   */
  organizerName: string | null;
  /** Caller-resolved series link target — null when the event has no series. */
  series: { id: number | bigint; slug: string; shortName: string } | null;
  /** Display title — series full name takes precedence; falls back to event full name then `unknownEventLabel`. */
  title: string;
  /** Subtitle — shown only when distinct from `title`. */
  subtitle: string | null;
  venue: string | null;
  city: string | null;
}

// Card-styled event detail header per shared-components-handoff §3-1.
// Renders identically on mobile and desktop; the page-level layout
// decides whether it sits at the top or in a sticky sidebar.
export function EventHeader({
  status,
  statusLabel,
  date,
  startTime,
  locale,
  artist,
  organizerName,
  series,
  title,
  subtitle,
  venue,
  city,
}: Props) {
  // EventStatusTicker is a client island that schedules a router.refresh
  // at the next status boundary; mounting it here keeps the ticker logic
  // co-located with the badge it ultimately invalidates.
  const startTimeIso =
    typeof startTime === "string"
      ? startTime
      : startTime?.toISOString() ?? null;
  const venueLine =
    venue && city ? `${venue}, ${city}` : venue ?? city ?? null;

  return (
    <header
      className="mb-6 lg:mb-0"
      style={{
        background: colors.bgCard,
        borderRadius: radius.card,
        boxShadow: shadows.card,
        padding: "20px",
      }}
    >
      <EventStatusTicker startTime={startTimeIso} />
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={status} label={statusLabel} size="md" />
        {date && (
          <span style={{ color: colors.textSecondary, fontSize: 13 }}>
            <EventDateTime
              date={date ?? null}
              startTime={startTime ?? null}
              variant="inline"
            />
          </span>
        )}
      </div>
      {(artist || organizerName) && (
        <div className="mt-2">
          {artist ? (
            <Link
              href={`/${locale}/artists/${artist.id}/${artist.slug}`}
              className="text-[12px] font-medium hover:underline"
              style={{ color: colors.textSubtle }}
            >
              {artist.name}
            </Link>
          ) : (
            <span
              className="text-[12px] font-medium"
              style={{ color: colors.textSubtle }}
            >
              {organizerName}
            </span>
          )}
        </div>
      )}
      {series && (
        <div className="mt-1">
          <Link
            href={`/${locale}/series/${series.id}/${series.slug}`}
            className="text-[11px] font-medium hover:underline"
            style={{ color: colors.primary }}
          >
            {series.shortName}
          </Link>
        </div>
      )}
      <h1
        className="mt-1 text-lg font-bold leading-snug"
        style={{ color: colors.textPrimary }}
      >
        {title}
      </h1>
      {subtitle && (
        <p
          className="mt-1 text-sm"
          style={{ color: colors.textSecondary }}
        >
          {subtitle}
        </p>
      )}
      {venueLine && (
        <p
          className="mt-2 text-sm"
          style={{ color: colors.textSecondary }}
        >
          {venueLine}
        </p>
      )}
    </header>
  );
}
