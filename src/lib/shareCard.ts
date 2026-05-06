/**
 * Share Card capture + share orchestration (Phase 1B Stage C).
 *
 * Two paths per the task spec:
 *
 *   Mobile (navigator.canShare returns true for files):
 *     html2canvas → PNG Blob → File → navigator.share({files,text,url})
 *     OS opens its native share sheet; the user picks Twitter / Line /
 *     Instagram etc. Image, text, and URL travel together.
 *
 *   Desktop (no canShare):
 *     html2canvas → PNG Blob → trigger download (opensetlist-result.png)
 *     + window.open() Twitter intent URL with text+URL prefilled.
 *     User manually attaches the saved PNG (Twitter intent doesn't
 *     accept file URL params). Caller surfaces a toast nudge.
 *
 * `html2canvas` is dynamic-imported (~150KB lib) so the regular
 * event-page bundle doesn't grow — only loaded when the share
 * button is actually tapped.
 */

export type ShareOutcome =
  | { kind: "shared" } // navigator.share resolved (mobile)
  | { kind: "downloaded" } // download + Twitter intent (desktop)
  | { kind: "cancelled" } // user cancelled native sheet
  | { kind: "error"; message: string };

export interface ShareCardOptions {
  cardEl: HTMLElement;
  /** Text body for the tweet / share — pre-formatted by caller. */
  text: string;
  /** Canonical event URL. */
  url: string;
  /** PNG filename (download path on desktop). */
  filename?: string;
}

const DEFAULT_FILENAME = "opensetlist-result.png";

/**
 * Capture `cardEl` to a PNG and either invoke the native share sheet
 * (mobile) or download + open Twitter intent (desktop). Returns a
 * `ShareOutcome` so the caller can surface the appropriate toast.
 */
export async function shareCard({
  cardEl,
  text,
  url,
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

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png"),
  );
  if (!blob) {
    return { kind: "error", message: "canvas.toBlob returned null" };
  }
  const file = new File([blob], filename, { type: "image/png" });

  // Try native share first. `canShare({files: [file]})` returns true
  // on mobile browsers that support file sharing. Some desktop
  // browsers (notably Safari + Chromium with the right flags) also
  // support it; that's fine — they get the sheet too.
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({ files: [file], text, url });
      return { kind: "shared" };
    } catch (e) {
      // The user cancelling the sheet throws AbortError — treat as
      // a clean cancel, not an error.
      if (e instanceof DOMException && e.name === "AbortError") {
        return { kind: "cancelled" };
      }
      return {
        kind: "error",
        message: e instanceof Error ? e.message : "navigator.share failed",
      };
    }
  }

  // Desktop fallback: download the PNG + open Twitter intent.
  // The user manually attaches the saved file in the compose window;
  // Twitter intent URLs don't accept file params. Caller is expected
  // to surface a toast nudging this step.
  try {
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Free the object URL after a tick — the click handler is
    // synchronous so the download is initiated before this fires.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);

    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    window.open(twitterUrl, "_blank", "noopener,noreferrer");

    return { kind: "downloaded" };
  } catch (e) {
    return {
      kind: "error",
      message: e instanceof Error ? e.message : "download failed",
    };
  }
}
