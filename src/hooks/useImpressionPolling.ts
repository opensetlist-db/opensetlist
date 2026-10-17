"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Impression } from "@/components/EventImpressions";
import { createLiveScheduler, type LiveFetchOutcome } from "@/lib/liveScheduler";
import {
  subscribeToDocumentHidden,
  getDocumentHiddenSnapshot,
  getDocumentHiddenServerSnapshot,
} from "@/lib/realtimeRecovery";

/**
 * Payload handed to the consumer's `onUpdate` callback.
 *
 * Polling intentionally fetches only the newest page (no cursor) and
 * does NOT request `?includeTotal=1` — the count() query would run
 * every poll per concurrent viewer for a UX-only metric, so it's
 * skipped on the hot path. `totalCount` is therefore omitted from
 * the polled payload; consumers that display a total maintain it
 * themselves via the SSR seed + load-more refresh + optimistic
 * submit/report increments.
 *
 * `nextCursor` is the cursor anchored at the 50th most recent
 * impression in this poll's response — null when the event has
 * fewer than `IMPRESSION_PAGE_SIZE` total impressions.
 */
export interface ImpressionPollPayload {
  impressions: Impression[];
  nextCursor: string | null;
}

/** Mean impressions poll interval and its per-gap spread (30 s ± 5 s). */
export const IMPRESSION_POLL_MS = 30_000;
export const IMPRESSION_POLL_SPREAD_MS = 5_000;

interface UseImpressionPollingOptions {
  eventId: string;
  enabled: boolean;
  /** Mean interval; each gap is `intervalMs ± spreadMs`. */
  intervalMs?: number;
  spreadMs?: number;
  /**
   * Called inside the polling fetch callback whenever a new poll succeeds.
   * Lets consumers update their own local state without an effect-based
   * sync from this hook's `impressions` return value (which would trip
   * react-hooks/set-state-in-effect on the consumer side).
   *
   * The callback is held in a ref internally so callers can pass fresh
   * function identities each render without re-triggering the polling
   * setup effect.
   */
  onUpdate?: (payload: ImpressionPollPayload) => void;
}

interface UseImpressionPollingResult {
  impressions: Impression[] | null;
  lastUpdated: string | null;
}

const OK: LiveFetchOutcome = { kind: "ok" };

/**
 * The impressions feed's only live path (n14). The per-row
 * postgres_changes subscription it used to back up
 * (`useRealtimeImpressions`, removed) added one more DB-side
 * registration per viewer on a project where registration is the
 * measured bottleneck (n12: ~3–9 registrations/s, 0/300 delivery
 * under load). Impressions are conversational, not real-time: a
 * ≤ ~35 s cross-viewer delay is fine for a comment thread, and the
 * submitter's own actions merge synchronously in `EventImpressions`.
 *
 * Cadence: 30 s ± 5 s with a random initial phase (shared live
 * scheduler), so the audience's polls spread across the window
 * instead of arriving in lock-step from page-load waves. The server
 * side caches the GET briefly (tag `event:<id>`), so the spread mostly
 * protects the cache-miss path.
 *
 * Visibility-gated: while the tab is hidden nothing runs; on return
 * one immediate fetch catches up, then the cadence resumes with a
 * fresh random phase. Failures stay silent (the next tick retries) —
 * there is no freshness indicator for this feed.
 *
 * Default cadence history: 5 s → 30 s in the F14 launch-day-retro
 * mitigation (wiki/launch-day-retros.md#F14); a regression back to a
 * short interval would re-trigger pooler EMAXCONN on audience ramps.
 */
export function useImpressionPolling({
  eventId,
  enabled,
  intervalMs = IMPRESSION_POLL_MS,
  spreadMs = IMPRESSION_POLL_SPREAD_MS,
  onUpdate,
}: UseImpressionPollingOptions): UseImpressionPollingResult {
  const [impressions, setImpressions] = useState<Impression[] | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  // Hold onUpdate in a ref so a fresh callback identity per render doesn't
  // tear down + rebuild the scheduler. The latest callback is read inside
  // the fetch. Ref write goes through an effect (canonical "latest ref"
  // pattern) — react-hooks/refs forbids ref writes during render.
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  const hidden = useSyncExternalStore(
    subscribeToDocumentHidden,
    getDocumentHiddenSnapshot,
    getDocumentHiddenServerSnapshot,
  );

  // Set when the tab goes hidden while polling is enabled, consumed by
  // the polling effect's re-run on return: that re-run is a RESUME
  // (catch up immediately), whereas the very first run is a mount (the
  // SSR seed is fresh; the first poll waits for its random phase).
  // Declared before the polling effect so it runs first on a change.
  const resumePendingRef = useRef(false);
  useEffect(() => {
    if (hidden && enabled) resumePendingRef.current = true;
  }, [hidden, enabled]);

  useEffect(() => {
    if (!enabled || hidden) return;
    let cancelled = false;

    const runFetch = async (): Promise<LiveFetchOutcome> => {
      try {
        // No `?includeTotal=1` — polling skips the event-wide count
        // query entirely. See `ImpressionPollPayload` JSDoc above.
        const res = await fetch(
          `/api/impressions?eventId=${encodeURIComponent(eventId)}`,
          { cache: "no-store" },
        );
        if (cancelled || !res.ok) return OK;
        const data = (await res.json()) as {
          impressions: Impression[];
          nextCursor: string | null;
        };
        if (cancelled) return OK;
        setImpressions(data.impressions);
        setLastUpdated(new Date().toISOString());
        onUpdateRef.current?.({
          impressions: data.impressions,
          nextCursor: data.nextCursor,
        });
      } catch {
        // Silent — the next tick retries.
      }
      return OK;
    };

    const scheduler = createLiveScheduler({
      runFetch,
      periodic: { intervalMs, spreadMs, firstTick: "random-phase" },
    });
    scheduler.start();
    if (resumePendingRef.current) {
      resumePendingRef.current = false;
      scheduler.requestFetch("resume");
    }
    return () => {
      cancelled = true;
      scheduler.dispose();
    };
  }, [enabled, hidden, eventId, intervalMs, spreadMs]);

  return { impressions, lastUpdated };
}
