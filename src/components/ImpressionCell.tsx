"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { formatDate } from "@/lib/utils";
import { trackEvent } from "@/lib/analytics";
import { colors } from "@/styles/tokens";
import type { Impression } from "./EventImpressions";

interface Props {
  impression: Impression;
  eventId: string;
  isOwn: boolean;
  hasReported: boolean;
  onReport: (impression: Impression) => void;
}

export function ImpressionCell({
  impression,
  eventId,
  isOwn,
  hasReported,
  onReport,
}: Props) {
  const t = useTranslations("Impression");
  const locale = useLocale();
  const canTranslate = impression.locale !== locale;

  const [translated, setTranslated] = useState<string | null>(null);
  const [showing, setShowing] = useState<"original" | "translated">("original");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);

  const handleTranslate = async () => {
    setError(false);

    if (showing === "translated") {
      setShowing("original");
      return;
    }

    const trackParams = {
      event_id: eventId,
      source_locale: impression.locale,
      target_locale: locale,
    };

    if (translated !== null) {
      trackEvent("impression_translate_click", trackParams);
      trackEvent("impression_translate_success", trackParams);
      setShowing("translated");
      return;
    }

    trackEvent("impression_translate_click", trackParams);
    setLoading(true);
    try {
      const res = await fetch("/api/impressions/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          impressionId: impression.id,
          targetLocale: locale,
        }),
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      const { translatedText } = await res.json();
      setTranslated(translatedText);
      setShowing("translated");
      trackEvent("impression_translate_success", trackParams);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const displayText =
    showing === "translated" && translated ? translated : impression.content;

  return (
    <div>
      <div
        // Explicit color + overflowWrap so the impression body is
        // always legible and never overflows its parent card on
        // narrow viewports — operator's mockup pass flagged both.
        // `whitespace-pre-wrap` preserves manual line breaks.
        style={{
          color: colors.textPrimary,
          whiteSpace: "pre-wrap",
          overflowWrap: "break-word",
        }}
      >
        {displayText}
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-zinc-400">
        <span>{formatDate(impression.createdAt, locale)}</span>
        <div className="flex items-center gap-3">
          {canTranslate && (
            <button
              type="button"
              onClick={handleTranslate}
              disabled={loading}
              className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-700 disabled:opacity-40"
            >
              <span aria-hidden="true">🌐</span>
              <span>
                {loading
                  ? t("translating")
                  : showing === "translated"
                    ? t("showOriginal")
                    : t("translate")}
              </span>
            </button>
          )}
          {!isOwn && (
            <button
              type="button"
              onClick={() => setShowReportModal(true)}
              disabled={hasReported}
              className="inline-flex items-center gap-1 text-zinc-400 hover:text-red-600 disabled:opacity-40"
            >
              <span aria-hidden="true">🚨</span>
              <span>{hasReported ? t("reported") : t("report")}</span>
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="mt-1 text-xs text-red-600">{t("translateFailed")}</div>
      )}
      {showReportModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowReportModal(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl p-6 w-80 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p
              className="font-semibold"
              style={{ color: colors.textPrimary }}
            >
              {t("reportConfirmTitle")}
            </p>
            <p
              className="mt-1 text-sm"
              style={{ color: colors.textMuted }}
            >
              {t("reportConfirmDescription")}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowReportModal(false)}
                className="px-4 py-2 text-sm rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowReportModal(false);
                  onReport(impression);
                }}
                className="px-4 py-2 text-sm rounded-lg text-red-500 font-semibold hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                {t("report")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
