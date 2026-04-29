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
 *
 * Event rows: a 5-track CSS grid (`PERFORMANCE_ROW_GRID`):
 *   [60px status] [100px date] [minmax(0,1fr) name] [auto trailing] [auto chevron]
 *
 * Why grid (not flex): with flex + variable-width date strings (Korean
 * year format runs ~90px) and variable-width trailing chips, the
 * leading columns drift across rows so the visual table looks ragged.
 * Grid pins the leading columns so status/date/name align cleanly down
 * every group. `minmax(0, 1fr)` is the canonical fix for "1fr column
 * refuses to shrink", which is what produced the mobile horizontal
 * scroll bar before this refactor — without it the long name pushes
 * the row wider than the viewport. The row's `overflow: hidden`
 * clips overlong trailing rather than scrolling.
 *
 * Page-specific trailing cells come in via the consumer-built
 * `event.trailing` ReactNode (artist: song count; member: 전출연 /
 * unit badge; song: encore + position + note; series: leg-grouped,
 * song-count). The grid renders them in a single `auto` cell so each
 * page keeps its own per-row presentation without coupling to the
 * shared grid template.
 *
 * The exported `PERFORMANCE_ROW_GRID` constant lets a page (e.g.
 * the song-page history tab) render a desktop column-header strip
 * above the groups using the exact same column tracks, so header
 * labels line up with the row content.
 *
 * Series ordering (ongoing-pinned + sort key) is the consumer's
 * responsibility — this component renders one group at the position
 * the page placed it.
 *
 * Why client component: expand/collapse is local interactive state.
 * Server-rendering the closed state would require a full page reload
 * to flip — not acceptable for a navigation-secondary control.
 */

// Layout constants live in a server-safe module so server-component
// consumers (e.g. the song detail page's column-header strip) can
// import them without the value resolving to `undefined` through the
// RSC client-boundary. Re-exported here for backward compatibility
// with existing call sites that import from `@/components/PerformanceGroup`.
export {
  PERFORMANCE_ROW_GRID,
  PERFORMANCE_ROW_INDENT_PX,
  PERFORMANCE_ROW_GAP_PX,
} from "./performance-row-layout";
import { PERFORMANCE_ROW_INDENT_PX } from "./performance-row-layout";

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
            // Mobile uses `auto auto` for trailing/chevron — chips size
            // to their content and the row clips at its right edge if
            // they overflow. Desktop swaps in the fixed-width tracks
            // (`180px 16px`) so the page's column-header strip lines
            // up with the row columns. The grid container itself gets
            // `min-width: 0` so its grid-intrinsic min-content (which
            // can exceed the viewport once `flexShrink: 0` chips refuse
            // to shrink) doesn't force the parent box wider than the
            // mobile viewport — combined with the row's `overflow:
            // hidden`, this is what kills the page-level horizontal
            // scroll bar on narrow screens.
            //
            // ⚠️ The `lg:grid-cols-[...]` value MUST stay in sync with
            // `PERFORMANCE_ROW_GRID` exported above. Tailwind JIT
            // requires literal class strings, so the constant can't be
            // interpolated here — if you change one, change the other.
            className="row-hover-bg grid items-center gap-[10px] grid-cols-[60px_100px_minmax(0,1fr)_auto_auto] lg:grid-cols-[60px_100px_minmax(0,1fr)_180px_16px]"
            style={{
              padding: `9px 16px 9px ${PERFORMANCE_ROW_INDENT_PX}px`,
              borderBottom:
                i < series.events.length - 1
                  ? `1px solid ${colors.borderFaint}`
                  : `1px solid ${colors.borderLight}`,
              textDecoration: "none",
              color: "inherit",
              overflow: "hidden",
              minWidth: 0,
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
              }}
            >
              {event.formattedDate}
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: colors.primary,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {event.name}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {event.trailing}
            </div>
            <span
              aria-hidden="true"
              style={{
                fontSize: 13,
                color: colors.borderSubtle,
              }}
            >
              ›
            </span>
          </Link>
        ))}
    </div>
  );
}
