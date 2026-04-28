"use client";

import Link from "next/link";
import { useState } from "react";
import { colors } from "@/styles/tokens";
import { StatusBadge } from "@/components/StatusBadge";
import type { ResolvedEventStatus } from "@/lib/eventStatus";

/*
 * Series-grouped collapsible event list, shared by every detail page
 * that shows performance history (Artist / Member / Song / Series).
 *
 * Series header: clickable, toggles expand/collapse (default expanded).
 * `›` arrow rotates 0°→90° in 0.15s.
 * Event rows: `[StatusBadge size="sm"]` + date 48-52px + event name
 * (blue, bold, flex-1, truncate) + custom trailing cells via
 * `renderTrailing` + `›`.
 *
 * The page passes its own `renderTrailing(event)` callback so each
 * detail page can add page-specific cells (artist: song count;
 * member: 전출연 / unit badge; song: encore + position + note;
 * series: leg-grouped, song-count). This way the same component
 * renders four different page styles without prop explosions.
 *
 * Series ordering (ongoing-pinned + sort key) is the consumer's
 * responsibility — this component renders one group at the position
 * the page placed it.
 *
 * Why client component: expand/collapse is local interactive state.
 * Server-rendering the closed state would require a full page reload
 * to flip — not acceptable for a navigation-secondary control.
 */

export interface PerformanceEvent {
  id: string | number;
  /** Resolved status from getEventStatus(); the badge label is provided by the consumer via the `statusLabels` map. */
  status: ResolvedEventStatus;
  /** ISO-formatted date string. Pre-formatted to the desired locale by the consumer. */
  formattedDate: string;
  /** Event name to display, locale-resolved. Always render; consumer passes a fallback if data is missing. */
  name: string;
  /** Click target. Renders the row as a link wrapper. */
  href: string;
  /**
   * Optional pre-rendered trailing cells (encore badge / unit pill /
   * #position chip / etc.). The consumer builds the JSX server-side
   * — passing a server-side `renderTrailing` callback through this
   * client component would cross the RSC boundary as a function,
   * which React refuses to serialize. Pre-rendered ReactNode trees
   * serialize cleanly so each consumer can keep its own per-row
   * presentation without coupling PerformanceGroup to page-specific
   * data shapes.
   */
  trailing?: React.ReactNode;
}

export interface PerformanceSeries {
  seriesId: string | number;
  /** Series header label, locale-resolved. */
  seriesShort: string;
  /** True when at least one event in the series is currently ongoing — drives the right-edge LIVE badge on the series header. */
  hasOngoing: boolean;
  events: PerformanceEvent[];
}

interface Props {
  series: PerformanceSeries;
  /** Map from resolved event status to its already-translated label. The consumer supplies labels so the component stays out of next-intl. */
  statusLabels: Record<ResolvedEventStatus, string>;
  /** Total-events-count label (e.g. "3공연" / "3 events" / "3公演"). Consumer formats via i18n + count. */
  eventCountLabel: string;
}

export function PerformanceGroup({
  series,
  statusLabels,
  eventCountLabel,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div>
      {/* Series header — clickable to toggle. */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "10px 16px",
          cursor: "pointer",
          background: colors.bgFaint,
          border: "none",
          borderBottom: `1px solid ${colors.borderLight}`,
          fontFamily: "inherit",
          textAlign: "left",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            transform: collapsed ? "rotate(0deg)" : "rotate(90deg)",
            transition: "transform 0.15s ease",
            fontSize: 12,
            color: colors.textMuted,
            display: "inline-block",
            flexShrink: 0,
          }}
        >
          ›
        </span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: colors.textSecondary,
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {series.seriesShort}
        </span>
        {series.hasOngoing && (
          <StatusBadge
            status="ongoing"
            size="sm"
            label={statusLabels.ongoing}
          />
        )}
        <span
          style={{
            fontSize: 11,
            color: colors.textMuted,
            flexShrink: 0,
          }}
        >
          {eventCountLabel}
        </span>
      </button>

      {/* Event rows — only mounted when expanded so collapsed groups
          don't pay layout/paint cost. Each row is a `next/link` Link
          so app-internal navigation stays soft (no full document
          reload) and Next.js can prefetch the linked event page. */}
      {!collapsed &&
        series.events.map((event, i) => (
          <Link
            key={event.id}
            href={event.href}
            className="row-hover-bg"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 16px 9px 36px",
              borderBottom:
                i < series.events.length - 1
                  ? `1px solid ${colors.borderFaint}`
                  : `1px solid ${colors.borderLight}`,
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <StatusBadge
              status={event.status}
              size="sm"
              label={statusLabels[event.status]}
            />
            <span
              style={{
                fontSize: 12,
                color: colors.textMuted,
                flexShrink: 0,
                width: 52,
              }}
            >
              {event.formattedDate}
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: colors.primary,
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {event.name}
            </span>
            {event.trailing}
            <span
              aria-hidden="true"
              style={{
                fontSize: 13,
                color: colors.borderSubtle,
                flexShrink: 0,
              }}
            >
              ›
            </span>
          </Link>
        ))}
    </div>
  );
}
