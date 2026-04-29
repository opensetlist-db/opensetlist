import { colors } from "@/styles/tokens";

/*
 * Small uppercase caption that sits below a big stat number — the
 * "TOTAL EVENTS" / "COMPLETED" / "CITIES" labels in the artist /
 * member / series detail sidebars and the ArtistCard right-side
 * metric. Visual: 10px regular weight, `colors.textMuted`,
 * letter-spacing 0.04em, uppercase. Distinct from `<SectionLabel>`
 * (13px / 700 / has bottom border by default) — section labels
 * head a section, stats sub-labels caption a number.
 *
 * Tightening trade-off: `fontWeight: 700` + `letterSpacing: 0.06em`
 * matches `<SectionLabel>` but expanded English text width by ~30%
 * with `textTransform: uppercase` on, and the artist detail
 * sidebar's 3-in-a-row stats column (~80px each) wrapped
 * "TOTAL EVENTS" / "SUB-UNITS" onto two rows. Default weight + the
 * tighter 0.04em spacing keep them on one row.
 *
 * Server component (no "use client") so it composes inside both
 * server pages (artist / member / series detail) and existing
 * client surfaces (ArtistCard).
 */

interface Props {
  children: React.ReactNode;
  /**
   * Optional style override merged on top of the base. The series
   * sidebar's 2×2 stats grid uses this to add `marginTop: 1` so
   * the caption sits 1px below the stat number.
   */
  style?: React.CSSProperties;
}

export function StatsSubLabel({ children, style }: Props) {
  return (
    <div
      style={{
        fontSize: 10,
        color: colors.textMuted,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
