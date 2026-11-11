import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { AlbumArtistFilterOption } from "@/lib/albums";
import styles from "./albumList.module.css";

/*
 * Artist filter for the `/[locale]/albums` list page. Mirrors the
 * artists list FilterBar: each pill is a plain navigation <Link> (not a
 * button) carrying `?artist=<id>`, so the server re-fetches the filtered
 * list on click — no client state. "전체" (no param) clears the filter.
 * Only top-level artists whose family has ≥1 album appear (resolved by
 * getAlbumArtistFilters).
 *
 * Visual (26-v1): 44px-tall pills that wrap within the page and show the
 * full original and localized names, wrapping inside the pill.
 */

interface Props {
  /** Current `?artist=` id, or null for the "전체" (no-filter) state. */
  active: string | null;
  options: AlbumArtistFilterOption[];
  locale: string;
}

/** Pairs artist names and starts at page one when the active artist changes. */
export async function AlbumArtistFilter({ active, options, locale }: Props) {
  const t = await getTranslations("Album");

  // Nothing to filter by (0 or 1 artist in the catalog) → omit the bar
  // entirely rather than show just the "전체" pill.
  if (options.length <= 1) return null;

  const pill = (
    key: string,
    href:
      | { pathname: "/albums" }
      | { pathname: "/albums"; query: { artist: string } },
    isActive: boolean,
    label: ReactNode,
  ) => (
    <Link
      key={key}
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={styles.filter}
    >
      {label}
    </Link>
  );

  return (
    <nav aria-label={t("artistFilterAria")} className={styles.filters}>
      {pill("all", { pathname: "/albums" }, active === null, t("filterAll"))}
      {options.map((o) =>
        pill(
          o.id,
          { pathname: "/albums", query: { artist: o.id } },
          active === o.id,
          <span>
            <span lang={o.originalLanguage}>{o.main}</span>
            {o.sub && <small lang={locale}>{o.sub}</small>}
          </span>,
        ),
      )}
    </nav>
  );
}
