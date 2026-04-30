"use client";

import { useState } from "react";
// Raw `next/link` Link, not `@/i18n/navigation`'s — the caller passes
// a fully-locale-prefixed `href` from `eventHref(locale, ...)` (project
// convention used by the home + events-list redesigns). The i18n
// navigation Link would double-prefix and produce `/ko/ko/events/...`.
import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import type { ResolvedEventStatus } from "@/lib/eventStatus";
import { colors, radius } from "@/styles/tokens";

export interface PreparedLegEvent {
  // Narrow to JSON-serializable types only — `LegCard` is a `"use
  // client"` component, and Next.js refuses to pass BigInt across the
  // server→client boundary. Page-side mapper must `String(ev.id)` at
  // construction time.
  id: number | string;
  href: string;
  status: ResolvedEventStatus;
  /** Pre-formatted short-form date (e.g. "4월 25일"). */
  formattedDate: string;
  /** Locale-resolved event short name. */
  name: string;
  /** Pre-formatted "🎵 N" — null for non-completed events (mockup §4-3). */
  songCountLabel: string | null;
}

export interface PreparedLeg {
  /** Locale-resolved city or "" for events with no translation + no originalCity. */
  city: string;
  /** Locale-resolved venue (first event's value). */
  venue: string | null;
  /** Pre-formatted date range (e.g. "4월 25일 ~ 4월 26일" or single day). */
  dateRangeLabel: string;
  /**
   * Roll-up status across the leg's events, picked by priority:
   * ongoing → upcoming → completed → cancelled. Drives both the
   * header badge and the city-icon background tint, so a leg that
   * mixes a completed Day.1 with an upcoming Day.2 reads as
   * "upcoming" (the salient state for the viewer).
   */
  legStatus: ResolvedEventStatus;
  events: PreparedLegEvent[];
}

interface Props {
  leg: PreparedLeg;
  /** Resolved labels per status — `ongoing` should be "LIVE" (from
   *  `Event.live`) to match the home + events-list redesign convention;
   *  the others come from `Event.status.{upcoming,completed,cancelled}`. */
  statusLabels: Record<ResolvedEventStatus, string>;
  /** Pre-formatted "{N}공연" — caller resolves via i18n + count. */
  eventCountLabel: string;
  /** Placeholder text for the city when the resolved city is empty. */
  unknownCityLabel: string;
}

/**
 * Map a leg-level status to the icon-tile background tint. Mirrors
 * the same red/green/neutral wash the mockup applies. `cancelled`
 * collapses to the same neutral tile as completed — the per-row
 * badge already conveys cancellation, and a fourth tile color
 * would just dilute the visual hierarchy.
 */
function legIconBackground(status: ResolvedEventStatus): string {
  if (status === "ongoing") return colors.liveBg;
  if (status === "upcoming") return colors.upcomingBg;
  return colors.bgSubtle;
}

export function LegCard({
  leg,
  statusLabels,
  eventCountLabel,
  unknownCityLabel,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const expanded = !collapsed;
  const cityLabel = leg.city.length > 0 ? leg.city : unknownCityLabel;

  return (
    <div
      className="mb-2.5 overflow-hidden"
      style={{
        background: colors.bgCard,
        borderRadius: radius.cardSm,
        border: `1px solid ${colors.border}`,
      }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 text-left"
        style={{
          padding: "14px 16px",
          borderBottom: expanded ? `1px solid ${colors.borderLight}` : "none",
          background: "transparent",
          fontFamily: "inherit",
        }}
      >
        {/* City icon. Background tint matches the leg's roll-up
            status — red for ongoing, green for upcoming, neutral
            for completed/cancelled. Mirrors the mockup's per-status
            tile color. */}
        <div
          aria-hidden="true"
          className="flex flex-shrink-0 items-center justify-center text-lg"
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: legIconBackground(leg.legStatus),
          }}
        >
          📍
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center gap-1.5">
            <span
              className="text-[14px] font-bold"
              style={{ color: colors.textPrimary }}
            >
              {cityLabel}
            </span>
            {/* Always-present leg badge (ongoing / upcoming /
                completed). Cancelled is the one status we suppress
                here — a cancelled leg has nothing left to advertise,
                and the per-row badges already mark each event. */}
            {leg.legStatus !== "cancelled" && (
              <StatusBadge
                status={leg.legStatus}
                label={statusLabels[leg.legStatus]}
                size="sm"
              />
            )}
          </div>
          <div
            className="text-[11px]"
            style={{ color: colors.textMuted }}
          >
            {leg.venue ? `${leg.venue} · ` : ""}
            {leg.dateRangeLabel}
          </div>
        </div>

        <div
          className="flex-shrink-0 text-right"
          style={{ paddingTop: 2 }}
        >
          <div
            className="mb-0.5 text-[11px]"
            style={{ color: colors.textMuted }}
          >
            {eventCountLabel}
          </div>
          <span
            aria-hidden="true"
            className="inline-block text-sm"
            style={{
              color: colors.textMuted,
              transform: collapsed ? "rotate(0deg)" : "rotate(90deg)",
              transition: "transform 0.15s",
            }}
          >
            ›
          </span>
        </div>
      </button>

      {expanded &&
        leg.events.map((event, i) => {
          const isLast = i === leg.events.length - 1;
          return (
            <Link
              key={String(event.id)}
              href={event.href}
              className="flex items-center gap-2.5 row-hover-bg"
              style={{
                padding: "10px 16px 10px 64px",
                borderBottom: isLast
                  ? "none"
                  : `1px solid ${colors.borderFaint}`,
                textDecoration: "none",
              }}
            >
              <StatusBadge
                status={event.status}
                label={statusLabels[event.status]}
                size="sm"
              />
              <span
                className="flex-shrink-0 text-[12px]"
                // 100px to fit `HISTORY_ROW_DATE_FORMAT` post-year-add
                // (operator feedback 2026-04-29). Korean's
                // `2026년 4월 25일` is the tightest at fontSize 12 (~95px);
                // 100px gives a comfortable margin.
                style={{ color: colors.textMuted, width: 100 }}
              >
                {event.formattedDate}
              </span>
              <span
                className="min-w-0 flex-1 truncate text-[13px] font-semibold"
                style={{ color: colors.primary }}
              >
                {event.name}
              </span>
              {event.songCountLabel && (
                <span
                  className="flex-shrink-0 text-[11px]"
                  style={{ color: colors.textMuted }}
                >
                  {event.songCountLabel}
                </span>
              )}
              <span
                aria-hidden="true"
                className="text-sm"
                style={{ color: colors.borderSubtle }}
              >
                ›
              </span>
            </Link>
          );
        })}
    </div>
  );
}
