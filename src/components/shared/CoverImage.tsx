"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { colors } from "@/styles/tokens";

/*
 * Square album-cover slot — shared fallback contract from redesign
 * packet 03-v1.1. Page tickets (album list 27 / detail 23, artist 21,
 * song 29, search 13) adopt it; existing thumbnails (AlbumCard,
 * AlbumInfoCard, …) keep their current rendering until their page
 * ticket moves them over.
 *
 *   - Geometry is always square at `size` px; a missing or failed image
 *     never collapses the slot.
 *   - Covers fill the square (`cover`): album art is square by nature,
 *     unlike event logos, which use EventArt's `contain`.
 *   - `referrerPolicy="no-referrer"` always — existing external cover
 *     URLs (Amazon CDN etc.) stay valid only without a Referer.
 *   - Missing/failed → music-note glyph + localized "no image" label in
 *     the same square. No retry.
 *
 * Decorative by default (`alt=""`): album pages print the title next to
 * the cover.
 */

export interface CoverImageProps {
  src?: string | null;
  /** Edge length in px. */
  size: number;
  alt?: string;
  /** Corner radius; 8px matches the 03 control radius. */
  radius?: number;
  className?: string;
}

export function CoverImage(props: CoverImageProps) {
  // Reset the failure flag when the URL changes.
  return <CoverImageInner key={props.src ?? ""} {...props} />;
}

function CoverImageInner({
  src,
  size,
  alt = "",
  radius = 8,
  className = "",
}: CoverImageProps) {
  const t = useTranslations("SharedImage");
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;
  // The visible label only fits from ~64px up; smaller thumbnails show
  // the glyph alone.
  const showLabel = size >= 64;
  // Fallback semantics follow `alt`: decorative covers hide the
  // placeholder from assistive tech; a named cover keeps its name.
  const fallbackA11y = alt
    ? ({ role: "img", "aria-label": alt } as const)
    : ({ "aria-hidden": true } as const);

  return (
    <div
      data-testid="cover-image"
      data-state={showImage ? "image" : "fallback"}
      {...(showImage ? {} : fallbackA11y)}
      className={`flex shrink-0 flex-col items-center justify-center gap-1 overflow-hidden ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: showImage ? "transparent" : "#f2f4f9",
        border: showImage ? undefined : `1px solid ${colors.border}`,
        color: colors.textSecondary,
      }}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src ?? undefined}
          alt={alt}
          referrerPolicy="no-referrer"
          // An image that failed before hydration never fires onError.
          ref={(img) => {
            if (img && img.complete && img.naturalWidth === 0) setFailed(true);
          }}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <>
          <span
            aria-hidden="true"
            style={{ fontSize: Math.max(14, Math.round(size * 0.27)) }}
          >
            ♫
          </span>
          {showLabel && <span className="text-[9px]">{t("noImage")}</span>}
        </>
      )}
    </div>
  );
}
