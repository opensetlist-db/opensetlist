"use client";

import type { ReactNode } from "react";
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
  /**
   * Caller-resolved series link target — null when the event has
   * no series. `id` is `string` (not `number | bigint`) for the
   * same reason `artist.id` is: `EventHeader` is a client
   * component, and BigInt is outside the RSC serializable subset.
   * The page stringifies at the boundary; high-id series (≥ 2^53)
   * survive the round-trip without precision loss.
   */
  series: { id: string; slug: string; shortName: string } | null;
  /** Display title — series full name takes precedence; falls back to event full name then `unknownEvent`. */
  title: string;
  venue: string | null;
  city: string | null;
  /** Total number of song-typed setlist items (excludes mc/video/interval). */
  songsCount: number;
  /**
   * Pre-formatted reaction count string (e.g. `"1.2K"` / `"1.2천"`).
   * The page formats with `Intl.NumberFormat(locale, { notation:
   * "compact", maximumFractionDigits: 1 })` so the locale-correct
   * suffix is rendered server-side — passing a string instead of a
   * raw number avoids any SSR-vs-client `Intl` divergence (different
   * ICU versions could produce slightly different output).
   */
  reactionsValue: string;
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
  reactionsValue,
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

  const iconRows: Array<{
    icon: string;
    labelKey: "iconLabelDate" | "iconLabelStart" | "iconLabelVenue" | "iconLabelCity" | "iconLabelSongs" | "iconLabelReactions";
    value: ReactNode | null;
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
          // 5px matches the shared <ColorStripe> component used on
          // artist / song / series sidebar info cards. Side-by-side
          // (e.g. clicking artist → event link), the strip height
          // shouldn't shift by 1px between detail pages.
          height: 5,
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
                className="text-[12px] font-semibold hover:underline"
                style={{ color: colors.primary }}
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
              // Mockup `event-page-desktop-mockup-v2.jsx:525` —
              // `fontWeight: 600`. Tailwind's `font-medium` is 500;
              // use the bracketed semibold equivalent or inline.
              href={`/${locale}/series/${series.id}/${series.slug}`}
              className="text-[11px] font-semibold hover:underline"
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
            // Mockup `:532` — `marginBottom: 20` between title
            // and the icon-row dl below.
            marginBottom: 20,
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
                    // `margin: "1px 0 0 0"` — the previous version
                    // listed `marginTop: 1` followed by `margin: 0`,
                    // and the shorthand silently overrode the
                    // longhand, killing the 1px breathing room
                    // above the value. Single shorthand keeps both
                    // intents in one line.
                    style={{
                      fontSize: 13,
                      color: colors.textSecondary,
                      fontWeight: 500,
                      margin: "1px 0 0 0",
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
