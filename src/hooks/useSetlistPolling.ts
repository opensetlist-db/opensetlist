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

  // Re-sync from props only when eventId actually changes — not on every
  // parent re-render. Without this guard, callers passing fresh array refs
  // (like LiveSetlist) would re-trigger setState on every paint and thrash
  // the polling state. The useState-pair "track previous prop" idiom
  // (React docs: "Storing information from previous renders") avoids
  // both react-hooks/set-state-in-effect AND react-hooks/refs.
  const [prevEventId, setPrevEventId] = useState(eventId);
  if (prevEventId !== eventId) {
    setPrevEventId(eventId);
    setItems(initialItems);
    setReactionCounts(initialReactionCounts);
    setLastUpdated(null);
  }

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
