"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Impression } from "@/components/EventImpressions";

interface UseImpressionPollingOptions {
  eventId: string;
  enabled: boolean;
  intervalMs?: number;
}

interface UseImpressionPollingResult {
  impressions: Impression[] | null;
  lastUpdated: string | null;
}

export function useImpressionPolling({
  eventId,
  enabled,
  intervalMs = 5000,
}: UseImpressionPollingOptions): UseImpressionPollingResult {
  const [impressions, setImpressions] = useState<Impression[] | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchImpressions = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/impressions?eventId=${encodeURIComponent(eventId)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { impressions: Impression[] };
      setImpressions(data.impressions);
      setLastUpdated(new Date().toISOString());
    } catch {
      // Silent — next tick retries.
    }
  }, [eventId]);

  useEffect(() => {
    // Drop any prior event's snapshot so it can't overwrite a fresh SSR list
    // after navigating to a different event.
    setImpressions(null);
    setLastUpdated(null);
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
