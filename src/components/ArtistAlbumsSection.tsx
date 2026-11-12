import Link from "next/link";
import { TrackedAlbumLink } from "@/components/TrackedAlbumLink";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt, parseReleaseYear } from "@/lib/utils";
import { CACHE_TTL, cachedQuery } from "@/lib/dataCache";
import { countActiveBonuses } from "@/lib/albumBonusDisplay";
import { albumCardInclude } from "@/lib/albumHighlights";
import { displayOriginalTitle } from "@/lib/display";
import { entityPath } from "@/lib/seo/entityUrl";
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

// Full discography page size. The tab label shows the uncapped total,
// so anything past the first page is reached through `?page=` links
// (Aqours has 55: a hard cap left 25 of them unreachable).
const DISCOGRAPHY_LIMIT = 30;
// Latest-album preview count for the overview tab.
const PREVIEW_LIMIT = 3;

// The overview tab (the default) renders the preview, so this runs on
// every artist page view — cached like the rest of the artist page.
const getArtistAlbums = cachedQuery(
  "artist-albums",
  async (artistId: bigint, locale: string, take: number, skip: number) => {
    const albums = await prisma.album.findMany({
      where: { artists: { some: { artistId } } },
      // Newest first; NULL releaseDate sorts last so un-dated rows never
      // masquerade as the latest album.
      orderBy: [
        { releaseDate: { sort: "desc", nulls: "last" } },
        { id: "desc" },
      ],
      take,
      skip,
      include: albumCardInclude(locale),
    });
    return serializeBigInt(albums);
  },
  { revalidate: CACHE_TTL.entity },
);

type AlbumRow = Awaited<ReturnType<typeof getArtistAlbums>>[number];

/** Shares title display between the artist overview and the full discography. */
export async function ArtistAlbumsSection({
  artistId,
  artistSlug,
  locale,
  mode,
  page = 1,
  total = 0,
}: {
  artistId: bigint;
  artistSlug: string;
  locale: string;
  mode: "preview" | "full";
  /** Full mode: 1-based page, clamped to the last page of `total`. */
  page?: number;
  /** Full mode: the uncapped album count (the tab label's number). */
  total?: number;
}) {
  const lastPage = Math.max(1, Math.ceil(total / DISCOGRAPHY_LIMIT));
  // Floored: `?page=1.1` would otherwise reach Prisma as a fractional
  // skip (a 500) and mint a new cache key per fraction.
  const current = Math.min(Math.max(1, Math.floor(page) || 1), lastPage);
  // Preview fetches one extra row so we can tell whether "view all" is
  // worth showing (more albums exist than the preview shows) without a
  // separate count query.
  const take = mode === "preview" ? PREVIEW_LIMIT + 1 : DISCOGRAPHY_LIMIT;
  const skip = mode === "preview" ? 0 : (current - 1) * DISCOGRAPHY_LIMIT;
  const serialized = await getArtistAlbums(artistId, locale, take, skip);

  if (mode === "preview" && serialized.length === 0) return null;

  const [t, albumT] = await Promise.all([
    getTranslations({ locale, namespace: "Artist" }),
    getTranslations({ locale, namespace: "Album" }),
  ]);

  const hasMore = mode === "preview" && serialized.length > PREVIEW_LIMIT;
  const visible =
    mode === "preview" ? serialized.slice(0, PREVIEW_LIMIT) : serialized;

  const renderRow = (album: AlbumRow) => {
    const title = displayOriginalTitle(album, album.translations, locale, "paired");
    const year = parseReleaseYear(album.releaseDate);
    const bonusCount = countActiveBonuses(album.listings, album._count.bdEvents > 0);
    return (
      <li key={`${album.id}`}>
        <TrackedAlbumLink
          href={entityPath("albums", locale, album.id, album.slug)}
          albumId={String(album.id)}
          albumSlug={album.slug}
          surface="artist_albums"
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
              <span className={styles.translation} lang={locale}>{title.sub}</span>
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
        </TrackedAlbumLink>
      </li>
    );
  };

  if (mode === "full") {
    const pageHref = (n: number) =>
      `${entityPath("artists", locale, artistId, artistSlug)}?tab=albums${n > 1 ? `&page=${n}` : ""}`;
    const from = skip + 1;
    const to = skip + visible.length;
    return (
      <div className={styles.discography}>
        <section className={styles.panel}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>{t("albums.discography")}</h2>
            {lastPage > 1 && visible.length > 0 && (
              <span className={styles.range}>{t("albums.range", { from, to, total })}</span>
            )}
          </div>
          {visible.length === 0 ? (
            <p className={styles.empty}>{albumT("noAlbums")}</p>
          ) : (
            <ul className={styles.list}>{visible.map(renderRow)}</ul>
          )}
          {lastPage > 1 && (
            <nav aria-label={t("albums.pagination")} className={styles.pager}>
              {current > 1 ? (
                <Link href={pageHref(current - 1)} className={styles.more}>
                  <span aria-hidden="true">‹&nbsp;</span>
                  {t("albums.prev")}
                </Link>
              ) : (
                <span />
              )}
              {current < lastPage && (
                <Link href={pageHref(current + 1)} className={styles.more}>
                  {t("albums.next")}
                  <span aria-hidden="true">&nbsp;›</span>
                </Link>
              )}
            </nav>
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
            href={`${entityPath("artists", locale, artistId, artistSlug)}?tab=albums`}
            scroll={false}
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
