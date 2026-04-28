"use client";

import { useTranslations } from "next-intl";
import { colors, radius, shadows } from "@/styles/tokens";

export interface PerformersCardItem {
  /** StageIdentity uuid — already a string, used directly as React key. */
  id: string;
  /** Resolved character name — caller passes `displayNameWithFallback(..., "short")`. */
  name: string;
  /**
   * Personal color from `StageIdentity.color`. Null when not set —
   * pill falls back to `colors.textSubtle` + `colors.bgSubtle` so
   * un-colored characters render legibly without inventing a brand
   * color for them.
   */
  color: string | null;
}

interface Props {
  performers: PerformersCardItem[];
}

/**
 * Sidebar card listing every character who appeared in this event's
 * setlist (deduped by `StageIdentity.id`), styled per
 * `event-page-desktop-mockup-v2.jsx:584-610`. Each pill is a small
 * colored dot + character name, tinted by the character's personal
 * color (`StageIdentity.color`). Mockup uses `${color}12` (~7% alpha)
 * for the pill background — matched here via an 8-digit hex append.
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
        {performers.map((p) => {
          const colored = p.color != null;
          return (
            <li
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                background: colored ? `${p.color}12` : colors.bgSubtle,
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
                  background: colored ? p.color! : colors.textSubtle,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: colored ? p.color! : colors.textSubtle,
                }}
              >
                {p.name}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
