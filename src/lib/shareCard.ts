/**
 * Share Card capture + native-share-or-download.
 *
 * Two paths depending on capability:
 *
 *   1. Native share (mobile + any browser exposing
 *      `navigator.canShare({ files })`): rasterize, build a `File`,
 *      hand it to `navigator.share({ files, title, text, url })`.
 *      The OS share sheet appears with the user's installed apps —
 *      Photos / Messages / KakaoTalk / Twitter / etc. — and we do
 *      nothing further. Successful share returns `kind: "shared"`.
 *      User-dismiss returns `kind: "cancelled"` (silent — no toast).
 *
 *   2. Download fallback (desktop browsers + any environment that
 *      can't share files): trigger a PNG file download via
 *      `<a download>`, returning `kind: "downloaded"`. The user
 *      manually attaches it wherever they want.
 *
 * History note: the v0.10.x rewrite collapsed both paths into
 * download-only, because the original mobile branch was branded as
 * "Share to Twitter" and Twitter doesn't always surface in the OS
 * share sheet. This version reintroduces native share with a
 * different framing — it's the generic OS sheet, no app promised —
 * so the missing-Twitter case is no longer a broken contract; it's
 * just one fewer option in a list the user already understands.
 *
 * `html2canvas` is dynamic-imported (~150KB lib) so the regular
 * event-page bundle doesn't grow — only loaded when the share button
 * is actually tapped.
 */

export type ShareOutcome =
  | { kind: "downloaded" }
  | { kind: "shared" }
  | { kind: "cancelled" }
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
  /** PNG filename (used as the File name for share, and as the
   *  download attribute for the fallback path). */
  filename?: string;
  /**
   * Optional payload for `navigator.share`. Only consulted when the
   * native-share path is taken; ignored on the download fallback.
   * Each field is forwarded as-is — see the Web Share API spec for
   * platform-specific behavior (some surfaces use `title`, some
   * compose `text + url`, some only attach the file).
   */
  share?: {
    title?: string;
    text?: string;
    url?: string;
  };
}

const DEFAULT_FILENAME = "opensetlist-result.png";

/**
 * Capture `cardEl` to a PNG, then either open the OS share sheet
 * (when `navigator.canShare({ files })` says yes) or fall back to a
 * file download. Returns a `ShareOutcome` so the caller can surface
 * the appropriate toast (or, in the share-success / cancel case,
 * stay silent — the OS already owns the user feedback).
 */
export async function shareCard({
  cardEl,
  filename = DEFAULT_FILENAME,
  share,
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

  // Native-share branch — the preferred path on mobile and on any
  // desktop browser that supports file-share (Safari, Edge, recent
  // Chromium on macOS). `canShare({ files })` is the right gate: it
  // returns false when the platform can't attach files even if
  // `navigator.share` itself exists, so a positive result means the
  // OS will actually show a usable sheet. AbortError = user dismissed
  // the sheet → silent `cancelled`. Any other share failure (rare:
  // file-too-large, permission denied) falls through to the download
  // fallback so the user still gets the image.
  const file = new File([blob], filename, { type: "image/png" });
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    typeof navigator.share === "function" &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      const payload: ShareData = { files: [file] };
      if (share?.title) payload.title = share.title;
      if (share?.text) payload.text = share.text;
      if (share?.url) payload.url = share.url;
      await navigator.share(payload);
      return { kind: "shared" };
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        return { kind: "cancelled" };
      }
      // Non-abort failure — fall through to the download fallback so
      // the user always ends up with the image one way or the other.
    }
  }

  // Download fallback — triggered when canShare is unsupported or
  // the share path threw a non-abort error. Synchronous `.click()`
  // initiates the file write before the function returns; the object
  // URL is revoked after a brief grace period to be safe on slow file
  // systems.
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
