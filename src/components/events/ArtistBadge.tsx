import { colors, radius } from "@/styles/tokens";

/**
 * Small primary-tinted pill carrying a locale-resolved artist short
 * name (setlist rows and sections).
 *
 * Two padding variants: a tighter `sm` (`1px 7px`) and a roomier `md`
 * (`2px 9px`). The padding difference is the only styling delta;
 * everything else stays locked.
 */
type Size = "sm" | "md";

const PADDING: Record<Size, string> = {
  sm: "1px 7px",
  md: "2px 9px",
};

interface Props {
  label: string;
  size?: Size;
}

export function ArtistBadge({ label, size = "sm" }: Props) {
  return (
    <span
      className="text-[11px] font-bold"
      style={{
        color: colors.primary,
        background: colors.primaryBg,
        borderRadius: radius.tag,
        padding: PADDING[size],
        lineHeight: 1.4,
      }}
    >
      {label}
    </span>
  );
}
