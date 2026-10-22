import Link from "next/link";
import type { LangText } from "./SeriesIdentity";
import styles from "./seriesDetail.module.css";

export interface SeriesSongRow {
  key: string;
  /** Locale-prefixed canonical song path (`entityPath`). */
  href: string;
  /** Original title (headline — song identity is the original). */
  title: LangText;
  variant: LangText | null;
  /** Viewer-language title, when it differs from the original. */
  translated: LangText | null;
  /** First primary artist's label. */
  artist: LangText | null;
  count: number;
  countUnit: string;
}

/*
 * Songs tab (32-v1): completed-event basis heading, one row per song
 * with its appearance count (SetlistItemSong occurrences, the existing
 * meaning), a whole-row link to the canonical song page, and the
 * "more songs as shows complete" footer. No visible songs → the honest
 * empty panel.
 */
export function SeriesSongsPanel({
  basisLabel,
  rows,
  footer,
  emptyLabel,
}: {
  basisLabel: string;
  rows: ReadonlyArray<SeriesSongRow>;
  footer: string;
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return (
      <section className={`${styles.panel} ${styles.empty}`}>
        {emptyLabel}
      </section>
    );
  }
  return (
    <section
      className={`${styles.panel} ${styles.songPanel}`}
      aria-labelledby="series-songs-basis"
    >
      <h2 id="series-songs-basis">{basisLabel}</h2>
      <ul className={styles.songList}>
        {rows.map((row) => (
          <li key={row.key}>
            <Link href={row.href} className={styles.songRow}>
              <span>
                <strong className={styles.songTitle} lang={row.title.lang}>
                  {row.title.text}
                  {row.variant ? (
                    <span className={styles.variant} lang={row.variant.lang}>
                      {row.variant.text}
                    </span>
                  ) : null}
                </strong>
                {row.translated ? (
                  <span className={styles.songSub} lang={row.translated.lang}>
                    {row.translated.text}
                  </span>
                ) : null}
                {row.artist ? (
                  <span className={styles.songUnit} lang={row.artist.lang}>
                    {row.artist.text}
                  </span>
                ) : null}
              </span>
              <span className={styles.songCount}>
                {row.count}
                <small>{row.countUnit}</small>
              </span>
              <span className={styles.arrow} aria-hidden="true">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className={styles.songFooter}>{footer}</p>
    </section>
  );
}
