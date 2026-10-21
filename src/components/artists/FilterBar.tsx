import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { ArtistsListFilter } from "@/lib/artists";
import styles from "./artistList.module.css";

/*
 * Six-chip category filter for the artists list page.
 *
 * Each chip maps 1:1 to a `GroupCategory` enum value after the v2
 * reshape that merged the former `anime` + `game` enum values into a
 * single `animegame` (the chip already conflated them in UI; the DB
 * distinction was vestigial). Plus `all` (no filter) and `others`
 * (catch-all for groups that don't fit any of the named music-scene
 * categories).
 *
 * Each chip is a plain navigation link (not a button) — clicking
 * triggers a normal Next.js navigation that re-runs the server
 * fetch with the new ?category=... param. No client-side state.
 *
 * Visual (24-v1): 44px-tall pills; active = solid primary with white
 * text, inactive = white with a slate outline.
 */

type FilterTranslationKey =
  | "filterAll"
  | "filterAnimeGame"
  | "filterKpop"
  | "filterJpop"
  | "filterCpop"
  | "filterOthers";

type FilterDef = { value: ArtistsListFilter; key: FilterTranslationKey };

const FILTERS: ReadonlyArray<FilterDef> = [
  { value: "all", key: "filterAll" },
  { value: "animegame", key: "filterAnimeGame" },
  { value: "kpop", key: "filterKpop" },
  { value: "jpop", key: "filterJpop" },
  { value: "cpop", key: "filterCpop" },
  { value: "others", key: "filterOthers" },
];

interface Props {
  active: ArtistsListFilter;
  /**
   * Categories that have at least one matching artist in the current
   * catalog. Chips outside this set are hidden so the user can't land
   * on a guaranteed-empty filter state. `all` is always rendered.
   * Resolved server-side by `getAvailableArtistFilters()`.
   */
  available: Set<ArtistsListFilter>;
}

export default async function FilterBar({ active, available }: Props) {
  const t = await getTranslations("Artist");
  const visibleFilters = FILTERS.filter(
    (f) => f.value === "all" || available.has(f.value),
  );

  // Don't render the bar at all when only the unconditional `all` chip
  // remains — a single chip is uninformative and just wastes vertical
  // space. The page still renders a header + the artist list below.
  if (visibleFilters.length <= 1) return null;

  return (
    <nav aria-label={t("filterAriaLabel")} className={styles.filters}>
      {visibleFilters.map(({ value, key }) => {
        const isActive = active === value;
        const href =
          value === "all"
            ? { pathname: "/artists" as const }
            : { pathname: "/artists" as const, query: { category: value } };

        return (
          <Link
            key={value}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={styles.filter}
          >
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
