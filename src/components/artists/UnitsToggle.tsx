"use client";

import { useId, useState, type ReactNode } from "react";
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
  // Stable id pairs the disclosure button with its controlled region
  // for `aria-controls`. `useId` is React's collision-safe generator;
  // multiple <UnitsToggle> instances on a page get distinct ids
  // automatically.
  const otherCardsId = useId();
  return (
    <>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {mainCards}
      </div>
      {hasOthers && (
        <div
          id={otherCardsId}
          // Use the `hidden` attribute (not `display: none` via CSS)
          // so the controlled region stays in the DOM tree at a stable
          // id; assistive tech still resolves `aria-controls` even
          // while the region is collapsed.
          hidden={!showOthers}
          style={{
            display: showOthers ? "flex" : undefined,
            gap: 10,
            flexWrap: "wrap",
            marginTop: 10,
          }}
        >
          {otherCards}
        </div>
      )}
      {hasOthers && (
        <button
          type="button"
          aria-expanded={showOthers}
          aria-controls={otherCardsId}
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
