import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  getAlbumTrackTitle,
  type EnrichedAlbumTrack,
} from "@/lib/albumTrackTitle";
import { displayOriginalTitle } from "@/lib/display";
import { entityPath } from "@/lib/seo/entityUrl";
import styles from "./albumDetail.module.css";

/*
 * Tracks tab of the Album detail page (22-v1): one white panel with a
 * heading row, disc sub-headings only for multi-disc releases, and one
 * row per AlbumTrack.
 *
 * Row semantics are unchanged from the pre-redesign tab:
 *   Pattern 1 (vocal, `song` set) — the only row that links, to the
 *     Song page; original title leads, locale translation underneath
 *     (`displayOriginalTitle`, same rule as the song page H1).
 *   Pattern 2 (off-vocal with `parentSong`) / Pattern 3 (drama, BGM,
 *     direct title) — informational, no link: there is no Song page for
 *     an off-vocal or a drama track, and inventing one would 404 or point
 *     at the wrong song. `getAlbumTrackTitle` composes their one-line
 *     title (variant suffix, translation, "Track N" fallback).
 *
 * The fetch already orders tracks by [discNumber, trackNumber], so
 * bucketing per disc keeps the order without another sort.
 */
export async function AlbumTracksPanel({
  tracks,
  locale,
}: {
  tracks: EnrichedAlbumTrack[];
  locale: string;
}) {
  const t = await getTranslations({ locale, namespace: "Album" });
  // getAlbumTrackTitle composes full key paths ("AlbumTrack.…"), so it
  // needs the root translator.
  const tRoot = await getTranslations({ locale });

  if (tracks.length === 0) {
    return (
      <div className={`${styles.panel} ${styles.empty}`}>
        {t("tracks.empty")}
      </div>
    );
  }

  const discs = new Map<number, EnrichedAlbumTrack[]>();
  for (const track of tracks) {
    const bucket = discs.get(track.discNumber) ?? [];
    bucket.push(track);
    discs.set(track.discNumber, bucket);
  }
  const showDiscHeadings = discs.size > 1;

  return (
    <section className={styles.panel} aria-labelledby="album-tracks-heading">
      <div className={styles.panelHead}>
        <h2 id="album-tracks-heading">{t("tab.tracks")}</h2>
        <span>{tracks.length}</span>
      </div>
      {[...discs].map(([discNumber, discTracks]) => (
        <div key={discNumber}>
          {showDiscHeadings ? (
            <h3 className={styles.disc}>
              {t("tracks.discN", { disc: discNumber })}
            </h3>
          ) : null}
          <ol className={styles.trackList}>
            {discTracks.map((track) => {
              const title = track.song
                ? displayOriginalTitle(
                    track.song,
                    track.song.translations ?? [],
                    locale,
                  )
                : {
                    main: getAlbumTrackTitle(track, locale, tRoot),
                    sub: null,
                  };
              const body = (
                <>
                  <span className={styles.trackNumber}>
                    {t("tracks.trackPrefix", { track: track.trackNumber })}
                  </span>
                  <span className={styles.trackTitle}>
                    {title.main}
                    {title.sub ? <small>{title.sub}</small> : null}
                  </span>
                </>
              );
              return (
                <li key={track.id}>
                  {track.song ? (
                    <Link
                      href={entityPath(
                        "songs",
                        locale,
                        track.song.id,
                        track.song.slug,
                      )}
                      className={styles.trackRow}
                    >
                      {body}
                      <span className={styles.arrow} aria-hidden="true">
                        ›
                      </span>
                    </Link>
                  ) : (
                    <div
                      className={`${styles.trackRow} ${styles.trackRowPlain}`}
                    >
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </section>
  );
}
