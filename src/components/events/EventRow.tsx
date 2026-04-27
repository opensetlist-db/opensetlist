"use client";

import { useState } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import type { ResolvedEventStatus } from "@/lib/eventStatus";
import { colors } from "@/styles/tokens";

interface Props {
  href: string;
  status: ResolvedEventStatus;
  statusLabel: string;
  monthLabel: string;
  dayNumber: string;
  eventName: string;
  venueCity: string | null;
  /** Pre-formatted "🎵 N" — only set for completed events. */
  songCountLabel: string | null;
  isLast: boolean;
}

export function EventRow({
  href,
  status,
  statusLabel,
  monthLabel,
  dayNumber,
  eventName,
  venueCity,
  songCountLabel,
  isLast,
}: Props) {
  const [active, setActive] = useState(false);
  return (
    <Link
      href={href}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      className="flex items-start gap-3 transition-colors"
      style={{
        padding: "11px 16px",
        borderBottom: isLast ? "none" : `1px solid ${colors.borderLight}`,
        background: active ? colors.bgSubtle : "transparent",
      }}
    >
      <div
        className="flex-shrink-0 text-center"
        style={{ width: 36, paddingTop: 1 }}
      >
        <div
          className="text-[11px] font-semibold"
          style={{ color: colors.textMuted }}
        >
          {monthLabel}
        </div>
        <div
          className="text-[16px] font-bold"
          style={{ color: colors.textPrimary, lineHeight: 1.1 }}
        >
          {dayNumber}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={status} label={statusLabel} size="sm" />
        </div>
        <div
          className="mb-0.5 text-[13px] font-bold"
          style={{ color: colors.textPrimary, lineHeight: 1.4 }}
        >
          {eventName}
        </div>
        {venueCity && (
          <div
            className="text-[12px]"
            style={{ color: colors.textSubtle }}
          >
            {venueCity}
          </div>
        )}
      </div>

      <div
        className="flex flex-shrink-0 flex-col items-end gap-1"
        style={{ paddingTop: 2 }}
      >
        {songCountLabel && (
          <span
            className="text-[11px]"
            style={{ color: colors.textMuted }}
          >
            {songCountLabel}
          </span>
        )}
        <span
          aria-hidden="true"
          className="text-sm"
          style={{ color: colors.borderSubtle }}
        >
          ›
        </span>
      </div>
    </Link>
  );
}
