import { getTranslations } from "next-intl/server";
import {
  getArtistGroupsForList,
  isArtistsListFilter,
  type ArtistsListFilter,
} from "@/lib/artists";
import FilterBar from "@/components/artists/FilterBar";
import GroupSection from "@/components/artists/GroupSection";
import { colors } from "@/styles/tokens";

// Repeated query params arrive as `string[]` in App Router (e.g.
// `?category=kpop&category=jpop` → `category: ["kpop", "jpop"]`).
// Type for both shapes; pick the first value when an array, then run
// it through the type-guard. Defends against both intentional repeats
// and accidental URL manipulation by treating malformed input as "all".
// Reading-comfort cap for the multi-column desktop table per mockup.
// Mobile uses full width; the page only narrows when the desktop
// breakpoint kicks in (1024px) and the 5-col grid would otherwise
// stretch awkwardly wide on ultra-wide monitors.
const PAGE_MAX_WIDTH = 960;

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
  const groups = await getArtistGroupsForList(category, referenceNow);

  return (
    <main
      className="mx-auto"
      style={{
        maxWidth: PAGE_MAX_WIDTH,
        padding: "24px 0 48px",
      }}
    >
      <header style={{ padding: "0 16px 16px" }}>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 700,
            color: colors.textPrimary,
            margin: 0,
          }}
        >
          {t("title")}
        </h1>
      </header>

      <FilterBar active={category} />

      {groups.length === 0 ? (
        <p
          style={{
            textAlign: "center",
            padding: "48px 16px",
            fontSize: 14,
            color: colors.textMuted,
          }}
        >
          {t("empty")}
        </p>
      ) : (
        <div style={{ padding: "0 12px" }}>
          {groups.map((group) => (
            <GroupSection key={group.id} group={group} locale={locale} />
          ))}
        </div>
      )}
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
  return { title: t("title") };
}
