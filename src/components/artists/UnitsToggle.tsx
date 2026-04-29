"use client";

import { useState, type ReactNode } from "react";
import { colors } from "@/styles/tokens";

/*
 * Layout wrapper for the artist detail page's sub-unit list.
 *
 * Default behavior (operator preference, 2026-04-28): show only main
 * units (`Artist.isMainUnit = true`). The non-main units stay hidden
 * behind a toggle so a tour-heavy parent like 蓮ノ空 doesn't bury its
 * canonical Cerise Bouquet / DOLLCHESTRA / Mira-Cra Park / Edel Note
 * cards under every event-specific or member-pair sub-configuration.
 *
 * Layout: a single flex-wrap row that holds main cards (always) and
 * other cards (gated on toggle). Toggle button sits below the flex
 * row so the relayout is contained.
 */

interface Props {
  mainCards: ReactNode[];
  otherCards: ReactNode[];
  showLabel: string;
  hideLabel: string;
}

export function UnitsToggle({
  mainCards,
  otherCards,
  showLabel,
  hideLabel,
}: Props) {
  const [showOthers, setShowOthers] = useState(false);
  const hasOthers = otherCards.length > 0;
  return (
    <>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {mainCards}
        {showOthers && otherCards}
      </div>
      {hasOthers && (
        <button
          type="button"
          onClick={() => setShowOthers((v) => !v)}
          style={{
            marginTop: 12,
            padding: "6px 14px",
            border: `1px solid ${colors.border}`,
            borderRadius: 20,
            background: colors.bgCard,
            color: colors.textSecondary,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {showOthers ? hideLabel : showLabel}
        </button>
      )}
    </>
  );
}
