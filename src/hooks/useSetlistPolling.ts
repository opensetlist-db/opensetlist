"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ReactionCountsMap = Record<string, Record<string, number>>;

interface UseSetlistPollingOptions<T> {
  eventId: string;
  initialItems: T[];
  initialReactionCounts: ReactionCountsMap;
  enabled: boolean;
  intervalMs?: number;
}

interface UseSetlistPollingResult<T> {
  items: T[];
  reactionCounts: ReactionCountsMap;
  lastUpdated: string | null;
}

export function useSetlistPolling<T>({
  eventId,
  initialItems,
  initialReactionCounts,
  enabled,
  intervalMs = 5000,
}: UseSetlistPollingOptions<T>): UseSetlistPollingResult<T> {
  const [items, setItems] = useState<T[]>(initialItems);
  const [reactionCounts, setReactionCounts] =
    useState<ReactionCountsMap>(initialReactionCounts);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSetlist = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/setlist?eventId=${encodeURIComponent(eventId)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        items: T[];
        reactionCounts?: ReactionCountsMap;
        updatedAt: string;
      };
      setItems(data.items);
      setReactionCounts(data.reactionCounts ?? {});
      setLastUpdated(data.updatedAt);
    } catch {
      // Silent — next tick retries.
    }
  }, [eventId]);

  useEffect(() => {
    if (!enabled) return;
    intervalRef.current = setInterval(fetchSetlist, intervalMs);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, intervalMs, fetchSetlist]);

  return { items, reactionCounts, lastUpdated };
}
