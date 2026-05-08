/**
 * Share Card capture + download (Phase 1B Stage C, simplified for
 * v0.10.x).
 *
 * Single path on every platform: rasterize `cardEl` via html2canvas,
 * then trigger a PNG download via `<a download>`. The user shares the
 * saved file manually wherever they want (Twitter web compose,
 * KakaoTalk, Discord, Photos, etc.).
 *
 * Earlier versions had two paths — `navigator.share({ files })` on
 * mobile and `window.open(twitter.com/intent/tweet)` + download on
 * desktop. Both were dropped in favor of the simpler download-only
 * flow because:
 *
 *   - Twitter's web intent (`twitter.com/intent/tweet?text=…&url=…`)
 *     is text+URL only — there is no API to attach images via URL
 *     params. Users who tapped "Share to Twitter" on desktop saw an
 *     empty compose window and concluded the button was broken.
 *   - `navigator.share({ files })` only surfaces apps that registered
 *     for `image/png` AND have an active share extension. Twitter
 *     does not always appear in the OS sheet (operator-confirmed
 *     during v0.10.x smoke), making the "Share to Twitter" branding
 *     a broken promise on those devices.
 *
 * Download is the only path that works identically on every browser /
 * OS / installed-app combination. The "Copy link" sibling CTA in
 * `<ShareCardModal>` covers the URL-paste case.
 *
 * `html2canvas` is dynamic-imported (~150KB lib) so the regular
 * event-page bundle doesn't grow — only loaded when the share button
 * is actually tapped.
 */

export type ShareOutcome =
  | { kind: "downloaded" }
  | { kind: "error"; message: string };

/**
 * Hard timeout on `canvas.toBlob` so a tainted-canvas / OOM /
 * driver-bug edge case can't leave the modal in a permanent
 * `busy=true` state. 10s is generous for the worst real captures
 * (1200×N retina PNGs); anything past it is a genuine failure.
 * CR #281 flagged the unbounded wait.
 */
const TO_BLOB_TIMEOUT_MS = 10_000;

/**
 * Delay before revoking the blob: object URL after the synchronous
 * `<a>.click()` initiates the download. The click handler is
 * synchronous so the browser has already started the file write
 * by this point, but a brief grace period guards against any
 * unusual timing on slow file systems / disk throttling. 1s is
 * standard.
 */
const REVOKE_URL_DELAY_MS = 1_000;

export interface ShareCardOptions {
  cardEl: HTMLElement;
  /** PNG filename (download path). */
  filename?: string;
}

const DEFAULT_FILENAME = "opensetlist-result.png";

/**
 * Capture `cardEl` to a PNG and trigger a file download. Returns a
 * `ShareOutcome` so the caller can surface the appropriate toast.
 */
export async function shareCard({
  cardEl,
  filename = DEFAULT_FILENAME,
}: ShareCardOptions): Promise<ShareOutcome> {
  // Dynamic import keeps html2canvas out of the main bundle.
  // The package's default export is the function we want.
  let canvas: HTMLCanvasElement;
  try {
    const mod = await import("html2canvas");
    const html2canvas = mod.default;
    canvas = await html2canvas(cardEl, {
      scale: 2, // ~1200px output for retina + Twitter quality
      useCORS: true, // for any external images (member-color avatars)
      backgroundColor: null, // preserve the card's own bg
      logging: false,
    });
  } catch (e) {
    return {
      kind: "error",
      message: e instanceof Error ? e.message : "html2canvas failed",
    };
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, TO_BLOB_TIMEOUT_MS);
    canvas.toBlob((b) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(b);
      }
    }, "image/png");
  });
  if (!blob) {
    return { kind: "error", message: "canvas.toBlob returned null" };
  }

  // Trigger the download via a hidden `<a download>`. The synchronous
  // `.click()` initiates the file write before the function returns;
  // the object URL is revoked after a brief grace period to be safe
  // on slow file systems.
  try {
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), REVOKE_URL_DELAY_MS);
    return { kind: "downloaded" };
  } catch (e) {
    return {
      kind: "error",
      message: e instanceof Error ? e.message : "download failed",
    };
  }
}
