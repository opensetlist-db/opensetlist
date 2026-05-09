"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";
import type { FanTop3Entry, ReactionCountsMap } from "@/lib/types/setlist";
import type { ResolvedEventStatus } from "@/lib/eventStatus";

export type { ReactionCountsMap };

interface UseRealtimeEventChannelOptions<T> {
  eventId: string;
  initialItems: T[];
  initialReactionCounts: ReactionCountsMap;
  initialTop3Wishes: FanTop3Entry[];
  // Display locale, threaded into the refetch URL so the route can trim
  // per-song translation joins to `[locale, "ja"]` for the wishlist
  // fan TOP-3 payload. Other slices (items, reactionCounts) are
  // locale-independent.
  locale: string;
  enabled: boolean;
}

interface UseRealtimeEventChannelResult<T> {
  items: T[];
  reactionCounts: ReactionCountsMap;
  top3Wishes: FanTop3Entry[];
  /**
   * Server-resolved event status, refreshed on every snapshot fetch.
   * Same semantics as `useSetlistPolling.status` so this hook is a
   * drop-in replacement at the call site (`LiveEventLayout`). Null
   * until the first snapshot lands; callers fall back to their
   * SSR-initial status until then.
   */
  status: ResolvedEventStatus | null;
  lastUpdated: string | null;
}

interface SetlistSnapshot<T> {
  items: T[];
  reactionCounts?: ReactionCountsMap;
  top3Wishes?: FanTop3Entry[];
  status?: ResolvedEventStatus | null;
  updatedAt: string;
}

/**
 * Realtime-push variant of `useSetlistPolling`. Same API, same return
 * shape, picked between by `LAUNCH_FLAGS.realtimeEnabled` inside
 * `LiveEventLayout`.
 *
 * R1 implementation — Path B (refetch on push) for SetlistItem:
 *
 *   1. On mount: one-shot `GET /api/setlist?eventId=…&locale=…` to seed
 *      items + reactions + top3Wishes + status. Same endpoint and same
 *      response shape the polling hook consumes — keeps reconciliation
 *      logic identical.
 *
 *   2. Subscribe to `event:{eventId}` channel; listen for
 *      `postgres_changes` on `SetlistItem` filtered by
 *      `eventId=eq.{eventId}`. Any INSERT/UPDATE/DELETE triggers an
 *      immediate /api/setlist refetch so the next snapshot includes
 *      the change with full nested shape (songs, performers, artists)
 *      that the raw `payload.new` row from `postgres_changes` does NOT
 *      carry.
 *
 *   3. On unmount or eventId change: unsubscribe + abort any in-flight
 *      fetch.
 *
 * Why Path B for R1 (not per-row diff merge): the postgres_changes
 * payload contains only the bare SetlistItem columns. The polling
 * response and downstream consumers (`LiveSetlist`, sidebar
 * derivations) expect the deeply-nested `LiveSetlistItem` shape with
 * songs, performers, and artists joined. Reconstructing that shape
 * from individual table pushes is R2's problem; for R1 we use the
 * push as a "kick" to refetch the joined snapshot. Latency goes from
 * ≤5s (poll cadence) to ~100ms (push → refetch) without inventing a
 * second source of truth for the joined shape.
 *
 * R1 does NOT relieve F14 connection pressure — every push still
 * triggers a /api/setlist hit, and inactive viewers receive no
 * pushes. R2 introduces per-row diff merge (Path A) for SetlistItem
 * + reactions + impressions, after which the /api/setlist endpoint
 * is hit only as the initial-state seed. R3 adds the polling
 * fallback path for production safety.
 */
export function useRealtimeEventChannel<T>({
  eventId,
  initialItems,
  initialReactionCounts,
  initialTop3Wishes,
  locale,
  enabled,
}: UseRealtimeEventChannelOptions<T>): UseRealtimeEventChannelResult<T> {
  const [items, setItems] = useState<T[]>(initialItems);
  const [reactionCounts, setReactionCounts] =
    useState<ReactionCountsMap>(initialReactionCounts);
  const [top3Wishes, setTop3Wishes] =
    useState<FanTop3Entry[]>(initialTop3Wishes);
  const [status, setStatus] = useState<ResolvedEventStatus | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // AbortController for the currently in-flight snapshot fetch.
  // Cancelled on eventId/locale change or unmount; the post-await
  // freshness check below catches the render-commit→cleanup gap
  // window where a fetch resolves with stale eventId before the
  // abort fires. Mirrors the pattern in useSetlistPolling.
  const abortRef = useRef<AbortController | null>(null);

  // Latest-value refs for the post-await freshness check. Synced via
  // useLayoutEffect so the OLD fetch's closure can compare its
  // captured eventId/locale against the current value at resolution
  // time without a microtask gap.
  const eventIdRef = useRef(eventId);
  const localeRef = useRef(locale);
  useLayoutEffect(() => {
    eventIdRef.current = eventId;
    localeRef.current = locale;
  }, [eventId, locale]);

  // Re-sync from props only when eventId actually changes — same
  // "track previous prop" idiom as useSetlistPolling. Without this
  // guard, callers passing fresh array refs would thrash state on
  // every render.
  const [prevEventId, setPrevEventId] = useState(eventId);
  if (prevEventId !== eventId) {
    setPrevEventId(eventId);
    setItems(initialItems);
    setReactionCounts(initialReactionCounts);
    setTop3Wishes(initialTop3Wishes);
    setStatus(null);
    setLastUpdated(null);
  }

  useEffect(() => {
    if (!enabled) return;

    // ──── Snapshot fetch ────
    // Used both for the initial mount seed AND as the Path B refetch
    // triggered by every postgres_changes push. Same endpoint, same
    // response shape — the polling and realtime paths reconcile
    // against identical data.
    const fetchSnapshot = async () => {
      // Cancel any prior in-flight fetch so a rapid burst of pushes
      // (e.g., admin paste-importing a setlist) collapses to a single
      // refetch instead of stampeding /api/setlist.
      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;
      const fetchEventId = eventId;
      const fetchLocale = locale;
      try {
        const res = await fetch(
          `/api/setlist?eventId=${encodeURIComponent(fetchEventId)}&locale=${encodeURIComponent(fetchLocale)}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (
          controller.signal.aborted ||
          eventIdRef.current !== fetchEventId ||
          localeRef.current !== fetchLocale
        ) {
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as SetlistSnapshot<T>;
        if (
          controller.signal.aborted ||
          eventIdRef.current !== fetchEventId ||
          localeRef.current !== fetchLocale
        ) {
          return;
        }
        setItems(data.items);
        setReactionCounts(data.reactionCounts ?? {});
        setTop3Wishes(data.top3Wishes ?? []);
        // Mirror useSetlistPolling's "only update status when present"
        // rule — a transient null from a partial response would
        // silently re-unlock the wishlist + predicted-setlist editors
        // mid-show (CR #297). Stale-but-correct beats unintended
        // unlock.
        if ("status" in data) {
          setStatus(data.status ?? null);
        }
        setLastUpdated(data.updatedAt);
      } catch (err) {
        // AbortError from cleanup or supersede — silent.
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Network/JSON failure — also silent; a future push will
        // re-trigger the fetch. R3 will add Sentry instrumentation
        // and a polling fallback for sustained errors.
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    };

    // Seed initial state.
    void fetchSnapshot();

    // ──── Channel subscription ────
    // Per-event channel. Filter is column-level on `eventId` — only
    // changes for THIS event reach this subscriber, regardless of
    // the platform's total write volume.
    //
    // Lazy import via getSupabaseBrowserClient so a module that
    // imports this hook from a polling-only build doesn't crash at
    // import time when the env vars aren't set. The flag check at
    // the call site (LiveEventLayout) guarantees we only reach this
    // line when `realtimeEnabled === true` — which itself implies
    // the env vars are present.
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`event:${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "SetlistItem",
          filter: `eventId=eq.${eventId}`,
        },
        () => {
          // Path B: any change → refetch the full joined snapshot.
          // The push payload's bare row doesn't include songs /
          // performers / artists, so we deliberately ignore the
          // payload contents and re-derive from /api/setlist. R2
          // replaces this with per-row diff merge (Path A).
          void fetchSnapshot();
        },
      )
      .subscribe();

    return () => {
      // Cancel any in-flight refetch first so its post-await
      // freshness check sees `signal.aborted` immediately.
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      // `removeChannel` both unsubscribes and removes the channel
      // from the supabase-js internal registry. If we only called
      // `channel.unsubscribe()`, the registry would leak the
      // channel name and a remount with the same eventId would
      // reuse the dead channel.
      void supabase.removeChannel(channel);
    };
  }, [eventId, locale, enabled]);

  return { items, reactionCounts, top3Wishes, status, lastUpdated };
}
