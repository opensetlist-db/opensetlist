"use client";

import { useEffect } from "react";
// Type lives in `src/lib/types/setlist.ts` so pure helpers under
// `src/lib/` can use it without crossing the lib→hooks layer
// boundary. Re-exported below for back-compat with existing
// `import { ReactionCountsMap } from "@/hooks/useSetlistPolling"`.
import type { FanTop3Entry, ReactionCountsMap } from "@/lib/types/setlist";
import type { ResolvedEventStatus } from "@/lib/eventStatus";
import type { Freshness } from "@/lib/snapshotFreshness";
import {
  FALLBACK_POLL_MS,
  FALLBACK_POLL_SPREAD_MS,
  createLiveScheduler,
} from "@/lib/liveScheduler";
import { useLiveSnapshot } from "@/hooks/useLiveSnapshot";

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
  /** Mean poll interval; each gap is `intervalMs ± spreadMs`. */
  intervalMs?: number;
  spreadMs?: number;
  /**
   * Seed for the acceptance watermark: the SSR snapshot's revision /
   * capturedAt, or — as the R3 fallback inside the realtime hook — the
   * latest version the realtime path applied. Read again each time
   * polling is enabled (it only ever raises the watermark).
   */
  initialRev?: number | null;
  initialCapturedAt?: string | null;
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
  /**
   * Whether THIS browser is keeping up — last successful poll time
   * plus live / retrying / delayed. Reflects sync success, not data
   * age: a quiet MC with healthy polls stays "live". See
   * `src/lib/snapshotFreshness.ts`.
   */
  freshness: Freshness;
  /** Applied snapshot revision (see `useLiveSnapshot`). */
  rev: number | null;
  /** Applied snapshot `capturedAt` ISO (see `useLiveSnapshot`). */
  capturedAt: string | null;
}

/**
 * Polling path for the live snapshot — the R3 fallback inside
 * `useRealtimeEventChannel` (and usable standalone).
 *
 * Cadence: `intervalMs ± spreadMs` (default 5 s ± 1 s) with a random
 * initial phase, via the shared live scheduler. A fixed `setInterval`
 * started at enable time would keep every viewer that fell back at the
 * same moment — a Realtime outage hits the whole audience together —
 * polling in lock-step for the rest of the show; the random phase plus
 * per-gap spread de-correlates them within a few cycles.
 *
 * Single-flight: a tick while a request is in flight is skipped (the
 * in-flight request IS this period's poll), so a slow network can't
 * stack requests or cancel each other (CR #298). Every request carries
 * the 8 s deadline, which settles it as a failure and frees the guard.
 *
 * Failures: n13's bounded schedule (1/2/4/8/15/30 s ± 20 %, honouring
 * `Retry-After`) arms a retry, and ticks are skipped while it is
 * pending, so a struggling server sees the backoff rather than the 5 s
 * cadence. Fresh budget per polling session (enable, event/locale
 * change) — a previous session's failures say nothing about the
 * endpoint's health now.
 *
 * Acceptance + `?minRev=`: shared with the realtime path through
 * `useLiveSnapshot` — an older response never rolls the page back.
 *
 * Not visibility-gated (unchanged): the browser throttles background
 * timers on its own, and the fallback must keep converging for a tab
 * that is visible but whose channel is dead.
 */
export function useSetlistPolling<T>({
  eventId,
  initialItems,
  initialReactionCounts,
  initialTop3Wishes,
  locale,
  enabled,
  intervalMs = FALLBACK_POLL_MS,
  spreadMs = FALLBACK_POLL_SPREAD_MS,
  initialRev,
  initialCapturedAt,
}: UseSetlistPollingOptions<T>): UseSetlistPollingResult<T> {
  const { data, createRunner, resetFailures, adoptSeed } = useLiveSnapshot<T>({
    eventId,
    locale,
    initialItems,
    initialReactionCounts,
    initialTop3Wishes,
    initialRev,
    initialCapturedAt,
  });

  useEffect(() => {
    if (!enabled) return;
    resetFailures();
    // Hand-over from the realtime path: start from the newest version
    // the page has already shown (the realtime hook passes it as
    // `initialRev` / `initialCapturedAt`). Before `createRunner`, which
    // captures the acceptance state for this session.
    adoptSeed();
    const runner = createRunner();
    const scheduler = createLiveScheduler({
      runFetch: runner.runFetch,
      periodic: { intervalMs, spreadMs, firstTick: "random-phase" },
    });
    scheduler.start();
    return () => {
      // Dispose first so a request settling during the abort can't arm
      // a retry; the abort then resolves every in-flight request as
      // cancelled (never a failure).
      scheduler.dispose();
      runner.abort();
    };
  }, [enabled, intervalMs, spreadMs, createRunner, resetFailures, adoptSeed]);

  return data;
}
