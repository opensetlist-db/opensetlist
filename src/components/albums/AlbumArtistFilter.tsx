import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { colors, radius } from "@/styles/tokens";
import type { AlbumArtistFilterOption } from "@/lib/albums";

/*
 * Artist filter for the `/[locale]/albums` list page (Sprint B2 QA
 * pass). Mirrors the artists list FilterBar: each chip is a plain
 * navigation <Link> (not a button) carrying `?artist=<id>`, so the
 * server re-fetches the filtered list on click — no client state. "전체"
 * (no param) clears the filter. Only artists that have ≥1 album appear
 * (resolved by getAlbumArtistFilters).
 */

interface Props {
  /** Current `?artist=` id, or null for the "전체" (no-filter) state. */
  active: string | null;
  options: AlbumArtistFilterOption[];
}

export async function AlbumArtistFilter({ active, options }: Props) {
  const t = await getTranslations("Album");

  // Nothing to filter by (0 or 1 artist in the catalog) → omit the bar
  // entirely rather than show just the "전체" chip.
  if (options.length <= 1) return null;

  const chip = (
    key: string,
    href:
      | { pathname: "/albums" }
      | { pathname: "/albums"; query: { artist: string } },
    isActive: boolean,
    label: string,
  ) => (
    <Link
      key={key}
      href={href}
      aria-current={isActive ? "page" : undefined}
      style={{
        padding: "6px 14px",
        borderRadius: radius.button,
        fontSize: 13,
        fontWeight: 600,
        border: `1.5px solid ${isActive ? colors.primary : colors.border}`,
        background: isActive ? colors.primaryBg : colors.bgCard,
        color: isActive ? colors.primary : colors.textSecondary,
        textDecoration: "none",
        lineHeight: 1.4,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </Link>
  );

  return (
    <nav
      aria-label={t("artistFilterAria")}
      style={{
        display: "flex",
        gap: 8,
        padding: "0 16px 16px",
        flexWrap: "wrap",
      }}
    >
      {chip("all", { pathname: "/albums" }, active === null, t("filterAll"))}
      {options.map((o) =>
        chip(
          o.id,
          { pathname: "/albums", query: { artist: o.id } },
          active === o.id,
          o.name,
        ),
      )}
    </nav>
  );
}
