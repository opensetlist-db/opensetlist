"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { ShareCardPreview } from "@/components/ShareCardPreview";
import { shareCard, type ShareOutcome } from "@/lib/shareCard";
import type { LiveSetlistItem } from "@/lib/types/setlist";
import type { PredictionEntry } from "@/lib/predictionsStorage";
import { zIndex, type ShareCardTheme } from "@/styles/tokens";

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
  // For the share text + URL.
  shareText: string;
  shareUrl: string;
}

/**
 * Post-show share-card preview modal.
 *
 * The user opens it from `<ShareCardButton>` (post-show only). The
 * modal renders `<ShareCardPreview>` (the html2canvas capture
 * target), a dark/light theme toggle, and two CTA buttons:
 *
 *   - 트위터에 공유: triggers `shareCard()` which picks
 *     navigator.share (mobile) or download + Twitter intent (desktop).
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
  shareText,
  shareUrl,
}: Props) {
  const t = useTranslations("ShareCard");
  const [theme, setTheme] = useState<ShareCardTheme>("dark");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Focus the close button on open so Escape works without
  // additional focus-trap glue. Mobile users get the same first-tap
  // anchor.
  useEffect(() => {
    if (open) closeButtonRef.current?.focus();
  }, [open]);

  // Auto-dismiss toast after 3s.
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!open) return null;

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const handleShare = async () => {
    if (!cardRef.current || busy) return;
    setBusy(true);
    const outcome: ShareOutcome = await shareCard({
      cardEl: cardRef.current,
      text: shareText,
      url: shareUrl,
    });
    setBusy(false);
    if (outcome.kind === "downloaded") setToast(t("imageSavedToast"));
    else if (outcome.kind === "popup_blocked") setToast(t("popupBlockedToast"));
    // For "shared" / "cancelled" / "error" we surface no toast —
    // the OS sheet handles its own feedback (success/cancel) and
    // an error here is rare enough that silent-fail keeps the
    // happy path uncluttered.
  };

  const handleCopyLink = async () => {
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-card-modal-title"
      onKeyDown={handleKeyDown}
      onClick={onClose}
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
            onClick={onClose}
            aria-label={t("close")}
            className="text-xl leading-none p-1 cursor-pointer"
            style={{ background: "transparent", border: "none", color: "white" }}
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
              onClick={() => setTheme(m)}
              aria-pressed={theme === m}
              className="text-xs font-medium rounded-full px-4 py-1 cursor-pointer"
              style={{
                background: theme === m ? "#0277BD" : "white",
                color: theme === m ? "white" : "#475569",
                border: "0.5px solid #e2e8f0",
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
              background: busy ? "#94a3b8" : "#1d9bf0",
              color: "white",
              border: "none",
              cursor: busy ? "wait" : "pointer",
            }}
          >
            {t("shareTwitter")}
          </button>
          <button
            type="button"
            onClick={handleCopyLink}
            className="text-sm rounded-full px-5 py-2 cursor-pointer"
            style={{
              background: "white",
              color: "#475569",
              border: "1px solid #e2e8f0",
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
