import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { countActiveBonuses } from "@/lib/albumBonusDisplay";
import { albumCardInclude } from "@/lib/albumHighlights";
import { AlbumCard } from "@/components/AlbumCard";
import { SectionLabel } from "@/components/SectionLabel";
import { colors, radius, shadows } from "@/styles/tokens";

/*
 * Artist page album surfaces (b09; Sprint B2 QA-pass restructure).
 *
 * Self-contained async server component (its own scoped album query so
 * the carefully-narrowed `getArtist` mega-query stays untouched). Two
 * modes:
 *   - "preview": a compact single-column list of the latest few albums
 *     for the OVERVIEW tab, with a "전체 보기 ›" link to the albums tab.
 *   - "full": the whole discography (single column) for the ALBUMS tab.
 *
 * The QA pass replaced the original big square `hero` card + 2-col grid
 * with single-column `mini` rows (smaller images, less visual weight)
 * and moved the full discography out of the overview into its own tab.
 *
 * Albums link to the artist via the AlbumArtist N:N junction, so a
 * sub-unit (Cerise Bouquet, DOLLCHESTRA, …) surfaces exactly its own
 * credited albums. Returns null when the artist has no albums.
 */

// Full discography cap. A dedicated paged sub-page is Phase 3; 30
// comfortably covers every Phase 1/2 artist.
const DISCOGRAPHY_LIMIT = 30;
// Latest-album preview count for the overview tab.
const PREVIEW_LIMIT = 3;

const cardSectionStyle = {
  background: colors.bgCard,
  borderRadius: radius.card,
  padding: "18px 20px",
  boxShadow: shadows.card,
} as const;

export async function ArtistAlbumsSection({
  artistId,
  locale,
  mode,
}: {
  artistId: bigint;
  locale: string;
  mode: "preview" | "full";
}) {
  // Preview fetches one extra row so we can tell whether "전체 보기" is
  // worth showing (more albums exist than the preview shows) without a
  // separate count query.
  const take = mode === "preview" ? PREVIEW_LIMIT + 1 : DISCOGRAPHY_LIMIT;
  const albums = await prisma.album.findMany({
    where: { artists: { some: { artistId } } },
    // Newest first; NULL releaseDate sorts last so un-dated rows never
    // masquerade as the latest album.
    orderBy: [{ releaseDate: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    take,
    include: albumCardInclude(locale),
  });

  if (albums.length === 0) return null;

  // serializeBigInt narrows ids → Number; AlbumCard reads ids only via
  // template literals + keys (coercion-tolerant) and still sees
  // `listings` for the bonus count (no shape-erasing cast).
  const serialized = serializeBigInt(albums);
  const t = await getTranslations({ locale, namespace: "Artist" });

  const hasMore = mode === "preview" && serialized.length > PREVIEW_LIMIT;
  const visible =
    mode === "preview" ? serialized.slice(0, PREVIEW_LIMIT) : serialized;

  const rows = (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {visible.map((album) => (
        <AlbumCard
          key={`${album.id}`}
          variant="mini"
          album={album}
          locale={locale}
          activeBonusCount={countActiveBonuses(album.listings)}
        />
      ))}
    </div>
  );

  if (mode === "full") {
    return (
      <section style={cardSectionStyle}>
        <SectionLabel>{t("albums.discography")}</SectionLabel>
        {rows}
      </section>
    );
  }

  // preview
  return (
    <section style={cardSectionStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <SectionLabel noBorder style={{ marginBottom: 0 }}>
          {t("albums.latest")}
        </SectionLabel>
        {hasMore && (
          // Switches to the albums tab on this same artist page. Bare
          // numeric id (no slug) is a valid URL — the page renders it
          // directly without a redirect.
          <Link
            href={`/${locale}/artists/${artistId}?tab=albums`}
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: colors.primary,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            {t("viewAll")}
          </Link>
        )}
      </div>
      {rows}
    </section>
  );
}
