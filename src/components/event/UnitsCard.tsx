"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { colors, radius, shadows } from "@/styles/tokens";

export interface UnitsCardItem {
  id: string;
  slug: string;
  name: string;
  /**
   * Unit color (e.g. `#e91e8c`). Null when the operator hasn't
   * backfilled the brand color yet — falls back to a brand-tinted
   * border so the card reads as "unit, color pending" rather than
   * "no unit".
   */
  color: string | null;
}

interface Props {
  locale: string;
  units: UnitsCardItem[];
}

/**
 * Sidebar card listing the units that performed any song in this
 * event, deduped by `Artist.id`. Per
 * `event-page-desktop-mockup-v2.jsx:559-582`: each row is a
 * 3px-wide vertical color bar + unit name colored by the bar.
 *
 * The mockup also lists members per unit; resolving that requires
 * `stageIdentity.artistLinks` joins that aren't in the current
 * page query — deferred. The card still ships the unit names so
 * the operator can see who's on the lineup at a glance.
 */
export function UnitsCard({ locale, units }: Props) {
  const t = useTranslations("Event");
  if (units.length === 0) return null;
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
        {t("unitsLabel")}
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {units.map((unit) => {
          const accent = unit.color ?? colors.borderSubtle;
          return (
            <li
              key={unit.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 10,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 3,
                  height: 24,
                  borderRadius: 2,
                  background: accent,
                  flexShrink: 0,
                }}
              />
              <Link
                href={`/${locale}/artists/${unit.id}/${unit.slug}`}
                className="hover:underline"
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: unit.color ?? colors.textPrimary,
                  textDecoration: "none",
                  minWidth: 0,
                  flex: 1,
                }}
              >
                {unit.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
