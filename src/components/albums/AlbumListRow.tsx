import { TrackedAlbumLink } from "@/components/TrackedAlbumLink";
import { getTranslations } from "next-intl/server";
import { displayOriginalTitle, resolveDisplayPair } from "@/lib/display";
import { parseReleaseYear } from "@/lib/utils";
import { entityPath } from "@/lib/seo/entityUrl";
import type { AlbumsListItem } from "@/lib/albums";
import { AlbumListCover } from "./AlbumListCover";
import styles from "./albumList.module.css";

/*
 * One `/[locale]/albums` catalog row (26-v1): cover, then a meta line
 * (type pill · primary artist · active-bonus badge) above the original
 * title, the viewer-locale title under it, and the release year — at
 * the right edge from 768px, appended to the secondary line below.
 *
 * The whole row is a single canonical album link (`entityPath`); the
 * artist name is plain text, never a nested link. Titles and artist
 * names wrap in full instead of truncating.
 *
 * Both year spans are always in the DOM and CSS shows one per band, so
 * the server output does not depend on the viewport.
 */

interface Props {
  album: AlbumsListItem;
  locale: string;
  /** `countActiveBonuses(listings)`: bonuses of listings not `ended`. */
  activeBonusCount: number;
}

/** Uses one canonical link for the album title, credit and purchase indicator. */
export async function AlbumListRow({
  album,
  locale,
  activeBonusCount,
}: Props) {
  const t = await getTranslations({ locale, namespace: "Album" });
  const title = displayOriginalTitle(album, album.translations, locale, "paired");
  const artist = album.artists[0]?.artist;
  const artistName = artist && resolveDisplayPair(
    { original: artist.originalName, originalLanguage: artist.originalLanguage },
    artist.translations, locale, "name",
  );
  const year = parseReleaseYear(album.releaseDate);

  return (
    <TrackedAlbumLink
      href={entityPath("albums", locale, album.id, album.slug)}
      albumId={String(album.id)}
      albumSlug={album.slug}
      surface="album_list"
      className={styles.row}
    >
      <AlbumListCover src={album.imageUrl} />
      <div className={styles.body}>
        <div className={styles.meta}>
          <span className={styles.type} data-type={album.type}>
            {t(`type.${album.type}`)}
          </span>
          {artist && artistName && (
            <span className={styles.artist}>
              <span lang={artist.originalLanguage}>{artistName.main}</span>
              {artistName.sub && <small lang={locale}>{artistName.sub}</small>}
            </span>
          )}
          {activeBonusCount > 0 && (
            // Compact visible text ("특전 N"); the role + label carry the
            // longer "매장특전 N건" wording for screen readers.
            <span
              className={styles.bonus}
              role="img"
              aria-label={t("albumActiveBonuses", { count: activeBonusCount })}
            >
              {t("albumActiveBonusesBadge", { count: activeBonusCount })}
            </span>
          )}
        </div>
        <div className={styles.rowTitle} lang={album.originalLanguage}>{title.main}</div>
        <div className={styles.rowSub}>
          {title.sub && <span lang={locale}>{title.sub}</span>}
          {year !== null && (
            <span className={styles.mobileYear}>
              {title.sub ? " · " : ""}
              {year}
            </span>
          )}
        </div>
      </div>
      {year !== null && <span className={styles.year}>{year}</span>}
      <span className={styles.arrow} aria-hidden="true">
        ›
      </span>
    </TrackedAlbumLink>
  );
}
