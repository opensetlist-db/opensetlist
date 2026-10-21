import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { displayOriginalTitle } from "@/lib/display";
import { entityPath } from "@/lib/seo/entityUrl";
import type { SongAlbumRow } from "@/lib/songAlbums";
import { SongAlbumCover } from "./SongAlbumCover";
import { utcYear } from "./songDate";
import { albumTypeLabel, type AlbumTypeLabels } from "./albumTypeLabels";
import styles from "./songDetail.module.css";

/*
 * "수록 앨범" panel of the Song detail page (28-v1): right column on
 * desktop, above the tabs below 1000px (grid placement lives in the CSS
 * module; the DOM order stays identity → albums → tabs).
 *
 * Data rules are the pre-redesign sidebar section's, unchanged — rows
 * come from `getSongAlbums` (vocal tracks only, releaseDate ASC with
 * nulls last, album id, disc, track; one row per album; the oldest is
 * the original recording; active-bonus count from non-ended listings).
 * Every album is listed — the panel grows instead of hiding rows.
 */
export async function SongAlbumPanel({
  rows,
  locale,
  albumTypeLabels,
}: {
  rows: SongAlbumRow[];
  locale: string;
  albumTypeLabels: AlbumTypeLabels;
}) {
  if (rows.length === 0) return null;
  const t = await getTranslations({ locale, namespace: "Song" });
  const albumT = await getTranslations({ locale, namespace: "Album" });

  return (
    <aside className={styles.albumPanel} aria-labelledby="song-albums-heading">
      <h2 id="song-albums-heading">{t("albumsSectionLabel")}</h2>
      {rows.map((row) => {
        const title = displayOriginalTitle(
          row.album,
          row.album.translations,
          locale,
        );
        const year = utcYear(row.album.releaseDate);
        const typeLabel = albumTypeLabel(albumTypeLabels, row.album.type);
        return (
          <Link
            key={String(row.album.id)}
            href={entityPath("albums", locale, row.album.id, row.album.slug)}
            className={styles.albumMini}
          >
            <SongAlbumCover src={row.album.imageUrl} alt={title.main} />
            <div className={styles.albumCopy}>
              {row.isCanonical ? (
                <span className={styles.chip}>
                  {t("albumOriginalRecording")}
                </span>
              ) : null}
              <h3>{title.main}</h3>
              {title.sub ? <p>{title.sub}</p> : null}
              <p>
                {typeLabel}
                {year !== null ? ` · ${year}` : ""}
              </p>
              <p>
                {t("discN", { disc: row.discNumber })} ·{" "}
                {t("trackN", { track: row.trackNumber })}
              </p>
              {row.activeBonusCount > 0 ? (
                <span className={styles.chip}>
                  {albumT("stats.bonusSectionLabel")} {row.activeBonusCount}
                </span>
              ) : null}
            </div>
            <span className={styles.albumArrow} aria-hidden="true">
              ›
            </span>
          </Link>
        );
      })}
      {rows.length > 1 ? (
        <p className={styles.albumTotal}>
          {t("albumsTotalCount", { count: rows.length })}
        </p>
      ) : null}
    </aside>
  );
}
