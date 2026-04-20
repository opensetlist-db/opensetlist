"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { formatDate } from "@/lib/utils";
import type { Impression } from "./EventImpressions";

interface Props {
  impression: Impression;
  isOwn: boolean;
  hasReported: boolean;
  onReport: (impression: Impression) => void;
}

export function ImpressionCell({
  impression,
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

  const handleTranslate = async () => {
    setError(false);

    if (showing === "translated") {
      setShowing("original");
      return;
    }
    if (translated !== null) {
      setShowing("translated");
      return;
    }

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
      <div className="whitespace-pre-wrap">{displayText}</div>
      <div className="mt-1 flex items-center justify-between text-xs text-zinc-400">
        <span>{formatDate(impression.createdAt, locale)}</span>
        <div className="flex items-center gap-3">
          {canTranslate && (
            <button
              type="button"
              onClick={handleTranslate}
              disabled={loading}
              className="text-zinc-400 hover:text-zinc-700 disabled:opacity-40"
            >
              {loading
                ? t("translating")
                : showing === "translated"
                  ? t("showOriginal")
                  : t("translate")}
            </button>
          )}
          {!isOwn && (
            <button
              type="button"
              onClick={() => onReport(impression)}
              disabled={hasReported}
              className="text-zinc-400 hover:text-red-600 disabled:opacity-40"
            >
              {hasReported ? t("reported") : t("report")}
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="mt-1 text-xs text-red-600">{t("translateFailed")}</div>
      )}
    </div>
  );
}
