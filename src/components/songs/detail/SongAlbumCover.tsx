"use client";

import { useTranslations } from "next-intl";
import { useImageFallback } from "@/components/shared/useImageFallback";
import styles from "./songDetail.module.css";

/*
 * 64px album cover square in the Song detail album panel (28-v1).
 *
 * Same fallback contract as the shared `CoverImage` (06): the square
 * never collapses, `referrerPolicy="no-referrer"` for external covers,
 * missing or failed image → ♫ + localized "no image" in the same square,
 * no retry. Reuses the shared `useImageFallback` hook.
 *
 * Why not `CoverImage` itself: 28-v1 shows the "no image" label at 10px
 * inside a 64px square with `object-fit: contain` (letterboxed, not
 * cropped), while CoverImage uses `cover`; the CSS module owns those
 * values next to the rest of the panel.
 */
export function SongAlbumCover({ src, alt }: { src: string | null; alt: string }) {
  // Remount on URL change so a previous failure does not stick.
  return <SongAlbumCoverInner key={src ?? ""} src={src} alt={alt} />;
}

function SongAlbumCoverInner({ src, alt }: { src: string | null; alt: string }) {
  const t = useTranslations("SharedImage");
  const { failed, imgProps } = useImageFallback();
  const showImage = Boolean(src) && !failed;

  return (
    <div
      className={styles.miniCover}
      data-testid="song-album-cover"
      data-state={showImage ? "image" : "fallback"}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src ?? undefined}
          alt={alt}
          referrerPolicy="no-referrer"
          {...imgProps}
        />
      ) : (
        <>
          <span className={styles.miniNote} aria-hidden="true">
            ♫
          </span>
          <small className={styles.miniLabel}>{t("noImage")}</small>
        </>
      )}
    </div>
  );
}
