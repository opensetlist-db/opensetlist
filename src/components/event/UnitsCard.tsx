"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { resolveUnitColor } from "@/lib/artistColor";
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
  /**
   * Member display names that performed in this unit during the
   * current event, joined with ` · ` at render time. Empty array
   * if no members resolved (data gap or unit had no
   * specific-song appearances on this event).
   */
  members: string[];
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
          // Resolve once per row — `resolveUnitColor` returns the
          // unit's `Artist.color` when set, else the brand fallback
          // (`UNIT_COLOR_FALLBACK = colors.primary`). Same rule that
          // tints the Performers card pills, so a "no-color" unit
          // and its members render with one consistent accent.
          const accent = resolveUnitColor(unit);
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
                // Mockup `event-page-desktop-mockup-v2.jsx:573` —
                // `height: 32` matches the two-line content (unit
                // name + members sublist) without overshooting.
                style={{
                  width: 3,
                  height: 32,
                  borderRadius: 2,
                  background: accent,
                  flexShrink: 0,
                }}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <Link
                  href={`/${locale}/artists/${unit.id}/${unit.slug}`}
                  className="hover:underline"
                  // Same `accent` token as the color bar so the
                  // unit name and its bar share one tint — including
                  // the brand-fallback color when `Artist.color`
                  // hasn't been backfilled.
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: accent,
                    textDecoration: "none",
                  }}
                >
                  {unit.name}
                </Link>
                {unit.members.length > 0 && (
                  <div
                    // Mockup `event-page-desktop-mockup-v2.jsx:578` —
                    // 11px muted, 1px breathing room above. Truncates
                    // when the joined string outruns the column.
                    style={{
                      fontSize: 11,
                      color: colors.textMuted,
                      marginTop: 1,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {unit.members.join(" · ")}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
