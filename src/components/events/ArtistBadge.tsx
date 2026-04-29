import { colors, radius } from "@/styles/tokens";

/**
 * Small primary-tinted pill that fronts each series header on the
 * events list, carrying the locale-resolved artist short name.
 *
 * Two padding variants — the events-list mockup spec'd a tighter pill
 * for the mobile `SeriesSection` header (`1px 7px`) and a slightly
 * roomier one for the desktop `SeriesBlock` header (`2px 9px`) so the
 * pill sits comfortably alongside the wider `[N events]` row that
 * accompanies it on desktop. The padding difference is the only
 * styling delta between the two surfaces; everything else stays
 * locked.
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
