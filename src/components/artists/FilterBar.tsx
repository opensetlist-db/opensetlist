import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { colors, radius } from "@/styles/tokens";
import type { ArtistsListFilter } from "@/lib/artists";

/*
 * Four-chip category filter for the artists list page.
 *
 * Anime + Game are intentionally merged into a single chip per
 * operator decision (2026-04-27): the catalog hasn't grown big enough
 * to justify two separate chips, and most users think of them
 * together. The DB enum keeps `anime` and `game` distinct because the
 * detail/admin layer still cares about the difference; the merged
 * filter just maps to `category IN ('anime','game')` in the query
 * (see FILTER_TO_CATEGORIES in lib/artists.ts).
 *
 * Each chip is a plain navigation link (not a button) — clicking
 * triggers a normal Next.js navigation that re-runs the server
 * fetch with the new ?category=... param. No client-side state.
 *
 * Active visual: blue border + light blue bg + blue text per
 * mockup §1; inactive: gray border + white bg + dark gray text.
 */

type FilterDef = { value: ArtistsListFilter; key: string };

const FILTERS: ReadonlyArray<FilterDef> = [
  { value: "all", key: "filterAll" },
  { value: "animegame", key: "filterAnimeGame" },
  { value: "kpop", key: "filterKpop" },
  { value: "jpop", key: "filterJpop" },
];

interface Props {
  active: ArtistsListFilter;
}

export default async function FilterBar({ active }: Props) {
  const t = await getTranslations("Artist");

  return (
    <nav
      aria-label={t("filterAriaLabel")}
      style={{
        display: "flex",
        gap: 8,
        padding: "12px 16px 16px",
        flexWrap: "wrap",
      }}
    >
      {FILTERS.map(({ value, key }) => {
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
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
