import { colors } from "@/styles/tokens";

/*
 * Round avatar fallback for members and voice actors when imageUrl is
 * absent (Phase 1A reality per pages-ui-handoff.md §6).
 *
 * Personal-color gradient (top-left lighter, bottom-right deeper) +
 * the first character of the supplied label, drawn in the source
 * color so the avatar reads as the character's identity even at small
 * sizes. Square artist/unit avatars use the dedicated <ArtistAvatar>
 * component (different fallback rule — single color or brand
 * gradient). Keep these two components separate; their contracts will
 * diverge over time (e.g. real photos for members, never for groups).
 *
 * Falls back to `colors.textMuted` when no color is supplied — better
 * than rendering a flat black circle when a member is missing the
 * personal-color data.
 */

interface Props {
  label: string;
  color?: string | null;
  size?: number;
}

export function InitialAvatar({ label, color, size = 32 }: Props) {
  const baseColor = color || colors.textMuted;
  const initial = label.charAt(0) || "?";
  // Two-stop gradient using the source color at two alpha levels —
  // baseColor + "40" at 25% opacity for the lighter top-left, and
  // baseColor + "80" at 50% for the deeper bottom-right. The text
  // sits on top in baseColor at full opacity, so contrast is the
  // designer's responsibility per the original mockup.
  const background = `linear-gradient(135deg, ${baseColor}40, ${baseColor}80)`;

  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flexShrink: 0,
        background,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(size * 0.4),
        fontWeight: 700,
        color: baseColor,
        lineHeight: 1,
        userSelect: "none",
      }}
    >
      {initial}
    </div>
  );
}
