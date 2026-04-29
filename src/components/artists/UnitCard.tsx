"use client";

import { useState } from "react";
import Link from "next/link";
import { colors, radius } from "@/styles/tokens";

/*
 * Sub-unit card on the artist detail page (overview tab). Per
 * `raw/mockups/artist-page-mockup.jsx` lines 102-133, the card has a
 * left vertical color-stripe (4×18) sized to the unit's brand color,
 * the unit name in that color, and member name chips below.
 *
 * Hover treatment is per-unit-color: the resting border is neutral
 * gray, and on hover the border + background tint shift to the
 * unit's color (`unit.color` solid or its alpha-tinted variant).
 *
 * Client component because hover paints with a dynamically-derived
 * color — a dynamic-class Tailwind variant would still pin to a
 * fixed palette, so a state-driven inline style is the cleanest fit.
 *
 * Color fallback chain (matches `<ArtistAvatar>`):
 *   - `stripeBg`: solid `unit.color` OR `BRAND_GRADIENT`
 *   - `unitColor` (text + hover border): solid `unit.color` OR
 *     `colors.primary`
 * The page resolves both before passing them in so the chain stays
 * in one place per `raw/artist-color-handoff.md`.
 */

interface Props {
  href: string;
  unitName: string;
  /** Solid color used for the unit name text and the hover-state
   *  border. Pass `colors.primary` as fallback when `unit.color`
   *  is null. */
  unitColor: string;
  /** Background of the 4×18 left-stripe. Can be a solid hex (when
   *  `unit.color` is set) or a gradient string (BRAND_GRADIENT
   *  fallback when null). */
  stripeBg: string;
  members: string[];
}

export function UnitCard({ href, unitName, unitColor, stripeBg, members }: Props) {
  const [hovered, setHovered] = useState(false);
  return (
    <Link
      href={href}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "block",
        textDecoration: "none",
        color: "inherit",
        // Hover: paint border in the unit's color and tint the bg
        // with an alpha-overlay of the same color (matches mockup
        // `unit.color + "08"`). Resting state is neutral gray border
        // on a white card.
        border: `1.5px solid ${hovered ? unitColor : colors.border}`,
        borderRadius: 14,
        padding: "14px 16px",
        background: hovered ? `${unitColor}08` : colors.bgCard,
        flex: "1 1 140px",
        minWidth: 0,
        transition: "border-color 0.12s ease, background 0.12s ease",
      }}
    >
      <div
        style={{
          width: 4,
          height: 18,
          borderRadius: 2,
          background: stripeBg,
          marginBottom: 10,
        }}
      />
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: unitColor,
          marginBottom: 6,
        }}
      >
        {unitName}
      </div>
      {members.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {members.map((m, i) => (
            <span
              key={i}
              style={{
                fontSize: 11,
                color: colors.textSecondary,
                background: colors.bgSubtle,
                borderRadius: radius.chip,
                padding: "2px 7px",
              }}
            >
              {m}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
