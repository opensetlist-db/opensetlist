import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { Prisma } from "@/generated/prisma/client";
import { displayOriginalTitle, resolveDisplayPair } from "@/lib/display";
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
 * Every credited artist links to its page and shows the original name
 * above the locale-specific name.
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

/** Shares title spelling between the detail heading and the cover description. */
export async function AlbumIdentity({
  album,
  locale,
}: {
  album: AlbumForIdentity;
  locale: string;
}) {
  const t = await getTranslations({ locale, namespace: "Album" });
  const title = displayOriginalTitle(album, album.translations, locale, "paired");
  const longTitle = Math.max(title.main.length, title.sub?.length ?? 0) > LONG_TITLE_CHARS;

  return (
    <section
      className={`${styles.identity} ${longTitle ? styles.longTitle : ""}`}
      aria-labelledby="album-title"
    >
      <AlbumCover
        src={album.imageUrl}
        alt={t("coverAlt", { title: title.sub ? `${title.main} / ${title.sub}` : title.main })}
      />
      <div className={styles.title}>
        <span className={styles.badge}>{t(`type.${album.type}`)}</span>
        <h1 id="album-title" className={styles.h1} lang={album.originalLanguage}>
          {title.main}
        </h1>
        {title.sub ? <p className={styles.subtitle} lang={locale}>{title.sub}</p> : null}
      </div>
      <dl className={styles.meta}>
        {album.artists.length > 0 ? (
          <div className={styles.metaRow}>
            <dt className={styles.metaLabel}>{t("meta.label.artist")}</dt>
            <dd className={`${styles.metaValue} ${styles.artistLinks}`}>
              {album.artists.map(({ artist }) => {
                const name = resolveDisplayPair(
                  { original: artist.originalName, originalLanguage: artist.originalLanguage },
                  artist.translations,
                  locale, "name",
                );
                return (
                  <Link
                    key={artist.id}
                    href={entityPath("artists", locale, artist.id, artist.slug)}
                    className={styles.artistLink}
                  >
                    <span lang={artist.originalLanguage}>{name.main}</span>
                    {name.sub ? <small lang={locale}>{name.sub}</small> : null}
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
