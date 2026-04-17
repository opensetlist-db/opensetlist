"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { formatDate } from "@/lib/utils";
import { IMPRESSION_MAX_CHARS } from "@/lib/config";

export interface Impression {
  id: string;
  eventId: string;
  content: string;
  locale: string;
  createdAt: string;
  updatedAt: string;
}

interface SavedImpression {
  id: string;
  content: string;
  updatedAt: string;
}

interface Props {
  eventId: string;
  initialImpressions: Impression[];
}

export function EventImpressions({ eventId, initialImpressions }: Props) {
  const t = useTranslations("Impression");
  const locale = useLocale();
  const [impressions, setImpressions] = useState<Impression[]>(initialImpressions);
  const [saved, setSaved] = useState<SavedImpression | null>(null);
  const [mode, setMode] = useState<"new" | "submitted" | "editing">("new");
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [reported, setReported] = useState<Record<string, boolean>>({});

  const savedKey = `impression-${eventId}`;

  useEffect(() => {
    const raw = localStorage.getItem(savedKey);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as SavedImpression;
        if (parsed?.id && parsed.content) {
          setSaved(parsed);
          setMode("submitted");
        }
      } catch {
        // ignore corrupt data
      }
    }
  }, [savedKey]);

  useEffect(() => {
    const map: Record<string, boolean> = {};
    for (const imp of impressions) {
      if (localStorage.getItem(`impression-report-${imp.id}`) === "true") {
        map[imp.id] = true;
      }
    }
    setReported(map);
  }, [impressions]);

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

  const mergeImpression = (imp: Impression) => {
    setImpressions((prev) => {
      const without = prev.filter((p) => p.id !== imp.id);
      return [imp, ...without];
    });
  };

  const handleSubmit = async () => {
    const trimmed = draft.trim();
    if (trimmed.length < 1 || trimmed.length > IMPRESSION_MAX_CHARS) return;
    if (submitting) return;
    setSubmitting(true);
    setCooldownSeconds(0);
    try {
      const res = await fetch("/api/impressions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, content: trimmed, locale }),
      });
      if (!res.ok) return;
      const { impression } = (await res.json()) as { impression: Impression };
      mergeImpression(impression);
      const next: SavedImpression = {
        id: impression.id,
        content: impression.content,
        updatedAt: impression.updatedAt,
      };
      setSaved(next);
      persistSaved(next);
      setDraft("");
      setMode("submitted");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async () => {
    if (!saved) return;
    const trimmed = draft.trim();
    if (trimmed.length < 1 || trimmed.length > IMPRESSION_MAX_CHARS) return;
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/impressions/${saved.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });
      if (res.status === 429) {
        const body = (await res.json()) as { remainingSeconds?: number };
        setCooldownSeconds(body.remainingSeconds ?? 0);
        return;
      }
      if (!res.ok) return;
      const { impression } = (await res.json()) as { impression: Impression };
      mergeImpression(impression);
      const next: SavedImpression = {
        id: impression.id,
        content: impression.content,
        updatedAt: impression.updatedAt,
      };
      setSaved(next);
      persistSaved(next);
      setDraft("");
      setMode("submitted");
      setCooldownSeconds(0);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReport = async (impressionId: string) => {
    if (reported[impressionId]) return;
    try {
      const res = await fetch(`/api/impressions/${impressionId}/report`, {
        method: "POST",
      });
      if (!res.ok) return;
      const body = (await res.json()) as { isHidden?: boolean };
      localStorage.setItem(`impression-report-${impressionId}`, "true");
      setReported((prev) => ({ ...prev, [impressionId]: true }));
      if (body.isHidden) {
        setImpressions((prev) => prev.filter((p) => p.id !== impressionId));
      }
    } catch {
      // ignore network error
    }
  };

  const startEditing = () => {
    if (!saved) return;
    setDraft(saved.content);
    setMode("editing");
    setCooldownSeconds(0);
  };

  const cancelEditing = () => {
    setDraft("");
    setMode("submitted");
    setCooldownSeconds(0);
  };

  const charCount = draft.length;
  const overLimit = charCount > IMPRESSION_MAX_CHARS;

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
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
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className={overLimit ? "text-red-600" : "text-zinc-500"}>
              {t("charLimit", { current: charCount })}
            </span>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || charCount < 1 || overLimit}
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
                disabled={submitting || charCount < 1 || overLimit}
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
            const isOwn = saved?.id === imp.id;
            const hasReported = reported[imp.id];
            return (
              <li
                key={imp.id}
                className="rounded border border-zinc-100 bg-white p-3 text-sm"
              >
                <div className="whitespace-pre-wrap">{imp.content}</div>
                <div className="mt-1 flex items-center justify-between text-xs text-zinc-400">
                  <span>{formatDate(imp.updatedAt, locale)}</span>
                  {!isOwn && (
                    <button
                      type="button"
                      onClick={() => handleReport(imp.id)}
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
