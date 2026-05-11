"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import { IMPRESSION_MAX_CHARS } from "@/lib/config";
import { getEditCooldownRemaining } from "@/lib/impression";
import { useImpressionPolling } from "@/hooks/useImpressionPolling";
import { useRealtimeImpressions } from "@/hooks/useRealtimeImpressions";
import { trackEvent } from "@/lib/analytics";
import { getAnonId } from "@/lib/anonId";
import { useMounted } from "@/hooks/useMounted";
import { ImpressionCell } from "./ImpressionCell";
import { borderWidth, colors, motion, radius, shadows } from "@/styles/tokens";
// Type lives in `src/lib/types/impression.ts` so hooks under
// `src/hooks/` can describe impressions without importing from
// `src/components/` (which would create a circular dependency with
// hooks this component imports). Re-exported for back-compat with
// existing `import { Impression } from "@/components/EventImpressions"`
// sites elsewhere — useImpressionPolling, useRealtimeImpressions,
// and ImpressionCell currently rely on this re-export.
import type { Impression } from "@/lib/types/impression";

export type { Impression };

/**
 * Merge a fresh page of impressions into the accumulated list,
 * deduping by id and re-sorting newest-first. Used in two paths:
 *
 *   1. Polling tick — `incoming` is the newest page (no cursor).
 *      Items the user has already loaded into older pages stay put;
 *      genuinely new impressions slide in at the top.
 *   2. "Load more" click — `incoming` is the next older page (cursor
 *      = oldest currently loaded item). Strictly disjoint from the
 *      existing list under normal flow, but the dedupe protects
 *      against any race where polling and pagination overlap on a
 *      boundary item.
 *
 * Sort: createdAt desc, id desc as tiebreaker — must match the
 * server's ORDER BY in `/api/impressions` so cursor-based pagination
 * advances strictly forward.
 */
function mergeImpressions(
  prev: Impression[],
  incoming: Impression[],
): Impression[] {
  const incomingIds = new Set(incoming.map((i) => i.id));
  const kept = prev.filter((p) => !incomingIds.has(p.id));
  const merged = [...incoming, ...kept];
  merged.sort((a, b) => {
    if (a.createdAt !== b.createdAt) {
      return a.createdAt < b.createdAt ? 1 : -1;
    }
    return a.id < b.id ? 1 : -1;
  });
  return merged;
}

/**
 * Chain-aware merge: replace any existing row whose `rootImpressionId`
 * matches the incoming row's, then prepend the incoming row. Used for
 * single-row updates where dedup must collapse a *chain* of supersede
 * versions into one visible row, not just dedupe by `id`.
 *
 * Why this differs from `mergeImpressions` (id-based): when a user
 * edits an impression, the new row has a *new* `id` but the *same*
 * `rootImpressionId`. Id-based dedupe would leave both the old and
 * new versions in the list. Chain-based dedupe correctly collapses
 * to the latest version.
 *
 * Used by both:
 *   - own-action POST handlers (handleSubmit, handleEdit) where the
 *     server response is the new chain head and we want it to replace
 *     any prior version of the same chain in the list,
 *   - the realtime onUpsert callback for the same reason.
 *
 * Pure / non-mutating; safe inside a `setImpressions(prev => ...)`
 * updater.
 */
function mergeImpressionByChain(
  prev: Impression[],
  imp: Impression,
): Impression[] {
  const without = prev.filter(
    (p) => p.rootImpressionId !== imp.rootImpressionId,
  );
  return [imp, ...without];
}

interface SavedImpression {
  chainId: string;
  content: string;
  createdAt: string;
}

interface Props {
  eventId: string;
  initialImpressions: Impression[];
  /**
   * Cursor for the next OLDER page than what's in `initialImpressions`.
   * Null when SSR returned the entire archive (event has fewer than
   * `IMPRESSION_PAGE_SIZE` impressions). The "see older" button only
   * renders when this is non-null AND there are remaining impressions
   * to load. Polling does NOT update this — it tracks the user's
   * pagination position in the older half, independent of polling's
   * view of the newest page.
   */
  initialNextCursor: string | null;
  /**
   * Total impression count for the event at SSR time. Refreshed by
   * each polling tick AND each load-more response so the "see older
   * (X more)" button stays accurate as new impressions arrive.
   */
  initialTotalCount: number;
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
  initialNextCursor,
  initialTotalCount,
  isOngoing,
}: Props) {
  const t = useTranslations("Impression");
  const et = useTranslations("Event");
  const locale = useLocale();
  const mounted = useMounted();
  const [impressions, setImpressions] =
    useState<Impression[]>(initialImpressions);
  // Latest-state ref kept in lockstep with `impressions` by routing
  // every mutation through `applyImpressionsUpdate` below — never
  // by the post-render `useEffect` sync the previous iteration of
  // this fix used, which left a one-render stale window between
  // commit and effect run that a rapid-fire realtime onRemove could
  // race against (CR feedback on PR #326).
  //
  // Why a ref at all: the realtime `onUpsert`/`onRemove` callbacks
  // need to decide whether to bump `totalCount` based on whether
  // the chain / id was previously in the list. React 18's
  // `setState(updater)` defers the updater to reconciliation, so
  // the closure-capture pattern (`let isNewChain = false;
  // setImpressions((prev) => { isNewChain = ...; return ... });
  // if (isNewChain) ...`) reads `false` before the updater runs —
  // `setTotalCount` would never fire. The helper below calls the
  // updater SYNCHRONOUSLY (eagerly, not via React's queue), so the
  // captured flag is set before the post-call `if`-check, AND the
  // ref is updated in the same synchronous moment, so concurrent
  // callbacks within the same task see the latest value with no
  // race window.
  const impressionsRef = useRef<Impression[]>(initialImpressions);
  // Pagination state — tracks the user's position in the older half.
  // Polling does NOT touch these; they advance only on a successful
  // "see older" click (server response sets `loadMoreCursor` to the
  // next page's cursor, or null when the archive is fully loaded).
  const [loadMoreCursor, setLoadMoreCursor] = useState<string | null>(
    initialNextCursor,
  );
  const [totalCount, setTotalCount] = useState<number>(initialTotalCount);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  // Synchronous-ref-update helper. ALL impressions mutations route
  // through this — the realtime callbacks rely on the ref reflecting
  // the latest value the instant the previous mutation returns, so
  // direct `setImpressions(updater)` calls (where the updater is
  // queued and run later by React) would let the ref drift relative
  // to React state and re-introduce the totalCount-sync race CR
  // flagged on PR #326.
  //
  // The helper calls `updater(prev)` eagerly against
  // `impressionsRef.current`, writes the result back to the ref,
  // then forwards to `setImpressions` in VALUE form (not updater
  // form). The value form means React doesn't re-run our updater
  // during reconciliation — we've already run it once here, and
  // the ref already holds the truth. Strict mode is safe because
  // every merge function in this file (`mergeImpressions`,
  // `mergeImpressionByChain`, the filter-by-id) is idempotent.
  //
  // The contract: NO call site in this component is allowed to
  // call `setImpressions` directly — they must all go through
  // `applyImpressionsUpdate`. A future refactor that violates this
  // would let the ref drift; the closure-capture flag reads inside
  // `onUpsert`/`onRemove` would silently miss bumps. The lint
  // rule that would enforce this is too niche to ship; treat the
  // helper as the single mutator and the ref as its receipt.
  const applyImpressionsUpdate = useCallback(
    (updater: (prev: Impression[]) => Impression[]) => {
      const next = updater(impressionsRef.current);
      impressionsRef.current = next;
      setImpressions(next);
    },
    [],
  );

  // Realtime per-row push via supabase_realtime publication (see
  // prisma/post-deploy.sql). onUpsert handles INSERT visible AND
  // UPDATE-still-visible (mergeImpression dedupes by chain id);
  // onRemove handles UPDATE-now-hidden (supersededAt set, or
  // isDeleted/isHidden flipped) and rare hard DELETEs. The supersede
  // edit flow produces an onUpsert(new id) + onRemove(old id) pair;
  // mergeImpression's chain-level dedupe makes the order irrelevant.
  // No suppression window needed: own-action POST handlers
  // synchronously merge the response, so the matching push is a
  // no-op replace (id already in the list at that rootImpressionId).
  //
  // useImpressionPolling stays alive below as the in-hook R3
  // fallback path that takes over on `realtime.pollFallback` (set
  // by useRealtimeImpressions on CHANNEL_ERROR / TIMED_OUT).
  // Pre-v0.11.0, this site branched between polling and realtime
  // via LAUNCH_FLAGS.realtimeEnabled; the activation deleted the
  // flag-on/off branch and demoted polling to the fallback role.
  const realtime = useRealtimeImpressions({
    eventId,
    enabled: isOngoing,
    onUpsert: (impression) => {
      // Chain-aware dedup AND totalCount sync. Two cases collapse:
      //   - INSERT for a brand-new chain (rootImpressionId not yet
      //     in the list) → grow the visible list AND increment
      //     totalCount so the "see older (X more)" math reflects
      //     reality.
      //   - INSERT for a supersede (rootImpressionId already in the
      //     list) → replace the prior version in place; totalCount
      //     stays the same because the server-side count() filter
      //     (supersededAt IS NULL) counts one chain head, not one
      //     per row in the chain.
      // `isNewChain` is captured from inside the
      // `applyImpressionsUpdate` updater, which runs SYNCHRONOUSLY
      // (the helper calls `updater(impressionsRef.current)` eagerly,
      // not via React's deferred setState queue). So the post-call
      // `if (isNewChain)` check sees the value set by the updater
      // run that just completed. For concurrent calls within the
      // same task (two rapid-fire pushes), the ref is updated
      // synchronously inside the helper between calls, so the
      // second push's updater sees the first's result — no
      // off-by-one.
      let isNewChain = false;
      applyImpressionsUpdate((prev) => {
        isNewChain = !prev.some(
          (p) => p.rootImpressionId === impression.rootImpressionId,
        );
        return mergeImpressionByChain(prev, impression);
      });
      if (isNewChain) {
        setTotalCount((c) => c + 1);
      }
    },
    onRemove: (id) => {
      // Mirror onUpsert's totalCount tracking. Three cases reach
      // here, only one of which should decrement:
      //   - UPDATE that flips a previously-visible row to hidden
      //     via supersededAt set (during an edit) → the matching
      //     INSERT for the new row already replaced this id in the
      //     list via onUpsert, so `wasPresent` is false, no-op.
      //   - UPDATE that flips a previously-visible row to hidden
      //     via isHidden / isDeleted (report flow, soft delete) →
      //     row was in the list, removed → decrement.
      //   - Hard DELETE (rare) → same as the hidden case.
      // Same eager-updater + closure-capture pattern as `onUpsert`
      // above — `applyImpressionsUpdate` calls the updater
      // synchronously, so `wasPresent` is set before the post-call
      // `if` check runs (CR feedback on PR #326).
      let wasPresent = false;
      applyImpressionsUpdate((prev) => {
        wasPresent = prev.some((p) => p.id === id);
        return prev.filter((p) => p.id !== id);
      });
      if (wasPresent) {
        setTotalCount((c) => Math.max(0, c - 1));
      }
    },
  });
  // R3 polling fallback. Always called (rules-of-hooks); enabled
  // ONLY when realtime fell back via CHANNEL_ERROR / TIMED_OUT
  // (channel exhausted its retry budget — useImpressionPolling
  // takes over without the user noticing). During the brief overlap
  // window as fallback flips, both the realtime callbacks above and
  // this polling onUpdate may fire against the same `impressions`
  // state — `mergeImpressions` (id-dedupe) and `mergeImpressionByChain`
  // (rootId-dedupe) are both idempotent so duplicate work is
  // harmless.
  useImpressionPolling({
    eventId,
    enabled: isOngoing && realtime.pollFallback,
    onUpdate: ({ impressions: polled }) => {
      applyImpressionsUpdate((prev) => mergeImpressions(prev, polled));
    },
  });

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !loadMoreCursor) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      // `&includeTotal=1` opts into the event-wide count() query.
      // Polling skips that flag; load-more clicks set it so the
      // header total + "X more" button refresh on each click.
      // Drift between clicks (other users posting / reports
      // hiding) is acceptable — totalCount is a UX hint, not a
      // critical value.
      const url = `/api/impressions?eventId=${encodeURIComponent(eventId)}&before=${encodeURIComponent(loadMoreCursor)}&includeTotal=1`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        setLoadMoreError(t("loadMoreError"));
        return;
      }
      const data = (await res.json()) as {
        impressions: Impression[];
        nextCursor: string | null;
        totalCount?: number;
      };
      applyImpressionsUpdate((prev) => mergeImpressions(prev, data.impressions));
      setLoadMoreCursor(data.nextCursor);
      if (data.totalCount !== undefined) {
        setTotalCount(data.totalCount);
      }
    } catch {
      setLoadMoreError(t("loadMoreError"));
    } finally {
      setLoadingMore(false);
    }
  }, [eventId, loadingMore, loadMoreCursor, t, applyImpressionsUpdate]);

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
  // remain in the visible list. Delegates to the top-level
  // `mergeImpressionByChain` helper, which the realtime onUpsert
  // callback also uses.
  const mergeImpression = (imp: Impression) => {
    applyImpressionsUpdate((prev) => mergeImpressionByChain(prev, imp));
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
      // New chain — bump the displayed total immediately for snappy
      // UX. The next polling tick will replace this with the
      // server's authoritative count, but until then the header +
      // "X more" button stay in sync with what the user just did.
      setTotalCount((c) => c + 1);
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
        applyImpressionsUpdate((prev) =>
          prev.filter((p) => p.rootImpressionId !== chainId)
        );
        // Mirror the impression-removal in the displayed total —
        // the server's count query (`isHidden: false`) just dropped
        // by 1, so the next polling tick will return the new total
        // anyway, but updating immediately keeps the "X more"
        // button consistent with the visible list.
        setTotalCount((c) => Math.max(0, c - 1));
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
        {/* Header count uses `totalCount` (the server-side total), not
            `impressions.length` (the LOADED count). Otherwise the
            header would say "200 impressions" while the "see older"
            button below says "1,034 more" — confusing and dishonest.
            Both surfaces now pull from the same authoritative number,
            refreshed on every polling tick + load-more response. */}
        <span className="text-xs" style={{ color: colors.textMuted }}>
          {t("count", { count: totalCount })}
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
            <>
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
              {/* "See older" button — renders only when there's a
                  cursor for the next older page AND the displayed
                  total exceeds what's loaded. The double check
                  guards against an edge case where a polling refresh
                  drops `totalCount` below `impressions.length` (e.g.
                  several reports cause hidden flips concurrently)
                  but `loadMoreCursor` lags one cycle. Hiding the
                  button under that condition is the conservative
                  choice — better than a click that returns zero
                  rows. */}
              {loadMoreCursor !== null &&
                totalCount > impressions.length && (
                  <div className="mt-3 flex flex-col items-center gap-1">
                    <button
                      type="button"
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                      className="rounded px-3 py-1.5 text-xs hover:underline disabled:opacity-50"
                      style={{
                        border: `1px solid ${colors.border}`,
                        background: colors.bgCard,
                        color: colors.textSecondary,
                      }}
                    >
                      {loadingMore
                        ? t("loadMoreLoading")
                        : t("loadMore", {
                            remaining: totalCount - impressions.length,
                          })}
                    </button>
                    {loadMoreError && (
                      <span
                        className="text-xs"
                        role="alert"
                        style={{ color: colors.error }}
                      >
                        {loadMoreError}
                      </span>
                    )}
                  </div>
                )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
