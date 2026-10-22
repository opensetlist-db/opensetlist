import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/prisma";
import { formatDate, serializeBigInt } from "@/lib/utils";
import { CACHE_TTL, cachedQuery } from "@/lib/dataCache";
import { AlbumType } from "@/generated/prisma/enums";
import { countActiveBonuses } from "@/lib/albumBonusDisplay";
import { albumCardInclude, collectBdAlbumIds } from "@/lib/albumHighlights";
import { CoverImage } from "@/components/shared/CoverImage";
import { SERIES_DATE_FORMAT } from "./seriesDate";
import styles from "./seriesDetail.module.css";

/*
 * "투어 BD 목록" on the series schedule tab (b09 catalog, 32-v1 layout).
 *
 * The live-BD albums of a tour hang off the individual Event rows
 * (`Event.bdAlbumId`, b07's event-page relation), not the series. So the
 * read fans out: series → its events (+ direct child-series events) →
 * their bdAlbumId set → the live_album rows.
 *
 * Series set is `self + direct childSeries` — the one-level nesting the
 * page models (a tour with per-leg child series), not a recursive
 * descent. Type pins to `live_album`: only BD releases belong in a
 * "tour BDs" list even if an event points its bdAlbumId elsewhere by
 * operator error. Order: release date ascending (nulls last), then id —
 * a tour history reads 1st live → latest.
 *
 * Each card: the 06 `CoverImage` (real cover, or its no-image fallback
 * in the same square; 72px, 60px on phones), original title with the
 * viewer-language title below it when different, type · release date,
 * the active-bonus count (listings whose status is not ended — the
 * existing `countActiveBonuses` meaning), and a link to the canonical
 * album page. Renders nothing when the tour has no BD.
 */
const getSeriesBdAlbums = cachedQuery(
  "series-bd-albums",
  async (seriesId: bigint, locale: string) => {
    const childSeries = await prisma.eventSeries.findMany({
      where: { parentSeriesId: seriesId, isDeleted: false },
      select: { id: true },
    });
    const seriesIds = [seriesId, ...childSeries.map((c) => c.id)];

    const events = await prisma.event.findMany({
      where: {
        eventSeriesId: { in: seriesIds },
        isDeleted: false,
        bdAlbumId: { not: null },
      },
      select: { bdAlbumId: true },
    });

    const bdAlbumIds = collectBdAlbumIds(events);
    if (bdAlbumIds.length === 0) return [];

    const albums = await prisma.album.findMany({
      where: { id: { in: bdAlbumIds }, type: AlbumType.live_album },
      orderBy: [{ releaseDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      include: albumCardInclude(locale),
    });
    return serializeBigInt(albums);
  },
  { revalidate: CACHE_TTL.entity },
);

export async function SeriesBdSection({
  seriesId,
  locale,
}: {
  seriesId: bigint;
  locale: string;
}) {
  const albums = await getSeriesBdAlbums(seriesId, locale);
  if (albums.length === 0) return null;

  const t = await getTranslations({ locale, namespace: "EventSeries" });
  const albumT = await getTranslations({ locale, namespace: "Album" });

  return (
    <section
      className={`${styles.panel} ${styles.bdSection}`}
      aria-labelledby="series-bd-title"
    >
      <h2 id="series-bd-title">{t("tourBds")}</h2>
      <ul className={styles.bdList}>
        {albums.map((album) => {
          // Strict viewer-locale title: the include also carries the
          // fallback locale's row, which must not read as a translation.
          const translated = album.translations.find(
            (tr) => tr.locale === locale,
          )?.title;
          const release = album.releaseDate
            ? formatDate(album.releaseDate, locale, SERIES_DATE_FORMAT)
            : "";
          const bonusCount = countActiveBonuses(album.listings);
          return (
            <li key={String(album.id)}>
              <Link
                href={`/albums/${album.id}/${album.slug}`}
                className={styles.bdCard}
              >
                <CoverImage
                  src={album.imageUrl}
                  size={72}
                  radius={10}
                  className={styles.bdArt}
                  fallbackLabel={{ size: 10 }}
                />
                <span className={styles.bdCopy}>
                  <strong
                    className={styles.bdTitle}
                    lang={album.originalLanguage}
                  >
                    {album.originalTitle}
                  </strong>
                  {translated && translated !== album.originalTitle ? (
                    <small lang={locale}>{translated}</small>
                  ) : null}
                  <small>
                    {albumT(`type.${album.type}`)}
                    {release ? ` · ${release}` : ""}
                  </small>
                  {bonusCount > 0 ? (
                    <span className={styles.bonusLabel}>
                      {albumT("stats.bonusCount", { count: bonusCount })}
                    </span>
                  ) : null}
                </span>
                <span className={styles.arrow} aria-hidden="true">
                  ›
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
