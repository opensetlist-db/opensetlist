"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { formatDate } from "@/lib/utils";
import { IMPRESSION_MAX_CHARS } from "@/lib/config";
import { getEditCooldownRemaining } from "@/lib/impression";
import { useImpressionPolling } from "@/hooks/useImpressionPolling";

export interface Impression {
  id: string;
  rootImpressionId: string;
  eventId: string;
  content: string;
  locale: string;
  createdAt: string;
}

interface SavedImpression {
  chainId: string;
  content: string;
  createdAt: string;
}

interface Props {
  eventId: string;
  initialImpressions: Impression[];
  isOngoing: boolean;
}

export function EventImpressions({
  eventId,
  initialImpressions,
  isOngoing,
}: Props) {
  const t = useTranslations("Impression");
  const et = useTranslations("Event");
  const locale = useLocale();
  const [impressions, setImpressions] = useState<Impression[]>(initialImpressions);

  const { impressions: polled } = useImpressionPolling({
    eventId,
    enabled: isOngoing,
  });
  const [saved, setSaved] = useState<SavedImpression | null>(null);
  const [mode, setMode] = useState<"new" | "submitted" | "editing">("new");
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Keyed by rootImpressionId so a chain can't be reported twice across edits.
  const [reported, setReported] = useState<Record<string, boolean>>({});

  const savedKey = `impression-${eventId}`;

  useEffect(() => {
    setImpressions(initialImpressions);
    setReported({});
  }, [eventId, initialImpressions]);

  useEffect(() => {
    if (!polled) return;
    setImpressions(polled);
  }, [polled]);

  useEffect(() => {
    setSaved(null);
    setMode("new");
    setDraft("");
    setCooldownSeconds(0);
    setError(null);

    const raw = localStorage.getItem(savedKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as SavedImpression;
      if (parsed?.chainId && parsed.content) {
        setSaved(parsed);
        setMode("submitted");
        if (parsed.createdAt) {
          const remaining = getEditCooldownRemaining(
            new Date(parsed.createdAt),
            new Date(),
          );
          if (remaining > 0) setCooldownSeconds(remaining);
        }
      }
    } catch {
      localStorage.removeItem(savedKey);
    }
  }, [savedKey]);

  useEffect(() => {
    setReported((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const imp of impressions) {
        if (imp.rootImpressionId in next) continue;
        if (
          localStorage.getItem(`impression-report-${imp.rootImpressionId}`) ===
          "true"
        ) {
          next[imp.rootImpressionId] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [impressions]);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = setTimeout(() => {
      setCooldownSeconds((prev) => Math.max(prev - 1, 0));
    }, 1000);
    return () => clearTimeout(timer);
  }, [cooldownSeconds]);

  const persistSaved = useCallback(
    (value: SavedImpression | null) => {
      if (value) {
        localStorage.setItem(savedKey, JSON.stringify(value));
      } else {
        localStorage.removeItem(savedKey);
      }
    },
    [savedKey]
  );

  // After an edit, the new row has a different `id` than the prior version,
  // so dedup must be on the chain id — otherwise the old version would
  // remain in the visible list.
  const mergeImpression = (imp: Impression) => {
    setImpressions((prev) => {
      const without = prev.filter(
        (p) => p.rootImpressionId !== imp.rootImpressionId
      );
      return [imp, ...without];
    });
  };

  const handleSubmit = async () => {
    const trimmed = draft.trim();
    if (trimmed.length < 1 || trimmed.length > IMPRESSION_MAX_CHARS) return;
    if (submitting) return;
    setSubmitting(true);
    setCooldownSeconds(0);
    setError(null);
    try {
      const res = await fetch("/api/impressions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, content: trimmed, locale }),
      });
      if (!res.ok) {
        setError(t("submitError"));
        return;
      }
      const { impression } = (await res.json()) as { impression: Impression };
      mergeImpression(impression);
      const next: SavedImpression = {
        chainId: impression.rootImpressionId,
        content: impression.content,
        createdAt: impression.createdAt,
      };
      setSaved(next);
      persistSaved(next);
      setDraft("");
      setMode("submitted");
    } catch {
      setError(t("submitError"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async () => {
    if (!saved) return;
    if (cooldownSeconds > 0) return;
    const trimmed = draft.trim();
    if (trimmed.length < 1 || trimmed.length > IMPRESSION_MAX_CHARS) return;
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/impressions/${saved.chainId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });
      if (res.status === 429) {
        const body = (await res.json()) as { remainingSeconds?: number };
        setCooldownSeconds(body.remainingSeconds ?? 0);
        return;
      }
      if (!res.ok) {
        setError(t("submitError"));
        return;
      }
      const { impression } = (await res.json()) as { impression: Impression };
      mergeImpression(impression);
      const next: SavedImpression = {
        chainId: impression.rootImpressionId,
        content: impression.content,
        createdAt: impression.createdAt,
      };
      setSaved(next);
      persistSaved(next);
      setDraft("");
      setMode("submitted");
      setCooldownSeconds(0);
    } catch {
      setError(t("submitError"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReport = async (imp: Impression) => {
    const chainId = imp.rootImpressionId;
    if (reported[chainId]) return;
    setReported((prev) => ({ ...prev, [chainId]: true }));
    localStorage.setItem(`impression-report-${chainId}`, "true");

    const rollback = () => {
      setReported((prev) => {
        const next = { ...prev };
        delete next[chainId];
        return next;
      });
      localStorage.removeItem(`impression-report-${chainId}`);
    };

    try {
      const res = await fetch(`/api/impressions/${chainId}/report`, {
        method: "POST",
      });
      if (!res.ok) {
        rollback();
        return;
      }
      const body = (await res.json()) as { isHidden?: boolean };
      if (body.isHidden) {
        setImpressions((prev) =>
          prev.filter((p) => p.rootImpressionId !== chainId)
        );
      }
    } catch {
      rollback();
    }
  };

  const startEditing = () => {
    if (!saved) return;
    setDraft(saved.content);
    setMode("editing");
    setError(null);
  };

  const cancelEditing = () => {
    setDraft("");
    setMode("submitted");
    setError(null);
  };

  const charCount = draft.length;
  const trimmedLength = draft.trim().length;
  const overLimit = charCount > IMPRESSION_MAX_CHARS;
  const isEmptyTrimmed = trimmedLength < 1;

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-baseline justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          {isOngoing && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
              {et("live")}
            </span>
          )}
        </div>
        <span className="text-xs text-zinc-500">
          {t("count", { count: impressions.length })}
        </span>
      </div>

      {mode === "new" && (
        <div className="mb-4 rounded border border-zinc-200 p-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("placeholder")}
            maxLength={IMPRESSION_MAX_CHARS}
            rows={2}
            className="w-full resize-none rounded border border-zinc-200 p-2 text-sm outline-none focus:border-zinc-400"
          />
          {error && (
            <div className="mt-2 text-xs text-red-600" role="alert">
              {error}
            </div>
          )}
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className={overLimit ? "text-red-600" : "text-zinc-500"}>
              {t("charLimit", { current: charCount })}
            </span>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || isEmptyTrimmed || overLimit}
              className="rounded bg-zinc-900 px-3 py-1 text-white disabled:opacity-40"
            >
              {t("submit")}
            </button>
          </div>
        </div>
      )}

      {mode === "submitted" && saved && (
        <div className="mb-4 rounded border border-zinc-200 bg-zinc-50 p-3">
          <div className="text-xs text-zinc-500">{t("submitted")}</div>
          <div className="mt-1 text-sm">{saved.content}</div>
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={startEditing}
              className="text-xs text-zinc-600 hover:text-zinc-900"
            >
              {t("edit")}
            </button>
          </div>
        </div>
      )}

      {mode === "editing" && saved && (
        <div className="mb-4 rounded border border-zinc-200 p-3">
          <div className="mb-2 text-xs text-zinc-500">{t("editing")}</div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={IMPRESSION_MAX_CHARS}
            rows={2}
            className="w-full resize-none rounded border border-zinc-200 p-2 text-sm outline-none focus:border-zinc-400"
          />
          {cooldownSeconds > 0 && (
            <div className="mt-2 text-xs text-amber-600">
              {t("editCooldown", { seconds: cooldownSeconds })}
            </div>
          )}
          {error && (
            <div className="mt-2 text-xs text-red-600" role="alert">
              {error}
            </div>
          )}
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className={overLimit ? "text-red-600" : "text-zinc-500"}>
              {t("charLimit", { current: charCount })}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={cancelEditing}
                className="rounded border border-zinc-200 px-3 py-1 text-zinc-700"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={handleEdit}
                disabled={submitting || cooldownSeconds > 0 || isEmptyTrimmed || overLimit}
                className="rounded bg-zinc-900 px-3 py-1 text-white disabled:opacity-40"
              >
                {t("submit")}
              </button>
            </div>
          </div>
        </div>
      )}

      {impressions.length === 0 ? (
        <p className="text-sm text-zinc-500">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {impressions.map((imp) => {
            const isOwn = saved?.chainId === imp.rootImpressionId;
            const hasReported = reported[imp.rootImpressionId];
            return (
              <li
                key={imp.id}
                className="rounded border border-zinc-100 bg-white p-3 text-sm"
              >
                <div className="whitespace-pre-wrap">{imp.content}</div>
                <div className="mt-1 flex items-center justify-between text-xs text-zinc-400">
                  <span>{formatDate(imp.createdAt, locale)}</span>
                  {!isOwn && (
                    <button
                      type="button"
                      onClick={() => handleReport(imp)}
                      disabled={!!hasReported}
                      className="text-zinc-400 hover:text-red-600 disabled:opacity-40"
                    >
                      {hasReported ? t("reported") : t("report")}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
