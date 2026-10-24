"use client";

import { useImageFallback } from "@/components/shared/useImageFallback";
import type { LogoImage } from "@/lib/logoResolution";
import styles from "./seriesDetail.module.css";

/*
 * Managed series logo above the H1 (32-v1 identity panel).
 *
 * Shown only when the 07 resolver chose an image for this series; a
 * typography decision renders nothing here, because the H1 below IS
 * the typography form. When the chosen image fails to load, the slot
 * disappears and the H1 stands alone — no retry, and never a fall back
 * to an ancestor's logo or the series' generic image / an event poster
 * (07 contract: the operator chose THIS node's image).
 *
 * Decorative (`alt=""`): the H1 always prints the series name, so a
 * text alternative would read the title twice. `width`/`height` carry
 * the intrinsic size for layout; CSS fits it into the reserved responsive
 * box with `contain`, never distorting it. `key={src}` resets the
 * failure state when the URL changes (useImageFallback contract).
 */
export function SeriesLogo({ image }: { image: LogoImage }) {
  return <SeriesLogoInner key={image.url} image={image} />;
}

function SeriesLogoInner({ image }: { image: LogoImage }) {
  const { failed, imgProps } = useImageFallback();
  if (failed) return null;
  return (
    <div className={styles.logoSlot} data-testid="series-logo">
      {/* eslint-disable-next-line @next/next/no-img-element -- managed R2 asset; next/image would proxy and re-encode it */}
      <img
        src={image.url}
        width={image.width}
        height={image.height}
        alt=""
        referrerPolicy="no-referrer"
        decoding="async"
        {...imgProps}
      />
    </div>
  );
}
