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
 * Color fallback chain: caller resolves via `resolveUnitColor(unit)`
 * which returns `Artist.color` if set, else a deterministic pick
 * from `unitFallbackPalette` keyed on the unit's slug. The same
 * resolved color drives both the 4×18 left-stripe and the
 * text/hover-border, so multiple color-pending sub-units on the
 * same artist page render with distinguishable hues — and the same
 * unit's color matches its event-page setlist-row pill since both
 * surfaces consume the same resolver.
 */

interface Props {
  href: string;
  unitName: string;
  /** Solid color used for the unit name text and the hover-state
   *  border. Always set — caller resolves via `resolveUnitColor`. */
  unitColor: string;
  /** Background of the 4×18 left-stripe. Caller may pass the same
   *  resolved color as `unitColor` (most consumers do); a different
   *  value is allowed if a future call site wants a distinct stripe
   *  treatment without forking the prop shape. */
  stripeBg: string;
  members: string[];
}

export function UnitCard({ href, unitName, unitColor, stripeBg, members }: Props) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // Mirror the hover treatment for keyboard focus so tab-navigated
  // users get the same visual signal of "this card is the active
  // target." The Link is natively focusable (anchor tag), so we
  // just need to wire onFocus/onBlur.
  const active = hovered || focused;
  return (
    <Link
      href={href}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        display: "block",
        textDecoration: "none",
        color: "inherit",
        // Active (hover or focus): paint border in the unit's color
        // and tint the bg with an alpha-overlay of the same color
        // (matches mockup `unit.color + "08"`). Resting state is
        // neutral gray border on a white card.
        border: `1.5px solid ${active ? unitColor : colors.border}`,
        borderRadius: 14,
        padding: "14px 16px",
        background: active ? `${unitColor}08` : colors.bgCard,
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
