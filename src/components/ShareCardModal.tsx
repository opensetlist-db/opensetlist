"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { ShareCardPreview } from "@/components/ShareCardPreview";
import { shareCard, type ShareOutcome } from "@/lib/shareCard";
import type { LiveSetlistItem } from "@/lib/types/setlist";
import type { PredictionEntry } from "@/lib/predictionsStorage";
import { zIndex, type ShareCardTheme } from "@/styles/tokens";

/**
 * Toast auto-dismiss duration. 3s is long enough to read a short
 * Korean/Japanese sentence (the longest copy is ~30 chars) without
 * lingering past the user's attention. Mirrors the named-constant
 * pattern in `src/lib/shareCard.ts` (`TO_BLOB_TIMEOUT_MS`).
 */
const TOAST_DISMISS_MS = 3_000;

interface Props {
  open: boolean;
  onClose: () => void;
  // Card payload + score (caller computes via calcShareCardScore).
  seriesName: string;
  eventTitle: string;
  dateLine: string;
  actualSongs: LiveSetlistItem[];
  predictions: PredictionEntry[];
  matched: number;
  total: number;
  percentage: number;
  predictedCount: number;
  locale: string;
  /**
   * Canonical event URL, used by the "Copy link" CTA. The
   * `shareCard()` helper no longer consumes a text/URL payload —
   * v0.10.x dropped both the Twitter intent open and the
   * navigator.share path in favor of a download-only flow (see
   * `src/lib/shareCard.ts` docstring).
   */
  shareUrl: string;
}

/**
 * Post-show share-card preview modal.
 *
 * The user opens it from `<ShareCardButton>` (post-show only). The
 * modal renders `<ShareCardPreview>` (the html2canvas capture
 * target), a dark/light theme toggle, and two CTA buttons:
 *
 *   - 이미지 저장: triggers `shareCard()` which rasterizes the
 *     preview and downloads it as a PNG. The user shares the saved
 *     file manually wherever they want — Twitter web compose,
 *     KakaoTalk, Discord, Photos. v0.10.x dropped the earlier
 *     "Share to Twitter" branding because Twitter's web intent
 *     is text+URL only and `navigator.share` doesn't reliably
 *     surface Twitter in the OS sheet.
 *   - 링크 복사: copies the canonical event URL via Clipboard API.
 *
 * Accessibility: `Escape` closes; click-outside closes; first
 * focusable element gets focus on open. role=dialog + aria-modal +
 * aria-labelledby for screen readers.
 */
export function ShareCardModal({
  open,
  onClose,
  seriesName,
  eventTitle,
  dateLine,
  actualSongs,
  predictions,
  matched,
  total,
  percentage,
  predictedCount,
  locale,
  shareUrl,
}: Props) {
  const t = useTranslations("ShareCard");
  const [theme, setTheme] = useState<ShareCardTheme>("dark");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Focus the close button on open so Escape works without
  // additional focus-trap glue. On close, restore focus to the
  // element that opened the modal (typically the `결과 공유 🎯`
  // button in `<ShareCardButton>`) — standard a11y dialog pattern,
  // preserves keyboard navigation context. Mobile users get the
  // same first-tap anchor on open.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => {
      opener?.focus?.();
    };
  }, [open]);

  // Auto-dismiss toast after 3s.
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!open) return null;

  // While the share-card capture is in flight, every state-mutating
  // path on the modal must early-return. html2canvas walks the live
  // DOM under `cardRef.current` for ~1–3s on mobile; closing the
  // modal mid-capture would unmount the capture target and crash
  // the call, and a theme toggle would mutate the painted styles
  // partway through capture and produce a garbled image. The share
  // button's existing `busy` short-circuit covers double-tap; the
  // others (backdrop click, Escape, close-X, theme toggle,
  // copy-link) need the same guard. CR #285 caught this on the
  // release diff.
  const handleClose = () => {
    if (busy) return;
    onClose();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      handleClose();
    }
  };

  const handleShare = async () => {
    if (!cardRef.current || busy) return;
    setBusy(true);
    try {
      const outcome: ShareOutcome = await shareCard({
        cardEl: cardRef.current,
        // Native-share payload — only consulted when the OS sheet
        // path is taken. Title for surfaces that show one (Twitter
        // compose, KakaoTalk caption); text for ones that compose a
        // body (Messages, email); url so users on URL-aware targets
        // (Twitter, Discord) get an unfurl. The image File itself is
        // always attached regardless of which fields the platform
        // honors.
        share: {
          title: eventTitle,
          text: t("shareText", { matched, total, percentage }),
          url: shareUrl,
        },
      });
      if (outcome.kind === "downloaded") setToast(t("imageSavedToast"));
      // `shared` and `cancelled` are intentionally silent — the OS
      // share sheet already gave the user feedback (a toast, an
      // animation, or just dismissed). Surfacing our own toast on
      // top would be redundant and noisy.
      // CR #295: surface a toast on error too. Without it, a tainted-
      // canvas / OOM / driver-bug failure leaves the user with no
      // feedback — the spinner stops, but they can't tell whether the
      // download silently succeeded or quietly broke. The toast tells
      // them to retry or fall back to "Copy link".
      else if (outcome.kind === "error") setToast(t("imageErrorToast"));
    } catch {
      // Defensive: today's `shareCard()` catches every internal async
      // path and always returns a ShareOutcome rather than throwing.
      // But the dynamic `import("html2canvas")` is the kind of code
      // that could grow new throws over time (network failures,
      // bundler chunk-load errors, future refactors). Wrapping here
      // guarantees the same error toast even if shareCard rethrows,
      // and `finally` guarantees `busy` is released so the modal
      // doesn't lock. CR #295 round 2.
      setToast(t("imageErrorToast"));
    } finally {
      setBusy(false);
    }
  };

  const handleCopyLink = async () => {
    if (busy) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setToast(t("linkCopiedToast"));
    } catch {
      // Clipboard API requires HTTPS + user gesture (both present
      // here normally). Surface a toast so a failed copy isn't
      // silent — user knows to copy the URL manually instead of
      // assuming success and moving on. CR #281 caught this.
      setToast(t("linkCopyFailedToast"));
    }
  };

  const handleThemeChange = (m: ShareCardTheme) => {
    if (busy) return;
    setTheme(m);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-card-modal-title"
      onKeyDown={handleKeyDown}
      onClick={handleClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: zIndex.modal,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 632, width: "100%" }}
      >
        {/* Header strip — title + close button. */}
        <div
          className="flex items-center justify-between mb-3"
          style={{ color: "white" }}
        >
          <h2 id="share-card-modal-title" className="text-base font-medium">
            {t("modalTitle")}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={handleClose}
            disabled={busy}
            aria-label={t("close")}
            className="text-xl leading-none p-1 cursor-pointer"
            style={{
              background: "transparent",
              border: "none",
              color: "white",
              cursor: busy ? "wait" : "pointer",
            }}
          >
            ✕
          </button>
        </div>

        {/* Theme toggle */}
        <div
          className="flex justify-center gap-2 mb-3"
          role="group"
          aria-label={t("modalTitle")}
        >
          {(["dark", "light"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => handleThemeChange(m)}
              disabled={busy}
              aria-pressed={theme === m}
              className="text-xs font-medium rounded-full px-4 py-1 cursor-pointer"
              style={{
                background: theme === m ? "#0277BD" : "white",
                color: theme === m ? "white" : "#475569",
                border: "0.5px solid #e2e8f0",
                cursor: busy ? "wait" : "pointer",
              }}
            >
              {t(m === "dark" ? "themeDark" : "themeLight")}
            </button>
          ))}
        </div>

        {/* Card preview */}
        <div className="flex justify-center">
          <ShareCardPreview
            ref={cardRef}
            theme={theme}
            seriesName={seriesName}
            eventTitle={eventTitle}
            dateLine={dateLine}
            actualSongs={actualSongs}
            predictions={predictions}
            matched={matched}
            total={total}
            percentage={percentage}
            predictedCount={predictedCount}
            locale={locale}
          />
        </div>

        {/* Action buttons */}
        <div className="flex justify-center gap-2 mt-3">
          <button
            type="button"
            onClick={handleShare}
            disabled={busy}
            className="text-sm font-medium rounded-full px-5 py-2 cursor-pointer"
            style={{
              // Brand blue gradient (matches the `결과 공유 🎯`
              // opener in `<ShareCardButton>`) instead of the
              // earlier Twitter-blue `#1d9bf0`. The button no longer
              // claims Twitter, so the brand color reads cleaner.
              background: busy
                ? "#94a3b8"
                : "linear-gradient(135deg, #4FC3F7, #0277BD)",
              color: "white",
              border: "none",
              cursor: busy ? "wait" : "pointer",
            }}
          >
            {t("saveImage")}
          </button>
          <button
            type="button"
            onClick={handleCopyLink}
            disabled={busy}
            className="text-sm rounded-full px-5 py-2 cursor-pointer"
            style={{
              background: "white",
              color: "#475569",
              border: "1px solid #e2e8f0",
              cursor: busy ? "wait" : "pointer",
            }}
          >
            {t("copyLink")}
          </button>
        </div>

        {/* Toast */}
        {toast && (
          <div
            role="status"
            aria-live="polite"
            className="text-center mt-3 text-xs"
            style={{
              color: "white",
              background: "rgba(15, 23, 42, 0.85)",
              padding: "8px 12px",
              borderRadius: 8,
              maxWidth: 360,
              margin: "12px auto 0",
            }}
          >
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
