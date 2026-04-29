"use client";

import { useState } from "react";
import Link from "next/link";
import { InitialAvatar } from "@/components/InitialAvatar";
import { colors } from "@/styles/tokens";

/*
 * Member chip on the artist detail page (overview tab).
 *
 * Per `raw/mockups/artist-page-mockup.jsx` lines 136-171, hovering
 * the chip paints the border + background tint with the owning
 * unit's color (`unitColor + "40"` for border, `unitColor + "12"`
 * for bg). Resting state is neutral (`colors.bgSubtle` bg,
 * `colors.borderLight` border).
 *
 * Client component because hover paints with a dynamically-derived
 * unit color — same constraint as `<UnitCard>`. Resolved labels
 * (`memberName`, `unitName`) come pre-cascaded from the page so this
 * component stays out of i18n + locale logic.
 */

interface Props {
  href: string;
  memberName: string;
  /** Sub-unit name shown below the member name (e.g. "DOLLCHESTRA"),
   *  or null if the member has no owning sub-unit. */
  unitName: string | null;
  /** Solid color for the avatar + unit-name text + hover treatment.
   *  Page resolves: owning unit's color → member's own color →
   *  `colors.textMuted`. */
  unitColor: string;
}

export function MemberChip({ href, memberName, unitName, unitColor }: Props) {
  const [hovered, setHovered] = useState(false);
  return (
    <Link
      href={href}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        // Hover paints both border and bg with the unit color at low
        // alpha. Resting state stays in the project's neutral chip
        // palette so a long row of chips reads cleanly.
        background: hovered ? `${unitColor}12` : colors.bgSubtle,
        border: `1px solid ${hovered ? `${unitColor}40` : colors.borderLight}`,
        borderRadius: 12,
        padding: "8px 12px",
        flex: "1 1 140px",
        minWidth: 0,
        textDecoration: "none",
        color: "inherit",
        transition: "background 0.12s ease, border-color 0.12s ease",
      }}
    >
      <InitialAvatar label={memberName} color={unitColor} size={32} />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: colors.textPrimary,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {memberName}
        </div>
        {unitName && (
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: unitColor,
            }}
          >
            {unitName}
          </div>
        )}
      </div>
    </Link>
  );
}
