"use client";

import { useState, type ReactNode } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { EVENT_TABLE_COLUMNS } from "@/components/events/tableLayout";
import { colors, radius, shadows } from "@/styles/tokens";

interface Props {
  seriesName: string;
  /**
   * Locale-resolved short name of the root series's artist, or null
   * when the series has no `artistId` (multi-artist festival). Mirrors
   * the same prop on `SeriesSection`; rendered as a small primary-tinted
   * pill at the start of the header badge row.
   */
  artistShortName: string | null;
  hasOngoing: boolean;
  eventCountLabel: string;
  liveLabel: string;
  /** Resolved labels for the table-header strip. */
  tableHeader: {
    date: string;
    status: string;
    name: string;
    venue: string;
    songs: string;
  };
  /** Pre-rendered EventTableRow children. */
  children: ReactNode;
}

export function SeriesBlock({
  seriesName,
  artistShortName,
  hasOngoing,
  eventCountLabel,
  liveLabel,
  tableHeader,
  children,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const expanded = hasOngoing || !collapsed;

  return (
    <div
      className="mb-4 overflow-hidden"
      style={{
        background: colors.bgCard,
        borderRadius: radius.card,
        boxShadow: shadows.card,
      }}
    >
      <button
        type="button"
        onClick={() => {
          if (!hasOngoing) setCollapsed((c) => !c);
        }}
        aria-expanded={expanded}
        disabled={hasOngoing}
        className="flex w-full items-center gap-3.5 text-left"
        style={{
          padding: "16px 20px",
          borderBottom: expanded
            ? `2px solid ${colors.borderLight}`
            : "none",
          cursor: hasOngoing ? "default" : "pointer",
          background: "transparent",
          fontFamily: "inherit",
        }}
      >
        <div className="flex-1">
          <div className="mb-1.5 flex items-center gap-2">
            {artistShortName && (
              <span
                className="text-[11px] font-bold"
                style={{
                  color: colors.primary,
                  background: colors.primaryBg,
                  borderRadius: radius.tag,
                  padding: "2px 9px",
                  lineHeight: 1.4,
                }}
              >
                {artistShortName}
              </span>
            )}
            {hasOngoing && (
              <StatusBadge
                status="ongoing"
                label={liveLabel}
                size="sm"
              />
            )}
            <span
              className="text-[11px]"
              style={{ color: colors.textMuted }}
            >
              {eventCountLabel}
            </span>
          </div>
          <div
            className="text-[15px] font-bold"
            style={{ color: colors.textPrimary }}
          >
            {seriesName}
          </div>
        </div>
        {!hasOngoing && (
          <span
            aria-hidden="true"
            className="inline-block text-lg"
            style={{
              color: colors.textMuted,
              transform: collapsed ? "rotate(0deg)" : "rotate(90deg)",
              transition: "transform 0.2s",
            }}
          >
            ›
          </span>
        )}
      </button>

      {expanded && (
        <>
          <div
            className="grid"
            style={{
              gridTemplateColumns: EVENT_TABLE_COLUMNS,
              padding: "7px 20px",
              background: colors.bgFaint,
              borderBottom: `1px solid ${colors.border}`,
            }}
          >
            {[
              tableHeader.date,
              tableHeader.status,
              tableHeader.name,
              tableHeader.venue,
              tableHeader.songs,
              "",
            ].map((label, i) => (
              <span
                key={i}
                className="text-[11px] font-bold uppercase"
                style={{
                  color: colors.textMuted,
                  letterSpacing: "0.05em",
                }}
              >
                {label}
              </span>
            ))}
          </div>
          <div>{children}</div>
        </>
      )}
    </div>
  );
}
