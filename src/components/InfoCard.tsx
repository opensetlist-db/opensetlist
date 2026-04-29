import { colors, radius, shadows } from "@/styles/tokens";
import { ColorStripe } from "@/components/ColorStripe";

/*
 * Sidebar wrapper for detail-page info cards. White background +
 * `radius.card` + `shadows.card` + `overflow: hidden` (so the
 * <ColorStripe> at the top edge clips to the rounded corners).
 *
 * Layout positioning is the consumer's responsibility — this wrapper
 * doesn't impose `position: sticky` because mobile + desktop want
 * different placement. The artist page sets the sticky/top-72 wrapper
 * div around <InfoCard /> so the same component fits both layouts
 * without prop branching.
 *
 * `artist` is forwarded to <ColorStripe>; pass `null` to use the
 * brand-gradient fallback (e.g. when the consumer doesn't have an
 * artist association — series page passes `series.artist`).
 */

interface Props {
  artist: { color?: string | null } | null;
  children: React.ReactNode;
}

export function InfoCard({ artist, children }: Props) {
  return (
    <section
      style={{
        background: colors.bgCard,
        borderRadius: radius.card,
        boxShadow: shadows.card,
        overflow: "hidden",
      }}
    >
      <ColorStripe artist={artist} />
      <div style={{ padding: "20px 20px 24px" }}>{children}</div>
    </section>
  );
}
