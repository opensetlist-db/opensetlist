"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Impression } from "@/components/EventImpressions";

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
  onUpdate?: (impressions: Impression[]) => void;
}

interface UseImpressionPollingResult {
  impressions: Impression[] | null;
  lastUpdated: string | null;
}

export function useImpressionPolling({
  eventId,
  enabled,
  intervalMs = 5000,
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
      const res = await fetch(
        `/api/impressions?eventId=${encodeURIComponent(eventId)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { impressions: Impression[] };
      setImpressions(data.impressions);
      setLastUpdated(new Date().toISOString());
      onUpdateRef.current?.(data.impressions);
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
