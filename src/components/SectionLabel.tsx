import { colors } from "@/styles/tokens";

/*
 * Small uppercase section label with a bottom border. Used inside
 * info-card sections (subunits / members / 최근 공연) and impression
 * sections per shared-components handoff §6. Visual: 11px, weight 700,
 * `colors.textMuted`, letter-spacing 0.08em — distinct from a regular
 * <h2> (which is 16-20px and not all-caps).
 *
 * Renders a real <h2> for accessibility (the bottom border + uppercase
 * is purely visual — screen readers still get a section heading).
 * Pass `as="h3"` etc. when this needs to nest under another <h2>
 * to keep the heading level hierarchy correct.
 */

interface Props {
  children: React.ReactNode;
  as?: "h2" | "h3" | "h4";
}

export function SectionLabel({ children, as = "h2" }: Props) {
  const Tag = as;
  return (
    <Tag
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: colors.textMuted,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        marginBottom: 12,
        paddingBottom: 8,
        borderBottom: `1px solid ${colors.borderLight}`,
        margin: 0,
        marginInlineEnd: 0,
        lineHeight: 1.4,
      }}
    >
      {children}
    </Tag>
  );
}
