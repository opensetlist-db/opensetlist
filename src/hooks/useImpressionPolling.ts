"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Impression } from "@/components/EventImpressions";

/**
 * Payload handed to the consumer's `onUpdate` callback.
 *
 * Polling intentionally fetches only the newest page (no cursor) and
 * does NOT request `?includeTotal=1` — the count() query would run
 * every 30s per concurrent viewer for a UX-only metric, so it's
 * skipped on the hot path. `totalCount` is therefore omitted from
 * the polled payload; consumers that display a total maintain it
 * themselves via the SSR seed + load-more refresh + optimistic
 * submit/report increments.
 *
 * `nextCursor` is the cursor anchored at the 50th most recent
 * impression in this poll's response — null when the event has
 * fewer than `IMPRESSION_PAGE_SIZE` total impressions.
 *
 * Default cadence is 30s (was 5s before the F14 launch-day-retro
 * mitigation). Impressions are conversational, not real-time —
 * cross-user freshness of ≤ 33s is fine for a comment thread, and
 * the submitter's own UX is unaffected because `EventImpressions`
 * merges the POST response synchronously. See the F14 entry in
 * wiki/launch-day-retros.md.
 */
export interface ImpressionPollPayload {
  impressions: Impression[];
  nextCursor: string | null;
}

interface UseImpressionPollingOptions {
  eventId: string;
  enabled: boolean;
  intervalMs?: number;
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

export function useImpressionPolling({
  eventId,
  enabled,
  intervalMs = 30_000,
  onUpdate,
}: UseImpressionPollingOptions): UseImpressionPollingResult {
  const [impressions, setImpressions] = useState<Impression[] | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Hold onUpdate in a ref so a fresh callback identity per render doesn't
  // tear down + rebuild the setInterval. The latest callback is read inside
  // the timer tick. Ref write goes through an effect (canonical "latest
  // ref" pattern) — react-hooks/refs forbids ref writes during render.
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  const fetchImpressions = useCallback(async () => {
    try {
      // No `?includeTotal=1` — polling skips the event-wide count
      // query entirely. See `ImpressionPollPayload` JSDoc above.
      const res = await fetch(
        `/api/impressions?eventId=${encodeURIComponent(eventId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        impressions: Impression[];
        nextCursor: string | null;
      };
      setImpressions(data.impressions);
      setLastUpdated(new Date().toISOString());
      onUpdateRef.current?.({
        impressions: data.impressions,
        nextCursor: data.nextCursor,
      });
    } catch {
      // Silent — next tick retries.
    }
  }, [eventId]);

  useEffect(() => {
    if (!enabled) return;
    intervalRef.current = setInterval(fetchImpressions, intervalMs);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, intervalMs, fetchImpressions]);

  return { impressions, lastUpdated };
}
