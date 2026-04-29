import { BRAND_GRADIENT, getArtistColor } from "@/lib/artistColor";
import { radius } from "@/styles/tokens";

/*
 * Square avatar for Artist + Group surfaces. Distinct from a future
 * round member/VA avatar (different component path). Single source of
 * truth for the artist-color fallback chain (per
 * `raw/artist-color-handoff.md`):
 *
 *   solid `artist.color` → otherwise `BRAND_GRADIENT`
 *
 * Multi-color split (subunit colors combined) was retired by the
 * handoff and is not represented here. Sub-unit chips render in plain
 * neutral gray elsewhere.
 *
 * `size` defaults to 48 (mobile card); pass 40 for the desktop table
 * row. The label glyph (first character of shortName ?? name)
 * scales to ~35% of the box, matching the mockup at both sizes.
 */
type Props = {
  artist: {
    color?: string | null;
    name?: string | null;
    shortName?: string | null;
  };
  size?: number;
};

export default function ArtistAvatar({ artist, size = 48 }: Props) {
  const color = getArtistColor(artist);
  const background = color ?? BRAND_GRADIENT;
  const label = (artist.shortName ?? artist.name ?? "?").charAt(0) || "?";
  // Round to whole pixels so the rendered font size is deterministic
  // (size * 0.35 is otherwise a float — 48 * 0.35 = 16.799999...).
  const fontSize = Math.round(size * 0.35);

  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: radius.avatar,
        flexShrink: 0,
        background,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize,
        fontWeight: 700,
        color: "white",
        lineHeight: 1,
        userSelect: "none",
      }}
    >
      {label}
    </div>
  );
}
