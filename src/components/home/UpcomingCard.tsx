"use client";

import { useState } from "react";
import Link from "next/link";
import EventStatusTicker from "@/components/EventStatusTicker";
import { colors, radius } from "@/styles/tokens";

interface Props {
  href: string;
  startTimeIso: string | null;
  seriesName: string | null;
  eventName: string;
  venue: string | null;
  formattedDate: string;
  dDayLabel: string;
  /**
   * Mobile horizontal scroll vs. desktop sidebar list. Mobile cards
   * are flex-shrink-0 with a fixed width inside the scroll container;
   * desktop cards stretch to fill the 340px sidebar column.
   */
  variant?: "scroll" | "stack";
}

export function UpcomingCard({
  href,
  startTimeIso,
  seriesName,
  eventName,
  venue,
  formattedDate,
  dDayLabel,
  variant = "stack",
}: Props) {
  // Hover via React state (not a Tailwind arbitrary `hover:bg-[#...]`)
  // so the bg color reads from `colors.primaryHoverBg` and a token
  // change propagates here automatically.
  const [hovered, setHovered] = useState(false);
  return (
    <Link
      href={href}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={[
        "block transition-colors",
        variant === "scroll" ? "w-[200px] flex-shrink-0" : "w-full",
      ].join(" ")}
      style={{
        background: hovered ? colors.primaryHoverBg : colors.bgCard,
        border: `1.5px solid ${colors.border}`,
        borderRadius: radius.cardSm,
        padding: "14px 16px",
      }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <span
          className="text-[11px] font-bold"
          style={{
            color: colors.upcoming,
            background: colors.upcomingBg,
            border: `1px solid ${colors.upcomingBorder}`,
            borderRadius: radius.badge,
            padding: "2px 8px",
          }}
        >
          {dDayLabel}
        </span>
        <span
          className="text-[11px]"
          style={{ color: colors.textMuted }}
        >
          {formattedDate}
        </span>
      </div>
      {seriesName && (
        <div
          className="mb-1 text-[11px] font-semibold"
          style={{ color: colors.primary }}
        >
          {seriesName}
        </div>
      )}
      <div
        className="text-[13px] font-bold"
        style={{ color: colors.textPrimary, lineHeight: 1.4 }}
      >
        {eventName}
      </div>
      {venue && (
        <div
          className="mt-1.5 text-[11px]"
          style={{ color: colors.textMuted }}
        >
          📍 {venue}
        </div>
      )}
      <EventStatusTicker startTime={startTimeIso} />
    </Link>
  );
}
