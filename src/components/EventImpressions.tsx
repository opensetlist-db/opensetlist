"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
import { IMPRESSION_MAX_CHARS } from "@/lib/config";
import { getEditCooldownRemaining } from "@/lib/impression";
import { useImpressionPolling } from "@/hooks/useImpressionPolling";
import { trackEvent } from "@/lib/analytics";
import { getAnonId } from "@/lib/anonId";
import { useMounted } from "@/hooks/useMounted";
import { ImpressionCell } from "./ImpressionCell";
import { borderWidth, colors, motion, radius, shadows } from "@/styles/tokens";

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

// Pure read — no side effects (no localStorage.removeItem on parse failure).
// Corrupt entries get overwritten on the next valid persist; leaving them
// alone keeps this safe to call during render.
function readSavedFromStorage(key: string): SavedImpression | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedImpression;
    if (!parsed?.chainId || !parsed.content) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Pure read with try/catch — `localStorage.getItem` can throw SecurityError
// in some browsers (storage blocked, third-party-context restrictions, quota
// disabled, etc.). Falls back to false on any failure so the report-flag
// scan in `reportedChainIds` can't take down the whole impressions section.
function readReportFlag(rootImpressionId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      localStorage.getItem(`impression-report-${rootImpressionId}`) === "true"
    );
  } catch {
    return false;
  }
}

// Same defensive wrapper around the WRITE path. setItem/removeItem can also
// throw (quota exceeded, storage blocked, etc.) — failing silently keeps
// the report click from surfacing an exception to the user. The optimistic
// state update + server POST still proceed; only the cross-session cache
// write is lost in the failure case.
function writeReportFlag(rootImpressionId: string, reported: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (reported) {
      localStorage.setItem(`impression-report-${rootImpressionId}`, "true");
    } else {
      localStorage.removeItem(`impression-report-${rootImpressionId}`);
    }
  } catch {
    // Storage-blocked browser — best-effort.
  }
}

function initialCooldownFor(saved: SavedImpression | null): number {
  if (!saved?.createdAt) return 0;
  const sinceDate = new Date(saved.createdAt);
  if (Number.isNaN(sinceDate.getTime())) return 0;
  return Math.max(0, getEditCooldownRemaining(sinceDate, new Date()));
}

export function EventImpressions({
  eventId,
  initialImpressions,
  isOngoing,
}: Props) {
  const t = useTranslations("Impression");
  const et = useTranslations("Event");
  const locale = useLocale();
  const mounted = useMounted();
  const [impressions, setImpressions] = useState<Impression[]>(initialImpressions);

  // Polling hook drives `impressions` directly via the onUpdate callback —
  // no effect-based sync from the hook's return value. Held in a ref by
  // useImpressionPolling so a fresh `setImpressions` identity each render
  // doesn't tear down the polling timer.
  useImpressionPolling({
    eventId,
    enabled: isOngoing,
    onUpdate: setImpressions,
  });

  const savedKey = `impression-${eventId}`;
  // SSR + client first render start at empty values so hydration matches
  // server HTML (which has no localStorage access). The
  // `mounted && hydratedKey !== savedKey` block below pulls the real
  // localStorage value on the first commit AFTER mount.
  const [saved, setSaved] = useState<SavedImpression | null>(null);
  const [mode, setMode] = useState<"new" | "submitted" | "editing">("new");
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Keyed by rootImpressionId so a chain can't be reported twice across
  // edits. Holds *user-action* report writes only — pre-existing reports
  // from localStorage are merged into `reportedChainIds` below after
  // mount; no separate state sync needed.
  const [reported, setReported] = useState<Record<string, boolean>>({});

  // Reset + hydrate (or re-hydrate when navigating between events). The
  // useState-pair "track previous prop" idiom (React docs: "Storing
  // information from previous renders") avoids both
  // react-hooks/set-state-in-effect and react-hooks/refs. Gated on
  // `mounted` so the first paint matches server-rendered HTML — no
  // hydration mismatch from localStorage reads.
  const [hydratedSavedKey, setHydratedSavedKey] = useState<string | null>(null);
  if (mounted && hydratedSavedKey !== savedKey) {
    setHydratedSavedKey(savedKey);
    // Do NOT reseed `impressions` here — clobbers polled data if the first poll lands before `mounted` flips.
    setReported({});
    const next = readSavedFromStorage(savedKey);
    setSaved(next);
    setMode(next ? "submitted" : "new");
    setDraft("");
    setCooldownSeconds(initialCooldownFor(next));
    setError(null);
  }

  // Derived reported-set: union of user-action writes (`reported`) and
  // the localStorage-backed reports for impressions currently in view.
  // Gated on `mounted` so the SSR + client-first-render result matches
  // (server has no localStorage). The actual report-state badges flip on
  // the first commit after mount.
  const reportedChainIds = useMemo<Set<string>>(() => {
    const set = new Set<string>(
      Object.keys(reported).filter((k) => reported[k])
    );
    if (!mounted) return set;
    for (const imp of impressions) {
      if (set.has(imp.rootImpressionId)) continue;
      if (readReportFlag(imp.rootImpressionId)) {
        set.add(imp.rootImpressionId);
      }
    }
    return set;
  }, [impressions, reported, mounted]);

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
        body: JSON.stringify({
          eventId,
          content: trimmed,
          locale,
          anonId: getAnonId(),
        }),
      });
      if (!res.ok) {
        setError(t("submitError"));
        return;
      }
      const { impression } = (await res.json()) as { impression: Impression };
      mergeImpression(impression);
      trackEvent("impression_submit", {
        event_id: String(eventId),
        locale,
      });
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
        body: JSON.stringify({ content: trimmed, anonId: getAnonId() }),
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
      trackEvent("impression_edit", { event_id: String(eventId) });
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
    if (reportedChainIds.has(chainId)) return;
    setReported((prev) => ({ ...prev, [chainId]: true }));
    writeReportFlag(chainId, true);

    const rollback = () => {
      setReported((prev) => {
        const next = { ...prev };
        delete next[chainId];
        return next;
      });
      writeReportFlag(chainId, false);
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

  // Card / chrome styles centralized so the JSX stays readable. The
  // my-impression cards (submitted / editing modes) use the primary-tinted
  // palette per handoff §3-6 to visually mark them as the user's own;
  // the new-impression input + others-list rows use neutral chrome.
  const myImpressionCardStyle: React.CSSProperties = {
    background: colors.primaryBg,
    border: `${borderWidth.emphasis} solid ${colors.primaryBorder}`,
    borderRadius: radius.card,
  };
  const neutralCardStyle: React.CSSProperties = {
    background: colors.bgCard,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.card,
  };
  const otherCardStyle: React.CSSProperties = {
    background: colors.bgCard,
    border: `1px solid ${colors.borderLight}`,
    borderRadius: radius.card,
  };
  const textareaStyle: React.CSSProperties = {
    border: `1px solid ${colors.border}`,
    borderRadius: radius.tag,
    background: colors.bgCard,
  };

  return (
    <section
      className="mt-10"
      style={{
        background: colors.bgCard,
        borderRadius: radius.card,
        boxShadow: shadows.card,
        overflow: "hidden",
      }}
    >
      {/* Card header — title + count + optional LIVE pill. Bottom
          border separates it from the impressions body, matching
          the mockup `event-page-desktop-mockup-v2.jsx:695-702`. */}
      <div
        className="flex items-baseline justify-between gap-2"
        style={{
          padding: "16px 20px 12px",
          borderBottom: `1px solid ${colors.borderLight}`,
        }}
      >
        <div className="flex items-center gap-2">
          <h2
            // Locale-safe uppercase — CJK characters ("한줄감상",
            // "ひとこと") render unchanged; English ("Impressions")
            // gets the all-caps treatment per operator preference.
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: colors.textPrimary,
              textTransform: "uppercase",
              margin: 0,
            }}
          >
            {t("title")}
          </h2>
          {isOngoing && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
              style={{
                background: colors.liveBg,
                color: colors.live,
                border: `1px solid ${colors.liveBorder}`,
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background: colors.live,
                  animation: motion.livePulse,
                }}
              />
              {et("live")}
            </span>
          )}
        </div>
        <span className="text-xs" style={{ color: colors.textMuted }}>
          {t("count", { count: impressions.length })}
        </span>
      </div>

      {/*
        Mobile: vertical stack (my-impression block above the list).
        Desktop (lg): 2-col grid `[my-impression | list]` per handoff §3-6.
        Grid's natural single-col on mobile means no extra layout branching.
      */}
      <div
        className="lg:grid lg:grid-cols-2 lg:items-start"
        style={{ padding: "16px 20px", gap: 24 }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: colors.textMuted,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            {t("myLabel")}
          </div>
          {mode === "new" && (
            <div className="mb-4 p-3" style={neutralCardStyle}>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t("placeholder")}
                rows={2}
                className="w-full resize-none p-2 text-sm outline-none"
                style={textareaStyle}
              />
              {error && (
                <div
                  className="mt-2 text-xs"
                  role="alert"
                  style={{ color: colors.error }}
                >
                  {error}
                </div>
              )}
              <div className="mt-2 flex items-center justify-between text-xs">
                <span
                  style={{
                    color: overLimit ? colors.error : colors.textSecondary,
                  }}
                >
                  {t("charLimit", { current: charCount })}
                </span>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting || isEmptyTrimmed || overLimit}
                  className="rounded px-3 py-1 text-white disabled:opacity-40"
                  style={{ background: colors.primary }}
                >
                  {t("submit")}
                </button>
              </div>
            </div>
          )}

          {mode === "submitted" && saved && (
            <div className="mb-4 p-3" style={myImpressionCardStyle}>
              <div
                className="text-sm"
                style={{
                  color: colors.textPrimary,
                  // `break-words` so a single-token-long impression
                  // can't overflow the card horizontally on narrow
                  // viewports. `whitespace-pre-wrap` preserves the
                  // user's manual line breaks.
                  overflowWrap: "break-word",
                  whiteSpace: "pre-wrap",
                }}
              >
                {saved.content}
              </div>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={startEditing}
                  className="text-xs hover:underline"
                  style={{ color: colors.primary }}
                >
                  {t("edit")}
                </button>
              </div>
            </div>
          )}

          {mode === "editing" && saved && (
            <div className="mb-4 p-3" style={myImpressionCardStyle}>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                className="w-full resize-none p-2 text-sm outline-none"
                style={textareaStyle}
              />
              {cooldownSeconds > 0 && (
                <div
                  className="mt-2 text-xs"
                  style={{ color: colors.warning }}
                >
                  {t("editCooldown", { seconds: cooldownSeconds })}
                </div>
              )}
              {error && (
                <div
                  className="mt-2 text-xs"
                  role="alert"
                  style={{ color: colors.error }}
                >
                  {error}
                </div>
              )}
              <div className="mt-2 flex items-center justify-between text-xs">
                <span
                  style={{
                    color: overLimit ? colors.error : colors.textSecondary,
                  }}
                >
                  {t("charLimit", { current: charCount })}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={cancelEditing}
                    className="rounded px-3 py-1"
                    style={{
                      border: `1px solid ${colors.border}`,
                      color: colors.textSecondary,
                      background: colors.bgCard,
                    }}
                  >
                    {t("cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={handleEdit}
                    disabled={submitting || cooldownSeconds > 0 || isEmptyTrimmed || overLimit}
                    className="rounded px-3 py-1 text-white disabled:opacity-40"
                    style={{ background: colors.primary }}
                  >
                    {t("submit")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: colors.textMuted,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            {t("allLabel")}
          </div>
          {impressions.length === 0 ? (
            <p className="text-sm" style={{ color: colors.textSecondary }}>
              {t("empty")}
            </p>
          ) : (
            <ul className="space-y-2">
              {impressions.map((imp) => {
                const isOwn = saved?.chainId === imp.rootImpressionId;
                const hasReported = reportedChainIds.has(imp.rootImpressionId);
                return (
                  <li
                    key={imp.id}
                    className="p-3 text-sm"
                    style={otherCardStyle}
                  >
                    <ImpressionCell
                      impression={imp}
                      eventId={eventId}
                      isOwn={isOwn}
                      hasReported={hasReported}
                      onReport={handleReport}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
