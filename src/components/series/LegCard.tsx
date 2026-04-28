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
  id: number | string | bigint;
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
  /** Drives the LIVE badge on the header + the leg's sort priority. */
  hasOngoing: boolean;
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

export function LegCard({
  leg,
  statusLabels,
  eventCountLabel,
  unknownCityLabel,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const expanded = !collapsed;

  // Derive a leg-level status pill — only show when the leg has an
  // ongoing event (mockup pins this to legStatus="ongoing"; we don't
  // bother surfacing upcoming/completed leg-level status since the
  // per-row badges already convey it).
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
        {/* City icon. Background tint matches the leg's status — red
            wash when ongoing, neutral otherwise. */}
        <div
          aria-hidden="true"
          className="flex flex-shrink-0 items-center justify-center text-lg"
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: leg.hasOngoing ? colors.liveBg : colors.bgSubtle,
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
            {leg.hasOngoing && (
              <StatusBadge
                status="ongoing"
                label={statusLabels.ongoing}
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
              key={event.id}
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
                style={{ color: colors.textMuted, width: 48 }}
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
