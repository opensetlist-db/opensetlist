"use client";

import { useCallback, useState } from "react";

/*
 * Failure tracking for the shared image slots (EventArt, CoverImage):
 * `failed` flips once the image cannot be shown, and the slot renders its
 * fallback in the same reserved geometry. No retry.
 *
 * Two ways an image fails:
 *   - `onError` after hydration — the normal case.
 *   - It already failed BEFORE hydration (fast 404 on a server-rendered
 *     <img>): React never sees that error event. The ref callback catches
 *     it when the node attaches — the image is `complete` with no pixels.
 *     "complete + naturalWidth 0" alone is not proof, though: Firefox
 *     reports 0 for a loaded SVG without intrinsic size. `decode()`
 *     separates the two — it rejects only for an image that cannot be
 *     rendered.
 *
 * Callers remount the slot (`key={src}`) when the URL changes, which
 * resets `failed`.
 */
export function useImageFallback() {
  const [failed, setFailed] = useState(false);
  const ref = useCallback((img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth === 0) {
      img.decode().catch(() => setFailed(true));
    }
  }, []);
  const onError = useCallback(() => setFailed(true), []);
  return { failed, imgProps: { ref, onError } };
}
