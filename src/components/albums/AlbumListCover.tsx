"use client";

import { useTranslations } from "next-intl";
import { useImageFallback } from "@/components/shared/useImageFallback";
import styles from "./albumList.module.css";

/*
 * Album list row cover (26-v1).
 *
 * Same fallback contract as the shared `CoverImage` (06): square slot
 * that never collapses, `referrerPolicy="no-referrer"` for external
 * covers (Amazon CDN), missing or failed image → ♫ + localized "no
 * image" in the same square, no retry and no older-URL fallback. The
 * shared `useImageFallback` hook keeps the pre-hydration failure
 * detection in one place.
 *
 * Why not `CoverImage` itself: 26-v1 steps the square through 72 / 64 /
 * 56px at the 700 / 360px bands with a 28/24px glyph and a 10/9/8px
 * label, while `CoverImage` takes one inline `size` (and derives the
 * glyph from it). Same reasoning as the album detail `AlbumCover`.
 *
 * Decorative: the row prints the title next to the cover, so both the
 * image (`alt=""`) and the placeholder are hidden from assistive tech.
 * `loading="lazy"` because the list is unpaginated (~500 rows); the
 * fixed slot reserves the square, so lazy loading causes no shift.
 */
export function AlbumListCover({ src }: { src: string | null }) {
  // Remount on URL change so a previous failure does not stick.
  return <AlbumListCoverInner key={src ?? ""} src={src} />;
}

function AlbumListCoverInner({ src }: { src: string | null }) {
  const t = useTranslations("SharedImage");
  const { failed, imgProps } = useImageFallback();
  const showImage = Boolean(src) && !failed;

  return (
    <div
      className={styles.cover}
      data-testid="album-list-cover"
      data-state={showImage ? "image" : "fallback"}
      aria-hidden="true"
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src ?? undefined}
          alt=""
          width={72}
          height={72}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          {...imgProps}
        />
      ) : (
        <>
          <span className={styles.coverNote}>♫</span>
          <span className={styles.coverLabel}>{t("noImage")}</span>
        </>
      )}
    </div>
  );
}
