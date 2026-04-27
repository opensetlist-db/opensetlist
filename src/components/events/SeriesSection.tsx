"use client";

import { useState, type ReactNode } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { colors, radius, shadows } from "@/styles/tokens";

interface Props {
  seriesName: string;
  hasOngoing: boolean;
  /** Pre-resolved label, e.g. "{count} 공연" via i18n plural rule. */
  eventCountLabel: string;
  /** Resolved label for the LIVE pill when `hasOngoing` is true. */
  liveLabel: string;
  /** Event rows pre-rendered by the page so this stays presentational. */
  children: ReactNode;
}

export function SeriesSection({
  seriesName,
  hasOngoing,
  eventCountLabel,
  liveLabel,
  children,
}: Props) {
  // Default expanded. Series with an ongoing event are pinned open
  // (per task §3-3) — the chevron disappears and clicks are no-ops.
  const [collapsed, setCollapsed] = useState(false);
  const expanded = hasOngoing || !collapsed;

  return (
    <div
      className="mb-3 overflow-hidden"
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
        className="flex w-full items-center justify-between text-left"
        style={{
          padding: "14px 16px",
          borderBottom: expanded
            ? `1px solid ${colors.borderLight}`
            : "none",
          cursor: hasOngoing ? "default" : "pointer",
          background: "transparent",
          fontFamily: "inherit",
        }}
      >
        <div className="min-w-0 flex-1">
          {hasOngoing && (
            <div className="mb-1.5 flex items-center gap-1.5">
              <StatusBadge
                status="ongoing"
                label={liveLabel}
                size="sm"
              />
            </div>
          )}
          <div
            className="text-[14px] font-bold"
            style={{ color: colors.textPrimary, lineHeight: 1.35 }}
          >
            {seriesName}
          </div>
          <div
            className="mt-0.5 text-[11px]"
            style={{ color: colors.textMuted }}
          >
            {eventCountLabel}
          </div>
        </div>
        {/* Hide the chevron on ongoing-pinned sections — it would
            falsely signal collapse-ability. */}
        {!hasOngoing && (
          <span
            aria-hidden="true"
            className="ml-2 inline-block text-base"
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

      {expanded && <div>{children}</div>}
    </div>
  );
}
