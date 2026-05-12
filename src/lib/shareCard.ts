/**
 * Share Card capture + three exit paths.
 *
 * The card is the same in every case (html2canvas → PNG blob). What
 * differs is where the bytes go:
 *
 *   1. **`shareCard()`** — download (desktops + browsers that can't
 *      file-share) or OS share sheet (touch-primary devices that pass
 *      `navigator.canShare({ files })`). One button in the modal,
 *      labelled "다운로드 / 공유". See the function docstring for the
 *      touch-primary / desktop split.
 *
 *   2. **`copyCardToClipboard()`** — `navigator.clipboard.write` with
 *      a `ClipboardItem` carrying `image/png`. One button in the
 *      modal, labelled "이미지 복사". The intended ergonomic is: skip
 *      the "save → open gallery → attach" loop on community sites
 *      (DCInside, Ruliweb, KakaoTalk) and let the user paste the
 *      image straight into a post or chat with Ctrl+V / ⌘V.
 *
 * Both paths share the html2canvas → blob pipeline (`renderCardToBlob`
 * below). `html2canvas` is dynamic-imported (~150KB) so the regular
 * event-page bundle doesn't grow — only loaded when the user actually
 * triggers one of these actions.
 *
 * History note: the v0.10.x rewrite collapsed both share + download
 * into download-only (the original mobile branch was branded "Share
 * to Twitter" and the intent broke when Twitter stopped surfacing
 * reliably). v0.10.2 reintroduced native share with a generic-sheet
 * framing. v0.11.3 force-downloaded on desktop even when canShare
 * succeeded, since macOS share sheets have no save-to-Downloads
 * entry. v0.11.4 splits the modal into two buttons (download/share
 * + clipboard-copy) so community-site posters can paste directly
 * instead of going through a download intermediate.
 */

export type ShareOutcome =
  | { kind: "downloaded" }
  | { kind: "shared" }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

export type CopyOutcome =
  | { kind: "copied" }
  /**
   * Browser doesn't support image clipboard writes — `ClipboardItem`
   * undefined or `navigator.clipboard.write` missing. Older Firefox,
   * some embedded WebViews. Caller can surface a distinct "your
   * browser doesn't support this" hint rather than the generic
   * failure toast.
   */
  | { kind: "unsupported" }
  /**
   * User-gesture-required failure or permissions-policy denial. iOS
   * Safari occasionally throws this if the async render outlives the
   * click-handler tick (we mitigate via Promise<Blob> inside
   * ClipboardItem). Firefox without explicit permission too. Caller
   * surfaces the same "couldn't copy" toast as the catch-all error
   * — the distinction is mostly for analytics.
   */
  | { kind: "denied" }
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
  /**
   * Pre-rasterized PNG blob. When provided, `shareCard()` skips the
   * html2canvas rasterization step and goes straight to share /
   * download with the supplied blob. This is the **iOS Safari user-
   * gesture preservation path**: the caller (`<ShareCardModal>`)
   * pre-rasterizes on modal open + theme change, so when the user
   * taps the share button the blob is already in memory and the
   * `navigator.share()` call can be initiated synchronously inside
   * the click handler — preserving the transient-activation
   * required by the Web Share API on iOS.
   *
   * If absent, the helper falls back to its v0.11.5 behavior of
   * rasterizing on demand. Useful for callers that don't have a
   * pre-rasterized blob available, or as a safety net when the
   * pre-rasterization itself failed.
   */
  preRasterizedBlob?: Blob;
}

export interface CopyCardOptions {
  cardEl: HTMLElement;
}

const DEFAULT_FILENAME = "opensetlist-result.png";

/**
 * html2canvas → PNG Blob, shared by both `shareCard()` and
 * `copyCardToClipboard()`. Rejects on any failure (html2canvas
 * throws, toBlob yields null, toBlob exceeds the 10s timeout).
 *
 * Kept as a Promise-returning helper (not an async function) so a
 * caller can pass the unresolved Promise directly into a
 * `ClipboardItem` constructor — that's the spec-recommended pattern
 * for preserving the user-gesture context through an async render
 * on iOS Safari. See `copyCardToClipboard` below for the use site.
 */
export function renderCardToBlob(cardEl: HTMLElement): Promise<Blob> {
  return (async () => {
    // Dynamic import keeps html2canvas out of the main bundle.
    // The package's default export is the function we want.
    const mod = await import("html2canvas");
    const html2canvas = mod.default;
    const canvas = await html2canvas(cardEl, {
      scale: 2, // ~1200px output for retina + Twitter quality
      useCORS: true, // for any external images (member-color avatars)
      backgroundColor: null, // preserve the card's own bg
      logging: false,
    });

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
      throw new Error("canvas.toBlob returned null");
    }
    return blob;
  })();
}

/**
 * Capture `cardEl` to a PNG, then either open the OS share sheet
 * (on touch-primary devices that also support file-share) or fall
 * back to a file download (everywhere else, including macOS). Returns
 * a `ShareOutcome` so the caller can surface the appropriate toast
 * (or, in the share-success / cancel case, stay silent — the OS
 * already owns the user feedback).
 */
export async function shareCard({
  cardEl,
  filename = DEFAULT_FILENAME,
  share,
  preRasterizedBlob,
}: ShareCardOptions): Promise<ShareOutcome> {
  let blob: Blob;
  if (preRasterizedBlob) {
    blob = preRasterizedBlob;
  } else {
    try {
      blob = await renderCardToBlob(cardEl);
    } catch (e) {
      return {
        kind: "error",
        message: e instanceof Error ? e.message : "render failed",
      };
    }
  }

  // Native-share branch — the preferred path on **touch-primary**
  // devices (phones + tablets in finger mode). On desktops, even
  // those that pass `canShare({ files })` (macOS Safari, macOS
  // Chrome 16.x+, Edge), the OS share sheet is platform-themed for
  // messaging/social-app handoff and notably lacks a "save to
  // Downloads" entry — a viewer who taps "다운로드 / 공유" on a MacBook
  // expecting a saved PNG ends up in a sheet with Mail / Messages /
  // AirDrop / Notes but no way to save the image. Operator-spotted
  // post-v0.11.1 on a MacBook. Gating with `(pointer: coarse)` is
  // the canonical "this device is touch-primary" media query: true
  // on iPhone / Android / iPad (touch), false on desktop with mouse
  // or trackpad, and correctly false on an iPad with a Magic
  // Keyboard trackpad attached (which gets desktop-like UX anyway).
  //
  // **Gate-free share attempt.** History of this branch's gating:
  //
  //   v0.11.4: `(pointer: coarse) && canShare({files})` — macOS
  //            route worked but iPhone still downloaded.
  //   v0.11.5 a: dropped canShare, kept pointer-coarse — iPhone still
  //            downloaded (matchMedia unreliable on user's iOS).
  //   v0.11.5 b: pointer-coarse OR Apple-mobile UA — iPhone still
  //            downloaded (UA detection didn't help either).
  //   v0.11.5 c: dropped pointer-coarse / UA, kept canShare({files})
  //            per operator-provided reference snippet — iPhone STILL
  //            downloaded. canShare({files:[pngFile]}) returns false
  //            on the operator's iPhone for reasons that don't show
  //            up in spec docs.
  //
  // Final shape: don't gate at all. If `navigator.share` exists, just
  // call it with the file payload. Three things can happen:
  //   1. Share succeeds → return `kind: "shared"`. iPhone, Android,
  //      macOS modern browsers — the expected path.
  //   2. Share throws AbortError → user dismissed the OS sheet →
  //      silent `kind: "cancelled"`, no toast.
  //   3. Share throws anything else (platform-can't-share-files,
  //      file-too-large, permission-policy, future failure modes) →
  //      fall through to download so the user always ends up with
  //      the image.
  //
  // Tradeoff: on a hypothetical platform that exposes
  // `navigator.share` but throws synchronously on every call, we
  // pay one rejected-promise cycle (~milliseconds) before falling
  // through. Invisible to the user since the fallback fires
  // immediately. The operator's reference code snippet used
  // canShare; we found it unreliable in practice on iOS Safari and
  // accept this slightly less-defensive shape in exchange for
  // actually working on real iPhones.
  const file = new File([blob], filename, { type: "image/png" });
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function"
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

  // Download fallback — triggered when `navigator.share` is missing
  // entirely or when `navigator.share` rejected with a non-abort
  // error (the helper above falls through to here instead of
  // returning). Synchronous `.click()` initiates the file write
  // before the function returns; the object URL is revoked after a
  // brief grace period to be safe on slow file systems.
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

/**
 * Capture `cardEl` to a PNG and write it to the system clipboard as
 * `image/png`. The user can then paste it directly (Ctrl+V / ⌘V) into
 * community-site post composers (DCInside, Ruliweb), messengers
 * (KakaoTalk, Slack, Discord), or anywhere else that handles image
 * paste — bypassing the "save → open gallery → attach" loop.
 *
 * **Critical iOS Safari pattern**: `ClipboardItem` is constructed with
 * the **unresolved** `Promise<Blob>` from `renderCardToBlob`, NOT an
 * awaited Blob. The spec requires this on iOS Safari so the user-
 * gesture context (the click event) stays valid across the async
 * html2canvas render. If we `await renderCardToBlob()` first and then
 * pass the resolved Blob to `ClipboardItem`, iOS Safari throws a
 * `NotAllowedError` because the gesture has expired by the time
 * `clipboard.write` is invoked. The desktop browsers (Chrome / Edge /
 * Safari) tolerate either ordering, so this pattern is the safe
 * common shape.
 *
 * Capability-gated by the caller (the modal checks `window.ClipboardItem`
 * + `navigator.clipboard.write` at mount time and hides the button on
 * unsupported browsers). The `unsupported` outcome here is a defense
 * for the edge case where the capability check passes but the call
 * still fails synthetically (DevTools simulation, locked-down embedded
 * WebViews).
 */
export async function copyCardToClipboard({
  cardEl,
}: CopyCardOptions): Promise<CopyOutcome> {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.clipboard?.write !== "function" ||
    typeof ClipboardItem === "undefined"
  ) {
    return { kind: "unsupported" };
  }

  try {
    // Pass the **unresolved** Promise<Blob> into ClipboardItem — see
    // the docstring above for the iOS Safari user-gesture rationale.
    // If renderCardToBlob rejects, the ClipboardItem promise rejects,
    // and `clipboard.write` rejects — caught below.
    const blobPromise = renderCardToBlob(cardEl);
    const item = new ClipboardItem({ "image/png": blobPromise });
    await navigator.clipboard.write([item]);
    return { kind: "copied" };
  } catch (e) {
    // NotAllowedError = user-gesture expired OR permission-policy
    // denied. Surface as `denied` so the modal can fire the GA4 event
    // with a useful `reason` field; UX-wise it falls under the same
    // "couldn't copy" toast as the catch-all error.
    if (e instanceof DOMException && e.name === "NotAllowedError") {
      return { kind: "denied" };
    }
    return {
      kind: "error",
      message: e instanceof Error ? e.message : "clipboard write failed",
    };
  }
}
