"use client";

import { useTranslations } from "next-intl";
import { useImageFallback } from "@/components/shared/useImageFallback";
import styles from "./albumDetail.module.css";

/*
 * Album detail cover slot (22-v1 identity card).
 *
 * Same fallback contract as the shared `CoverImage` (06): square slot
 * that never collapses, `referrerPolicy="no-referrer"` for external
 * covers (Amazon CDN), missing or failed image → ♫ + localized "no
 * image" in the same square, no retry. It reuses the shared
 * `useImageFallback` hook so the pre-hydration failure detection stays
 * in one place.
 *
 * Why not `CoverImage` itself: its edge length is a fixed `size` prop
 * applied inline, while 22-v1 steps the square through 200 / 160 / 112 /
 * 88px at the 1100 / 700 / 360px bands. Those widths live in the CSS
 * module; rendering four fixed-size instances or overriding inline sizes
 * with `!important` would both be worse than this thin wrapper.
 *
 * The image is named after the album (the previous sidebar card did the
 * same); the fallback text is visible, so it needs no extra label.
 */
export function AlbumCover({ src, alt }: { src: string | null; alt: string }) {
  // Remount on URL change so a previous failure does not stick.
  return <AlbumCoverInner key={src ?? ""} src={src} alt={alt} />;
}

function AlbumCoverInner({ src, alt }: { src: string | null; alt: string }) {
  const t = useTranslations("SharedImage");
  const { failed, imgProps } = useImageFallback();
  const showImage = Boolean(src) && !failed;

  return (
    <div
      className={styles.cover}
      data-testid="album-cover"
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
          <span className={styles.coverNote} aria-hidden="true">
            ♫
          </span>
          <span className={styles.coverLabel}>{t("noImage")}</span>
        </>
      )}
    </div>
  );
}
