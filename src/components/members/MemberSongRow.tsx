import Link from "next/link";
import styles from "./memberDetail.module.css";

/*
 * One song on the member page — the overview's top-3 panel and the full
 * songs tab share this row (approved packet 30-v1). Titles wrap instead
 * of truncating; the unit tag is neutral lavender with ink text so an
 * unverified unit colour never carries copy.
 */

export interface MemberSongView {
  id: number;
  href: string;
  /** Original-language title (primary per the 30-v1 name rule). */
  title: string;
  titleLang?: string;
  /** Variant label ("105期 Ver."), shown after the title; null for a
   *  base version. */
  variant: string | null;
  /** Set only when the label is a viewer-locale translation (the title
   *  span's original-language `lang` would be wrong for it). */
  variantLang?: string;
  /** Viewer-locale translation, null when it equals the original. */
  titleSub: string | null;
  unitName: string | null;
  unitLang?: string;
  timesPerformed: number;
}

export function MemberSongRow({
  song,
  countUnit,
}: {
  song: MemberSongView;
  /** Unit-only label ("회 공연" / "performances"). */
  countUnit: string;
}) {
  return (
    <li>
      <Link href={song.href} className={styles.songRow}>
        <span className={styles.songCopy}>
          <span className={styles.songTitle} lang={song.titleLang}>
            {song.title}
            {song.variant && (
              <>
                {" "}
                <span lang={song.variantLang}>{song.variant}</span>
              </>
            )}
          </span>
          {song.titleSub && (
            <span className={styles.songSub}>{song.titleSub}</span>
          )}
          {song.unitName && (
            <span className={styles.unitTag} lang={song.unitLang}>
              {song.unitName}
            </span>
          )}
        </span>
        <span className={styles.songCount}>
          {song.timesPerformed}
          <small>{countUnit}</small>
        </span>
        <span className={styles.arrow} aria-hidden="true">
          ›
        </span>
      </Link>
    </li>
  );
}
