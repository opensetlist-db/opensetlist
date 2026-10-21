import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt, parseReleaseYear } from "@/lib/utils";
import { CACHE_TTL, cachedQuery } from "@/lib/dataCache";
import { countActiveBonuses } from "@/lib/albumBonusDisplay";
import { albumCardInclude } from "@/lib/albumHighlights";
import { displayOriginalTitle } from "@/lib/display";
import { CoverImage } from "@/components/shared/CoverImage";
import { originalLang } from "@/components/artists/artistDetail";
import styles from "@/components/artists/artistDetail.module.css";

/*
 * Artist page album surfaces (b09; redesign packet 20-v1 layout).
 *
 * Self-contained async server component (its own scoped album query so
 * the carefully-narrowed `getArtist` mega-query stays untouched). Two
 * modes:
 *   - "preview": the latest few albums in the overview's side column,
 *     with a "view all" link to the albums tab.
 *   - "full": the whole discography (single column) for the ALBUMS tab.
 *
 * Albums link to the artist via the AlbumArtist N:N junction, so a
 * sub-unit (Cerise Bouquet, DOLLCHESTRA, …) surfaces exactly its own
 * credited albums. Preview returns null when the artist has no albums;
 * full mode shows an empty message instead (a direct `?tab=albums` link
 * to an artist without albums — the tab itself is hidden then).
 */

// Full discography cap. A dedicated paged sub-page is Phase 3; 30
// comfortably covers every Phase 1/2 artist. The tab label still shows
// the uncapped total (31 for 蓮ノ空 at the time of 20-v1), which the
// approved design kept as is.
const DISCOGRAPHY_LIMIT = 30;
// Latest-album preview count for the overview tab.
const PREVIEW_LIMIT = 3;

// The overview tab (the default) renders the preview, so this runs on
// every artist page view — cached like the rest of the artist page.
const getArtistAlbums = cachedQuery(
  "artist-albums",
  async (artistId: bigint, locale: string, take: number) => {
    const albums = await prisma.album.findMany({
      where: { artists: { some: { artistId } } },
      // Newest first; NULL releaseDate sorts last so un-dated rows never
      // masquerade as the latest album.
      orderBy: [
        { releaseDate: { sort: "desc", nulls: "last" } },
        { id: "desc" },
      ],
      take,
      include: albumCardInclude(locale),
    });
    return serializeBigInt(albums);
  },
  { revalidate: CACHE_TTL.entity },
);

type AlbumRow = Awaited<ReturnType<typeof getArtistAlbums>>[number];

export async function ArtistAlbumsSection({
  artistId,
  artistSlug,
  locale,
  mode,
}: {
  artistId: bigint;
  artistSlug: string;
  locale: string;
  mode: "preview" | "full";
}) {
  // Preview fetches one extra row so we can tell whether "view all" is
  // worth showing (more albums exist than the preview shows) without a
  // separate count query.
  const take = mode === "preview" ? PREVIEW_LIMIT + 1 : DISCOGRAPHY_LIMIT;
  const serialized = await getArtistAlbums(artistId, locale, take);

  if (mode === "preview" && serialized.length === 0) return null;

  const [t, albumT] = await Promise.all([
    getTranslations({ locale, namespace: "Artist" }),
    getTranslations({ locale, namespace: "Album" }),
  ]);

  const hasMore = mode === "preview" && serialized.length > PREVIEW_LIMIT;
  const visible =
    mode === "preview" ? serialized.slice(0, PREVIEW_LIMIT) : serialized;

  const renderRow = (album: AlbumRow) => {
    const title = displayOriginalTitle(album, album.translations, locale);
    const year = parseReleaseYear(album.releaseDate);
    const bonusCount = countActiveBonuses(album.listings);
    return (
      <li key={`${album.id}`}>
        <Link
          href={`/${locale}/albums/${album.id}/${album.slug}`}
          className={styles.albumRow}
        >
          {/* Decorative: the title next to it names the album, so the
              cover (or its "no image" fallback) stays out of the
              accessible name (20 review: duplicated naming). */}
          <CoverImage
            src={album.imageUrl}
            size={mode === "full" ? 72 : 64}
            radius={10}
            className={mode === "full" ? "max-[699px]:!h-16 max-[699px]:!w-16" : ""}
          />
          <span className={styles.albumCopy}>
            <span className={styles.badge}>
              {albumT(`type.${album.type}`)}
            </span>
            <strong
              className={styles.albumTitle}
              lang={originalLang(album.originalLanguage, locale)}
            >
              {title.main}
            </strong>
            {title.sub && (
              <span className={styles.translation}>{title.sub}</span>
            )}
            {(year !== null || bonusCount > 0) && (
              <span className={styles.albumMeta}>
                {year !== null && <span>{year}</span>}
                {bonusCount > 0 && (
                  <span className={styles.bonus}>
                    {albumT("stats.bonusCount", { count: bonusCount })}
                  </span>
                )}
              </span>
            )}
          </span>
          <span className={styles.arrow} aria-hidden="true">
            ›
          </span>
        </Link>
      </li>
    );
  };

  if (mode === "full") {
    return (
      <div className={styles.discography}>
        <section className={styles.panel}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>{t("albums.discography")}</h2>
          </div>
          {visible.length === 0 ? (
            <p className={styles.empty}>{t("albums.empty")}</p>
          ) : (
            <ul className={styles.list}>{visible.map(renderRow)}</ul>
          )}
        </section>
      </div>
    );
  }

  return (
    <section className={styles.panel}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{t("albums.latest")}</h2>
        {hasMore && (
          // Visible text is the short shared "view all"; the accessible
          // name says which list it opens, so it isn't confused with
          // the concerts panel's identical link (20 review).
          <Link
            href={`/${locale}/artists/${artistId}/${artistSlug}?tab=albums`}
            className={styles.more}
            aria-label={t("viewAllAlbums")}
          >
            {t("viewAll")}
          </Link>
        )}
      </div>
      <ul className={styles.list}>{visible.map(renderRow)}</ul>
    </section>
  );
}
