import { colors } from "@/styles/tokens";

/*
 * Small uppercase section label with a bottom border. Used inside
 * info-card sections (subunits / members / 최근 공연) and impression
 * sections per shared-components handoff §6. Visual: 13px, weight 700,
 * `colors.textMuted`, letter-spacing 0.06em — distinct from a regular
 * <h2> (which is 16-20px and not all-caps). Sized per the artist-page
 * mockup; other detail pages inherit the same scale.
 *
 * Renders a real <h2> for accessibility (the bottom border + uppercase
 * is purely visual — screen readers still get a section heading).
 * Pass `as="h3"` etc. when this needs to nest under another <h2>
 * to keep the heading level hierarchy correct.
 */

interface Props {
  children: React.ReactNode;
  as?: "h2" | "h3" | "h4";
  /**
   * Drop the bottom border + paddingBottom and shrink the bottom margin
   * to 8px. Use when the label sits inside a tighter section (e.g. the
   * "참여 유닛" pill cloud, or the songs-tab "basis" header) where the
   * mockup never shows a divider line under the label.
   */
  noBorder?: boolean;
}

export function SectionLabel({ children, as = "h2", noBorder = false }: Props) {
  const Tag = as;
  return (
    <Tag
      style={{
        // Reset the browser default <h2> margins via longhand
        // declarations only — a shorthand `margin: 0` later in the
        // object would otherwise overwrite `marginBottom: 12` and
        // collapse the intentional 12px gap above the underline.
        marginTop: 0,
        marginRight: 0,
        marginBottom: noBorder ? 8 : 12,
        marginLeft: 0,
        paddingBottom: noBorder ? 0 : 8,
        fontSize: 13,
        fontWeight: 700,
        color: colors.textMuted,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        borderBottom: noBorder ? "none" : `1px solid ${colors.borderLight}`,
        lineHeight: 1.4,
      }}
    >
      {children}
    </Tag>
  );
}
