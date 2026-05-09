"use client";

import { useCallback, useEffect, useRef, useState } from "react";
// Type lives in `src/lib/types/setlist.ts` so pure helpers under
// `src/lib/` can use it without crossing the lib→hooks layer
// boundary. Re-exported below for back-compat with existing
// `import { ReactionCountsMap } from "@/hooks/useSetlistPolling"`.
import type { FanTop3Entry, ReactionCountsMap } from "@/lib/types/setlist";
import type { ResolvedEventStatus } from "@/lib/eventStatus";

export type { ReactionCountsMap };

interface UseSetlistPollingOptions<T> {
  eventId: string;
  initialItems: T[];
  initialReactionCounts: ReactionCountsMap;
  initialTop3Wishes: FanTop3Entry[];
  // Display locale, threaded into the polling URL so the route can
  // trim per-song translation joins to `[locale, "ja"]` for the
  // wishlist fan TOP-3 payload. Other polling slices (items,
  // reactionCounts) are locale-independent.
  locale: string;
  enabled: boolean;
  intervalMs?: number;
}

interface UseSetlistPollingResult<T> {
  items: T[];
  reactionCounts: ReactionCountsMap;
  top3Wishes: FanTop3Entry[];
  /**
   * Server-resolved event status, refreshed on every poll. Null
   * until the first successful poll lands (callers fall back to
   * their SSR-initial status). Drives the wishlist + predicted-
   * setlist client lock as the server-authoritative override of
   * the client wall-clock check — handles the slow-client-clock
   * bypass case that the client-side `Date.now() >= startMs`
   * derivation can't catch on its own.
   */
  status: ResolvedEventStatus | null;
  lastUpdated: string | null;
}

export function useSetlistPolling<T>({
  eventId,
  initialItems,
  initialReactionCounts,
  initialTop3Wishes,
  locale,
  enabled,
  intervalMs = 5000,
}: UseSetlistPollingOptions<T>): UseSetlistPollingResult<T> {
  const [items, setItems] = useState<T[]>(initialItems);
  const [reactionCounts, setReactionCounts] =
    useState<ReactionCountsMap>(initialReactionCounts);
  const [top3Wishes, setTop3Wishes] =
    useState<FanTop3Entry[]>(initialTop3Wishes);
  const [status, setStatus] = useState<ResolvedEventStatus | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // AbortController for the currently in-flight fetch. Cancelled
  // when (a) a newer fetchSetlist invocation supersedes it, or
  // (b) the polling effect is torn down (eventId/locale change,
  // unmount). The signal is also re-checked after each `await` so
  // a fetch that resolves in the same microtask as the abort fires
  // bails before writing setState. CR #297 round 2 — the earlier
  // generation-counter approach was racy: the cleanup-time seq
  // bump fires AFTER render commit, so a fetch resolving in the
  // commit→cleanup gap could still pass the seq check and clobber
  // the freshly-seeded new-event state. AbortController + post-
  // await `signal.aborted` checks close that window because the
  // signal mutates synchronously when abort() fires.
  const abortRef = useRef<AbortController | null>(null);

  // Re-sync from props only when eventId actually changes — not on every
  // parent re-render. Without this guard, callers passing fresh array refs
  // (like LiveSetlist) would re-trigger setState on every paint and thrash
  // the polling state. The useState-pair "track previous prop" idiom
  // (React docs: "Storing information from previous renders") avoids
  // both react-hooks/set-state-in-effect AND react-hooks/refs.
  //
  // Trade-off: if a caller updates initialItems / initialReactionCounts
  // WITHOUT changing eventId (e.g., a future router.refresh delivering a
  // fresh SSR seed for the same event), the hook keeps the prior state.
  // Acceptable for Phase 1A — the seed only changes when eventId changes
  // (page navigation forces a remount with new useState initial values).
  // Revisit by accepting an explicit `seedVersion` prop if a router.refresh
  // path ever delivers fresh seed for the same event.
  const [prevEventId, setPrevEventId] = useState(eventId);
  if (prevEventId !== eventId) {
    setPrevEventId(eventId);
    setItems(initialItems);
    setReactionCounts(initialReactionCounts);
    setTop3Wishes(initialTop3Wishes);
    setStatus(null);
    setLastUpdated(null);
    // The in-flight fetch (if any) is aborted in the polling
    // useEffect's cleanup below — that's the safe place to mutate
    // the ref. The post-await `signal.aborted` checks inside
    // fetchSetlist provide the synchronous catch for any fetch
    // that resolves between commit and cleanup.
  }

  const fetchSetlist = useCallback(async () => {
    // Abort any prior in-flight fetch from this same eventId/locale
    // cycle (poll N still in flight when poll N+1 starts). Without
    // this, a slow fetch could land AFTER a faster newer fetch and
    // clobber the newer state.
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(
        `/api/setlist?eventId=${encodeURIComponent(eventId)}&locale=${encodeURIComponent(locale)}`,
        { cache: "no-store", signal: controller.signal },
      );
      // Post-await aborted check: the network response may have
      // arrived just as eventId/locale changed and the cleanup
      // fired abort(). Bail before parsing + writing setState.
      if (controller.signal.aborted) return;
      if (!res.ok) return;
      const data = (await res.json()) as {
        items: T[];
        reactionCounts?: ReactionCountsMap;
        top3Wishes?: FanTop3Entry[];
        status?: ResolvedEventStatus | null;
        updatedAt: string;
      };
      // Second post-await check: json parse may have resolved in
      // the same window as a deferred abort. Cheap belt-and-braces.
      if (controller.signal.aborted) return;
      setItems(data.items);
      setReactionCounts(data.reactionCounts ?? {});
      // `?? []` when a polled response omits `top3Wishes` (older API
      // shape, transient server bug, etc.) — reset to empty so the
      // initial seed doesn't persist stale data indefinitely once
      // polling is the authoritative source. Asserted by
      // useSetlistPolling.test.tsx "falls back to []" case.
      setTop3Wishes(data.top3Wishes ?? []);
      // Only update `status` when the field is actually present in
      // the response. The earlier `data.status ?? null` would CLEAR
      // a valid prior status whenever the server omits the field
      // (forward-compat shape, transient response gap, partial
      // hot-path response) — and because `status` drives the
      // wishlist + predicted-setlist client lock, a transient null
      // would silently re-unlock both editors mid-show. Prefer a
      // stale-but-correct status over an unintended unlock. The
      // SSR-initial status the caller passed in remains in effect
      // when the server omits the field. CR #297.
      if ("status" in data) {
        setStatus(data.status ?? null);
      }
      setLastUpdated(data.updatedAt);
    } catch (err) {
      // AbortError from the cleanup or supersede path — silent.
      if (err instanceof DOMException && err.name === "AbortError") return;
      // Network/JSON parse failure — also silent; next tick retries.
    }
  }, [eventId, locale]);

  useEffect(() => {
    if (!enabled) return;
    intervalRef.current = setInterval(fetchSetlist, intervalMs);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      // Cancel the in-flight fetch when fetchSetlist's identity
      // changes (eventId/locale change) or the hook unmounts. The
      // abort() call mutates `signal.aborted` synchronously, so the
      // post-await checks inside fetchSetlist see it immediately
      // even if the fetch resolves in the same microtask cycle.
      // Combined with the supersede-time abort at the top of
      // fetchSetlist, this fully closes the cross-event clobber
      // window CR #297 round 2 flagged.
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, [enabled, intervalMs, fetchSetlist]);

  return { items, reactionCounts, top3Wishes, status, lastUpdated };
}
