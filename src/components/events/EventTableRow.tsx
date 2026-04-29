"use client";

import { useState } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import { EVENT_TABLE_COLUMNS } from "@/components/events/tableLayout";
import type { ResolvedEventStatus } from "@/lib/eventStatus";
import { colors } from "@/styles/tokens";

interface Props {
  href: string;
  status: ResolvedEventStatus;
  statusLabel: string;
  /** Pre-formatted "12월 7일" via formatDate. */
  shortDate: string;
  eventName: string;
  venueCity: string | null;
  /** Pre-formatted "🎵 N" — set for completed and ongoing events
   *  (final / running tally). Null for upcoming / cancelled. */
  songCountLabel: string | null;
}

export function EventTableRow({
  href,
  status,
  statusLabel,
  shortDate,
  eventName,
  venueCity,
  songCountLabel,
}: Props) {
  const [active, setActive] = useState(false);
  return (
    <Link
      href={href}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      className="grid items-center transition-colors"
      style={{
        gridTemplateColumns: EVENT_TABLE_COLUMNS,
        padding: "10px 20px",
        borderBottom: `1px solid ${colors.borderLight}`,
        background: active ? colors.bgSubtle : "transparent",
      }}
    >
      <span
        className="text-[13px]"
        style={{ color: colors.textSecondary }}
      >
        {shortDate}
      </span>
      <div>
        <StatusBadge status={status} label={statusLabel} size="sm" />
      </div>
      <span
        className="truncate text-[13px] font-bold"
        style={{ color: colors.primary }}
      >
        {eventName}
      </span>
      <span
        className="truncate text-[12px]"
        style={{ color: colors.textSubtle }}
      >
        {venueCity ?? ""}
      </span>
      <span
        className="text-right text-[12px]"
        style={{ color: colors.textMuted }}
      >
        {songCountLabel ?? ""}
      </span>
      <span
        aria-hidden="true"
        className="text-right text-sm"
        style={{ color: colors.borderSubtle }}
      >
        ›
      </span>
    </Link>
  );
}
