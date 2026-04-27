"use client";

import { useState } from "react";
import Link from "next/link";
import { colors } from "@/styles/tokens";

interface Props {
  href: string;
  seriesName: string | null;
  eventName: string;
  venue: string | null;
  songCountLabel: string;
  monthLabel: string;
  dayNumber: string;
  isLast: boolean;
}

export function RecentEventRow({
  href,
  seriesName,
  eventName,
  venue,
  songCountLabel,
  monthLabel,
  dayNumber,
  isLast,
}: Props) {
  // Hover/focus via React state (not Tailwind `hover:bg-[#...]`) so the
  // bg reads from `colors.bgSubtle` and a token change propagates here.
  // Focus handlers mirror hover so keyboard-only navigation gets the
  // same row highlight that mouse users see.
  const [active, setActive] = useState(false);
  return (
    <Link
      href={href}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      className="flex items-center gap-3 transition-colors"
      style={{
        padding: "12px 16px",
        borderBottom: isLast ? "none" : `1px solid ${colors.borderLight}`,
        background: active ? colors.bgSubtle : "transparent",
      }}
    >
      <div
        className="flex-shrink-0 text-center"
        style={{ width: 32 }}
      >
        <div
          className="text-[10px] font-semibold"
          style={{ color: colors.textMuted }}
        >
          {monthLabel}
        </div>
        <div
          className="text-[15px] font-bold"
          style={{ color: colors.textPrimary, lineHeight: 1.1 }}
        >
          {dayNumber}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        {seriesName && (
          <div
            className="mb-0.5 text-[11px] font-semibold"
            style={{ color: colors.primary }}
          >
            {seriesName}
          </div>
        )}
        <div
          className="truncate text-[13px] font-bold"
          style={{ color: colors.textPrimary }}
        >
          {eventName}
        </div>
        <div
          className="mt-0.5 text-[11px]"
          style={{ color: colors.textMuted }}
        >
          {venue ? `${venue} · ${songCountLabel}` : songCountLabel}
        </div>
      </div>

      <span
        aria-hidden="true"
        className="flex-shrink-0 text-sm"
        style={{ color: colors.borderSubtle }}
      >
        ›
      </span>
    </Link>
  );
}
