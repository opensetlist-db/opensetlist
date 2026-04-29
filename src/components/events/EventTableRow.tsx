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
  /** Pre-formatted "🎵 N" — only set for completed events. */
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
  // Hover + focus highlight is handled by the global `.row-hover-bg`
  // CSS rule (globals.css). Replaces the previous useState + four
  // event handlers — same hover *and* keyboard-focus behavior, less
  // local plumbing. Server component now (no `"use client"`) since
  // there's no client-side state left.
  return (
    <Link
      href={href}
      className="row-hover-bg grid items-center"
      style={{
        gridTemplateColumns: EVENT_TABLE_COLUMNS,
        padding: "10px 20px",
        borderBottom: `1px solid ${colors.borderLight}`,
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
