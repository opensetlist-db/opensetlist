import { BRAND_GRADIENT, getArtistColor } from "@/lib/artistColor";

/*
 * 5px tall horizontal stripe at the top of detail-page info cards.
 *
 * Per `raw/artist-color-handoff.md` (which retired the original
 * 4-color literal stripe in shared-components handoff §9): the rule
 * is single solid color when `artist.color` is set, otherwise the
 * brand gradient. Same fallback contract as <ArtistAvatar> so an
 * artist's surfaces (avatar + stripe + future hero) all read as one.
 *
 * Accepts `artist | null` so series and song detail pages can pass
 * the parent artist without a non-null check at every call site —
 * a null artist falls through to BRAND_GRADIENT.
 */

interface Props {
  artist: { color?: string | null } | null;
}

export function ColorStripe({ artist }: Props) {
  const color = artist ? getArtistColor(artist) : null;
  const background = color ?? BRAND_GRADIENT;
  return (
    <div
      aria-hidden="true"
      style={{
        height: 5,
        background,
        // Stripe sits flush with the rounded info-card corners; the
        // card's `overflow: hidden` clips the stripe edges so a solid
        // color matches the card radius without manually mirroring it.
      }}
    />
  );
}
