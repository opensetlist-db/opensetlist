"use client";

import { useTranslations } from "next-intl";
import { colors, radius, shadows } from "@/styles/tokens";

export interface PerformersCardItem {
  /** StageIdentity uuid — already a string, used directly as React key. */
  id: string;
  /** Resolved character name — caller passes `displayNameWithFallback(..., "full")`. */
  name: string;
  /**
   * Tint color for this character's pill — the resolved color of
   * their primary unit (caller passes `resolveUnitColor(unit)`,
   * which substitutes a deterministic palette pick keyed on the
   * unit's slug when `Artist.color` is null, so multiple
   * color-pending units render with distinguishable hues). Always
   * set so every pill renders with a visible accent.
   */
  color: string;
}

interface Props {
  performers: PerformersCardItem[];
}

/**
 * Sidebar card listing every character who appeared in this event's
 * setlist (deduped by `StageIdentity.id`), styled per
 * `event-page-desktop-mockup-v2.jsx:584-610`. Each pill is a small
 * colored dot + character name, tinted by the character's primary
 * unit color — caller resolves via `resolveUnitColor(primaryUnit)`,
 * which substitutes a deterministic palette pick (keyed on the
 * unit's slug) when `Artist.color` is null. Personal `StageIdentity.color`
 * is intentionally NOT used: operator wants the lineup to read as
 * "members of these units" (one consistent palette per unit) rather
 * than "individual character palette". Mockup uses `${color}12`
 * (~7% alpha) for the pill background — matched here via an 8-digit
 * hex append.
 */
export function PerformersCard({ performers }: Props) {
  const t = useTranslations("Event");
  if (performers.length === 0) return null;
  return (
    <section
      style={{
        background: colors.bgCard,
        borderRadius: radius.card,
        padding: "18px 20px",
        boxShadow: shadows.card,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: colors.textMuted,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          marginBottom: 14,
        }}
      >
        {t("performersLabel")}
      </div>
      <ul
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          listStyle: "none",
          padding: 0,
          margin: 0,
        }}
      >
        {performers.map((p) => (
          <li
            key={p.id}
            // Pill bg uses the unit color at ~7% alpha (`#RRGGBB12`)
            // per the desktop mockup; dot + text use it at full
            // opacity. `color` is always set (`resolveUnitColor`
            // applied upstream), so no null branch.
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              background: `${p.color}12`,
              borderRadius: 20,
              padding: "4px 10px 4px 6px",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: p.color,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: p.color,
              }}
            >
              {p.name}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
