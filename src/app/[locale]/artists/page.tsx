import { getTranslations } from "next-intl/server";
import { staticAlternates } from "@/lib/seo/entityUrl";
import {
  getArtistGroupsForList,
  getAvailableArtistFilters,
  isArtistsListFilter,
  type ArtistsListFilter,
} from "@/lib/artists";
import FilterBar from "@/components/artists/FilterBar";
import GroupSection from "@/components/artists/GroupSection";
import styles from "@/components/artists/artistList.module.css";

// Repeated query params arrive as `string[]` in App Router (e.g.
// `?category=kpop&category=jpop` → `category: ["kpop", "jpop"]`).
// Type for both shapes; pick the first value when an array, then run
// it through the type-guard. Defends against both intentional repeats
// and accidental URL manipulation by treating malformed input as "all".
type SearchParams = Promise<{ category?: string | string[] }>;

function resolveCategory(
  value: string | string[] | undefined,
): ArtistsListFilter {
  const candidate = Array.isArray(value) ? value[0] : value;
  return isArtistsListFilter(candidate) ? candidate : "all";
}

export default async function ArtistsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: SearchParams;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const category = resolveCategory(sp.category);

  const t = await getTranslations("Artist");
  // Single now() at the top of the request — every artist's
  // `hasOngoing` derivation downstream uses this same instant. Stored
  // as a UTC instant per CLAUDE.md "Date & Time" hard rule; the
  // `getEventStatus` helper compares absolute instants so there is no
  // local-TZ drift.
  const referenceNow = new Date();
  const [groups, availableFilters] = await Promise.all([
    getArtistGroupsForList(category, referenceNow),
    getAvailableArtistFilters(),
  ]);

  // Body is a flex column: `<main>` takes the remaining height
  // (`flex-1`) and `.page` pins `width: 100%` next to its max-width so
  // the column tracks the viewport, not its content. The page
  // background comes from the 06 shell's body colour.
  return (
    <main className="flex-1">
      <div className={styles.page}>
        <h1 className={styles.title}>{t("title")}</h1>

        <FilterBar active={category} available={availableFilters} />

        {groups.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptySymbol} aria-hidden="true">
              ♫
            </span>
            <p className={styles.emptyText}>{t("empty")}</p>
          </div>
        ) : (
          groups.map((group) => (
            <GroupSection key={group.id} group={group} locale={locale} />
          ))
        )}
      </div>
    </main>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Artist" });
  return { title: t("title"), alternates: staticAlternates(locale, "/artists") };
}
