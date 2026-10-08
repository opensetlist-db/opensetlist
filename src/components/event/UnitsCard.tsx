"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { resolveUnitColor } from "@/lib/artistColor";
import { entityPath } from "@/lib/seo/entityUrl";
import { colors, radius, shadows } from "@/styles/tokens";
// Type lives in `src/lib/types/setlist.ts` so pure helpers under
// `src/lib/` (`deriveSidebarUnitsAndPerformers`) can produce
// `UnitsCardItem`-shaped output without crossing the lib→component
// layer boundary. Re-exported below for back-compat with existing
// `import { UnitsCardItem } from "@/components/event/UnitsCard"`.
import type { UnitsCardItem } from "@/lib/types/setlist";

export type { UnitsCardItem };

interface Props {
  locale: string;
  units: UnitsCardItem[];
  /**
   * Pre-show lineup mode: rows come from the event roster
   * (`deriveLineupFromRoster`), not from performed songs, so the
   * heading says "scheduled" instead of implying these units already
   * performed. Lineup rows include `kind: "group"` section headers;
   * the `"unit"` rows under a group are indented beneath it.
   */
  isLineup?: boolean;
}

/**
 * Sidebar card listing the units that performed any song in this
 * event, deduped by `Artist.id`. Per
 * `event-page-desktop-mockup-v2.jsx:559-582`: each row is a
 * 3px-wide vertical color bar + unit name colored by the bar +
 * an optional members sublist (`花帆 · 銀子 · …`).
 *
 * The members array is populated by the caller from
 * `stageIdentity.artistLinks` — the events page walks each
 * setlist item's performers, looks up which units each
 * StageIdentity belongs to (via the artistLinks rows it just
 * fetched), skips graduated members (links whose `endDate`
 * predates `referenceNow`), and pushes the resulting short names
 * onto the matching unit's `members[]`. This component just
 * renders whatever the caller passes; an empty array
 * short-circuits the sublist render so the row stays compact.
 */
export function UnitsCard({ locale, units, isLineup = false }: Props) {
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
        {isLineup ? t("lineupUnitsLabel") : t("unitsLabel")}
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {units.map((unit, idx) => {
          // Resolve once per row — `resolveUnitColor` returns the
          // unit's `Artist.color` when set, else a deterministic
          // pick from `unitFallbackPalette` keyed on the slug (so
          // multiple color-pending units in the sidebar render with
          // distinguishable hues, and the same unit's color matches
          // its setlist-row pill and its artist-page card).
          const accent = resolveUnitColor(unit);
          const isGroupRow = unit.kind === "group";
          // A unit row is nested when some group header precedes it —
          // only lineup data has group rows, so the live sidebar (no
          // `kind`) renders exactly as before.
          const isNested =
            !isGroupRow && units.slice(0, idx).some((u) => u.kind === "group");
          return (
            <li
              key={unit.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 10,
                // Breathing room above every section header but the
                // first, so each group reads as its own block.
                marginTop: isGroupRow && idx > 0 ? 14 : 0,
                paddingLeft: isNested ? 12 : 0,
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
                  href={entityPath("artists", locale, unit.id, unit.slug)}
                  className="hover:underline"
                  // Same `accent` token as the color bar so the
                  // unit name and its bar share one tint — including
                  // the brand-fallback color when `Artist.color`
                  // hasn't been backfilled.
                  style={{
                    fontSize: isGroupRow ? 14 : 13,
                    fontWeight: isGroupRow ? 800 : 700,
                    color: accent,
                    textDecoration: "none",
                  }}
                >
                  {unit.name}
                  {unit.isGuest && (
                    <span
                      // Muted "· 게스트" / "· ゲスト" / "· Guest" suffix
                      // (D9). Rendered inside the <Link> so it stays
                      // visually grouped with the name, but with its
                      // own color/weight so the suffix doesn't take
                      // on the unit's accent — reads as a small
                      // metadata tag, not part of the unit name.
                      style={{
                        color: colors.textMuted,
                        fontWeight: 500,
                        marginLeft: 4,
                      }}
                    >
                      · {t("guestLabel")}
                    </span>
                  )}
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
