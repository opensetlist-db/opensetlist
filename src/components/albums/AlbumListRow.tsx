import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { displayOriginalTitle } from "@/lib/display";
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
  /** Pre-resolved primary-artist label (`displayOriginalName(...).main`). */
  artistName?: string;
  /** `countActiveBonuses(listings)`: bonuses of listings not `ended`. */
  activeBonusCount: number;
}

export async function AlbumListRow({
  album,
  locale,
  artistName,
  activeBonusCount,
}: Props) {
  const t = await getTranslations({ locale, namespace: "Album" });
  const title = displayOriginalTitle(album, album.translations, locale);
  const year = parseReleaseYear(album.releaseDate);

  return (
    <Link
      href={entityPath("albums", locale, album.id, album.slug)}
      className={styles.row}
    >
      <AlbumListCover src={album.imageUrl} />
      <div className={styles.body}>
        <div className={styles.meta}>
          <span className={styles.type} data-type={album.type}>
            {t(`type.${album.type}`)}
          </span>
          {artistName && <span className={styles.artist}>{artistName}</span>}
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
        <div className={styles.rowTitle}>{title.main}</div>
        <div className={styles.rowSub}>
          {title.sub}
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
    </Link>
  );
}
