"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { StatusBadge } from "@/components/StatusBadge";
import EventStatusTicker from "@/components/EventStatusTicker";
import { EventStartTime } from "@/components/EventStartTime";
import { formatVenueDate } from "@/lib/eventDateTime";
import { colors, radius, shadows } from "@/styles/tokens";
import type { ResolvedEventStatus } from "@/lib/eventStatus";

interface Props {
  status: ResolvedEventStatus;
  statusLabel: string;
  date: Date | string | null;
  startTime: Date | string | null;
  /**
   * Active locale, used to build artist + series link hrefs as
   * `/${locale}/...` and to pre-format the venue-date string in the
   * locale-correct shape (e.g. `2026년 5월 2일` / `May 2, 2026`).
   */
  locale: string;
  /**
   * Caller-resolved owning artist (via the series). When present, the
   * artist line renders as a Link to the artist detail page; when
   * null, `organizerName` (multi-artist festival) renders as plain
   * text instead. `id` is `string` so the page can stringify the raw
   * BigInt at the boundary — `Number(bigint)` truncates ≥ 2^53.
   */
  artist: { id: string; slug: string; name: string } | null;
  organizerName: string | null;
  /** Caller-resolved series link target — null when the event has no series. */
  series: { id: number | bigint; slug: string; shortName: string } | null;
  /** Display title — series full name takes precedence; falls back to event full name then `unknownEvent`. */
  title: string;
  venue: string | null;
  city: string | null;
  /** Total number of song-typed setlist items (excludes mc/video/interval). */
  songsCount: number;
  /** Sum of every reaction across every setlist item on this event. */
  reactionsCount: number;
}

// Card-styled event detail header per
// `event-page-desktop-mockup-v2.jsx:501-557`. Renders as the top
// sidebar card on desktop and stacks above the main column on mobile.
// The icon-row body (📅/🕐/📍/🏙️/🎵/💬) replaces the previous flat
// status+date+venue stack so the operator's at-a-glance summary
// matches the mockup verbatim.
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
  venue,
  city,
  songsCount,
  reactionsCount,
}: Props) {
  const t = useTranslations("Event");

  const startTimeIso =
    typeof startTime === "string"
      ? startTime
      : startTime?.toISOString() ?? null;

  // `formatVenueDate` is timezone-agnostic — its `extractVenueYMD`
  // helper uses `getUTCFullYear / getUTCMonth / getUTCDate` for
  // `Date` inputs and slices the ISO string directly for `string`
  // inputs (`src/lib/eventDateTime.ts:16-32`). Server and client
  // always derive the same y/m/d for the same input, so this client
  // component can call it on first render without a `useMounted`
  // guard — no hydration mismatch is possible.
  const dateLabel = formatVenueDate(date, locale);

  // `${(n/1000).toFixed(1)}k total` for ≥ 1000, plain integer otherwise.
  // `1.0k` reads more naturally than `1k` for a transition number, so
  // keep the one decimal even at the boundary.
  const reactionsValue =
    reactionsCount >= 1000
      ? `${(reactionsCount / 1000).toFixed(1)}k`
      : String(reactionsCount);

  const iconRows: Array<{
    icon: string;
    labelKey: "iconLabelDate" | "iconLabelStart" | "iconLabelVenue" | "iconLabelCity" | "iconLabelSongs" | "iconLabelReactions";
    value: React.ReactNode | null;
  }> = [
    { icon: "📅", labelKey: "iconLabelDate", value: dateLabel || null },
    {
      icon: "🕐",
      labelKey: "iconLabelStart",
      value: startTime ? (
        <EventStartTime date={date} startTime={startTime} />
      ) : null,
    },
    { icon: "📍", labelKey: "iconLabelVenue", value: venue },
    { icon: "🏙️", labelKey: "iconLabelCity", value: city },
    {
      icon: "🎵",
      labelKey: "iconLabelSongs",
      value: t("songsValue", { count: songsCount }),
    },
    {
      icon: "💬",
      labelKey: "iconLabelReactions",
      // Pre-formatted to a string so the page-side count work isn't
      // duplicated here. `1.2k` shows in every locale; the suffix is
      // universal and the surrounding label is i18n'd.
      value: reactionsValue,
    },
  ];

  return (
    <header
      style={{
        background: colors.bgCard,
        borderRadius: radius.card,
        boxShadow: shadows.card,
        overflow: "hidden",
      }}
    >
      <EventStatusTicker startTime={startTimeIso} />
      {/* Gradient header strip — matches mockup
          `event-page-desktop-mockup-v2.jsx:508-511`. The three stops
          come from existing semantic tokens: `primaryLight` (sky)
          → `primary` (brand blue) → `variant` (song-variant purple).
          Hard-coding the hex would duplicate values that already have
          token names. */}
      <div
        aria-hidden="true"
        style={{
          height: 6,
          background: `linear-gradient(90deg, ${colors.primaryLight}, ${colors.primary}, ${colors.variant})`,
        }}
      />
      <div style={{ padding: "20px 20px 24px" }}>
        <div className="mb-3">
          <StatusBadge status={status} label={statusLabel} size="md" />
        </div>
        {(artist || organizerName) && (
          <div style={{ marginBottom: 4 }}>
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
          <div style={{ marginBottom: 6 }}>
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
          className="font-bold leading-snug"
          style={{
            fontSize: 17,
            color: colors.textPrimary,
            letterSpacing: "-0.01em",
            marginBottom: 18,
          }}
        >
          {title}
        </h1>

        <dl style={{ margin: 0 }}>
          {iconRows
            .filter((row) => row.value != null && row.value !== "")
            .map((row) => (
              <div
                key={row.labelKey}
                style={{
                  display: "flex",
                  gap: 10,
                  marginBottom: 10,
                  alignItems: "flex-start",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}
                >
                  {row.icon}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <dt
                    style={{
                      fontSize: 10,
                      color: colors.textMuted,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                    }}
                  >
                    {t(row.labelKey)}
                  </dt>
                  <dd
                    style={{
                      fontSize: 13,
                      color: colors.textSecondary,
                      fontWeight: 500,
                      marginTop: 1,
                      margin: 0,
                    }}
                  >
                    {row.value}
                  </dd>
                </div>
              </div>
            ))}
        </dl>
      </div>
    </header>
  );
}
