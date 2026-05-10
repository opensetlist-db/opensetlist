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

// Bare-row shape for SetlistItemReaction `postgres_changes` payloads.
// The DB column is BigInt; logical replication serializes it to a JS
// number when the value fits in IEEE-754, otherwise to a string.
// `setlistItemId` is the only field we actually compare against
// existing keys — coerce to string so the reactionCounts map lookup
// matches `String(setlistItemId)` regardless of which form arrives.
interface ReactionRowPayload {
  id: string;
  setlistItemId: number | string | bigint;
  reactionType: string;
  eventId: number | string | bigint | null;
}

/**
 * Realtime-push variant of `useSetlistPolling`. Same API, same return
 * shape, picked between by `LAUNCH_FLAGS.realtimeEnabled` inside
 * `LiveEventLayout`.
 *
 * Channel: `event:{eventId}` carries SetlistItem, SetlistItemReaction,
 * and SongWish changes. EventImpression rides on a separate channel
 * (`event:{eventId}:impressions`) owned by `useRealtimeImpressions`
 * inside `EventImpressions`, since the impressions feed has its own
 * cursor-pagination state and its consumer is independent.
 *
 * Reconciliation strategy per table:
 *
 *   - SetlistItem        → Path B (refetch /api/setlist on push). The
 *     postgres_changes payload is the bare row; the polling response
 *     and downstream consumers (LiveSetlist, sidebar derivations)
 *     expect the deeply-nested LiveSetlistItem with songs / performers
 *     / artists joined. R1's choice; kept in R2.
 *
 *   - SetlistItemReaction → Path A (per-row diff merge into
 *     reactionCounts). High-frequency, low-cardinality (the count
 *     map is tiny): trivial to maintain client-side. INSERT
 *     increments, DELETE decrements (via REPLICA IDENTITY FULL on
 *     the table — see prisma/post-deploy.sql). UPDATE is unreachable
 *     in the current write paths (reactions are immutable), so
 *     ignored. R2's structural F14 win lives here: ~5s polling →
 *     0 polling for the highest-volume slice.
 *
 *   - SongWish           → Path B (refetch /api/setlist on push). The
 *     wishlist TOP-3 needs locale-specific song-translation joins
 *     and a server-side aggregation that's awkward to mirror
 *     client-side. Frequency is low (~10s of wishes per show), so
 *     refetching on each change is acceptable.
 *
 * Optimistic-UI / push collision: NOT mitigated with a suppression
 * window in this hook. ReactionButtons already protects via the
 * `pendingPollCounts` stash pattern (props-while-loading don't apply
 * to local optimistic state; POST response is authoritative on
 * settle). EventImpressions dedupes by id in mergeImpressions.
 * Adding a suppression Map here would be belt-and-suspenders for a
 * race that the consumer-side architecture already handles.
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
    // triggered by SetlistItem / SongWish pushes. Same endpoint,
    // same response shape — the polling and realtime paths reconcile
    // against identical data.
    const fetchSnapshot = async () => {
      // Cancel any prior in-flight fetch so a rapid burst of pushes
      // (e.g., admin paste-importing a setlist, multiple wishes
      // landing within the same animation frame) collapses to a
      // single refetch instead of stampeding /api/setlist.
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

    // ──── Reaction diff merge (Path A) ────
    // Closes over `setReactionCounts` directly to avoid a stale
    // closure on a fresh hook prop value — diff-merge math is
    // self-contained per-cell (read-modify-write of one entry),
    // so the functional setState form gives us atomicity against
    // concurrent pushes within the same render cycle.
    const applyReactionInsert = (row: ReactionRowPayload) => {
      const sid = String(row.setlistItemId);
      const rType = row.reactionType;
      setReactionCounts((prev) => {
        const next = { ...prev };
        const cell = { ...(next[sid] ?? {}) };
        cell[rType] = (cell[rType] ?? 0) + 1;
        next[sid] = cell;
        return next;
      });
    };
    const applyReactionDelete = (row: ReactionRowPayload) => {
      // Requires REPLICA IDENTITY FULL on SetlistItemReaction so
      // setlistItemId + reactionType are present in payload.old —
      // see prisma/post-deploy.sql. Defensive guard: bail if either
      // field is missing (REPLICA IDENTITY misconfigured) so we
      // don't accidentally decrement a wrong cell.
      if (row.setlistItemId == null || !row.reactionType) return;
      const sid = String(row.setlistItemId);
      const rType = row.reactionType;
      setReactionCounts((prev) => {
        const cell = prev[sid];
        if (!cell || !cell[rType]) return prev;
        const next = { ...prev };
        const updated = { ...cell };
        const newCount = updated[rType] - 1;
        if (newCount <= 0) {
          delete updated[rType];
        } else {
          updated[rType] = newCount;
        }
        if (Object.keys(updated).length === 0) {
          delete next[sid];
        } else {
          next[sid] = updated;
        }
        return next;
      });
    };

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
      // SetlistItem — Path B (refetch).
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "SetlistItem",
          filter: `eventId=eq.${eventId}`,
        },
        () => {
          void fetchSnapshot();
        },
      )
      // SetlistItemReaction — Path A (diff merge).
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "SetlistItemReaction",
          filter: `eventId=eq.${eventId}`,
        },
        (payload) => {
          applyReactionInsert(payload.new as ReactionRowPayload);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "SetlistItemReaction",
          filter: `eventId=eq.${eventId}`,
        },
        (payload) => {
          applyReactionDelete(payload.old as ReactionRowPayload);
        },
      )
      // SongWish — Path B (refetch). The TOP-3 aggregate needs
      // locale-specific song-translation joins, which are awkward
      // to mirror client-side. Refetch frequency is low (wishes
      // arrive at ~tens-per-show, mostly pre-show) so the bandwidth
      // cost of re-pulling /api/setlist on each push is acceptable.
      // A future optimization could add a /api/wishlist/top3 thin
      // endpoint, but the existing endpoint reuses the SSR cache
      // path — premature to split.
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "SongWish",
          filter: `eventId=eq.${eventId}`,
        },
        () => {
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
