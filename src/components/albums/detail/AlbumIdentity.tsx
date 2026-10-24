import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { Prisma } from "@/generated/prisma/client";
import { displayOriginalTitle, displayOriginalName } from "@/lib/display";
import { entityPath } from "@/lib/seo/entityUrl";
import { formatDate, type BigIntStringified } from "@/lib/utils";
import { ALBUM_DATE_FORMAT } from "./albumDate";
import { AlbumCover } from "./AlbumCover";
import styles from "./albumDetail.module.css";

/*
 * Identity card for the Album detail page (approved 22-v1). Replaces the
 * old sticky sidebar InfoCard with a full-width card: cover square, type
 * badge, original-language H1 with the locale translation as subtitle,
 * every credited artist, and the release date.
 *
 * Title rule (artwork): original title leads, the locale translation is
 * the subtitle only when it exists and differs (`displayOriginalTitle`).
 * Artist rule (identity): locale name leads, the original name is the
 * small second line (`displayOriginalName`). Every AlbumArtist row is a
 * link — the old card showed only the first as a link plus chips; 22-v1
 * lists them all in one row.
 *
 * The store-bonus stat chips that sat in the sidebar moved to the
 * purchase tab's summary box (22-v1 contract), where the counts sit next
 * to the stores they count.
 */

// Wire shape after the page's `serializeBigIntAsString` (ids and dates
// are strings).
export type AlbumForIdentity = BigIntStringified<
  Prisma.AlbumGetPayload<{
    include: {
      translations: true;
      artists: {
        include: { artist: { include: { translations: true } } };
      };
    };
  }>
>;

// 22-v1 moves titles longer than this out of the narrow mobile column
// beside the cover (see `.longTitle` in the CSS module).
const LONG_TITLE_CHARS = 70;

export async function AlbumIdentity({
  album,
  locale,
}: {
  album: AlbumForIdentity;
  locale: string;
}) {
  const t = await getTranslations({ locale, namespace: "Album" });
  const title = displayOriginalTitle(album, album.translations, locale);
  const longTitle = title.main.length > LONG_TITLE_CHARS;

  return (
    <section
      className={`${styles.identity} ${longTitle ? styles.longTitle : ""}`}
      aria-labelledby="album-title"
    >
      <AlbumCover src={album.imageUrl} alt={title.main} />
      <div className={styles.title}>
        <span className={styles.badge}>{t(`type.${album.type}`)}</span>
        <h1 id="album-title" className={styles.h1}>
          {title.main}
        </h1>
        {title.sub ? <p className={styles.subtitle}>{title.sub}</p> : null}
      </div>
      <dl className={styles.meta}>
        {album.artists.length > 0 ? (
          <div className={styles.metaRow}>
            <dt className={styles.metaLabel}>{t("meta.label.artist")}</dt>
            <dd className={`${styles.metaValue} ${styles.artistLinks}`}>
              {album.artists.map(({ artist }) => {
                const name = displayOriginalName(
                  artist,
                  artist.translations,
                  locale,
                );
                return (
                  <Link
                    key={artist.id}
                    href={entityPath("artists", locale, artist.id, artist.slug)}
                    className={styles.artistLink}
                  >
                    <span>{name.main}</span>
                    {name.sub ? <small>{name.sub}</small> : null}
                  </Link>
                );
              })}
            </dd>
          </div>
        ) : null}
        {album.releaseDate ? (
          <div className={styles.metaRow}>
            <dt className={styles.metaLabel}>
              {t("meta.label.releaseDate")}
            </dt>
            <dd className={styles.metaValue}>
              <time dateTime={album.releaseDate.slice(0, 10)}>
                {formatDate(album.releaseDate, locale, ALBUM_DATE_FORMAT)}
              </time>
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
