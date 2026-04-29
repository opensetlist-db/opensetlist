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
        // Left-aligned so the 🎵 emoji pins to the left edge of
        // the 60px cell and lines up cleanly across rows. The
        // mockup originally specified text-right, which kept the
        // digit's right edge fixed but floated the emoji's x with
        // digit count (8 → 28 → 100 each shifted the emoji a few
        // px). User feedback: "rows are not aligned if the song
        // number digit count is different" — left-aligning fixes
        // it because the emoji is the visually salient column
        // marker; the digit then ranges within the cell, which
        // reads as natural variation rather than misalignment.
        className="text-left text-[12px]"
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
