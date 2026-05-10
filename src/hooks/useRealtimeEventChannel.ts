"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";
import { useSetlistPolling } from "@/hooks/useSetlistPolling";
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
 *     / artists joined. R1's choice; kept in R2/R3.
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
 *
 * R3 — polling fallback + observability:
 *
 *   - Subscription state machine: on `CHANNEL_ERROR` or `TIMED_OUT`
 *     (supabase-js's retry budget exhausted), flip the internal
 *     `pollFallback` flag. `useSetlistPolling` is always called
 *     inside this hook (gated by `enabled && pollFallback`) so the
 *     fallback path is wired and ready — flipping the flag hands
 *     the load over to the proven 5s polling path within one render.
 *
 *   - No auto-recovery: once we drop to fallback, we stay there for
 *     the page's lifetime. Climbing back up to realtime would need
 *     careful coordination (drop polling, retry channel, hope it
 *     doesn't error again immediately) and is too easy to get wrong
 *     during a live show. The user can refresh the page to retry
 *     realtime cleanly.
 *
 *   - Reconnect refetch: if the channel briefly drops and reconnects
 *     before the retry budget is exhausted (supabase-js handles
 *     this internally), `SUBSCRIBED` fires again. The first
 *     `SUBSCRIBED` after mount is the normal initial join; every
 *     subsequent `SUBSCRIBED` is a recovery — refetch /api/setlist
 *     to fill any pushes that landed during the drop window.
 *
 *   - Sentry observability: breadcrumb on every status transition
 *     (so post-show analysis can reconstruct what happened); a
 *     single `captureMessage` on first fallback activation per
 *     session (the operator wants to know if any viewer fell back,
 *     once — not flap reports).
 *
 *   - Operator kill switch: `LAUNCH_FLAGS.realtimeEnabled = false`
 *     in src/lib/launchFlags.ts forces `enabled = false` from the
 *     LiveEventLayout call site, so this hook is a no-op and
 *     useSetlistPolling at the LiveEventLayout level (the OTHER
 *     copy, separate from the in-fallback copy here) drives the
 *     page. The flag is the global override; this hook's
 *     pollFallback is the per-session per-channel automatic.
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

  // R3: fallback gate. Flips to true on CHANNEL_ERROR / TIMED_OUT;
  // stays true for the page lifetime (no auto-recovery — see hook
  // JSDoc). Adding it to the realtime effect's deps means the effect
  // re-runs (cleanup → realtime channel torn down) the moment we
  // flip, which is what we want.
  const [pollFallback, setPollFallback] = useState(false);

  // Always-call useSetlistPolling so it's ready when fallback flips.
  // While realtime is healthy, `enabled: false` keeps the hook idle
  // (no fetches, no setInterval). On flip, polling enables itself
  // and starts the 5s cycle within one render.
  const polled = useSetlistPolling<T>({
    eventId,
    initialItems,
    initialReactionCounts,
    initialTop3Wishes,
    locale,
    enabled: enabled && pollFallback,
  });

  // First-SUBSCRIBED-vs-reconnect tracking. supabase-js auto-rejoins
  // on socket-level transient drops; the channel re-fires SUBSCRIBED
  // afterwards. The initial mount also fires SUBSCRIBED once. Use a
  // ref so the discriminator survives re-renders without hitting the
  // effect-deps array (which would re-trigger the channel setup).
  const hasSubscribedBeforeRef = useRef(false);

  // Once-per-session latch for the Sentry captureMessage. The
  // breadcrumb stream still records every transition, but a sustained
  // outage shouldn't generate one captureMessage per status flip —
  // operators only need the first signal that this session fell back.
  const hasReportedFallbackRef = useRef(false);

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
    // The fallback gate stays sticky — if we fell back on event A,
    // navigating to event B gets a fresh attempt at realtime. This
    // matches "user refresh = fresh retry" semantics. The matching
    // ref resets (hasSubscribedBeforeRef, hasReportedFallbackRef)
    // live in the useEffect below — react-hooks/refs forbids ref
    // writes during render.
    setPollFallback(false);
  }

  // Reset the realtime-state refs when eventId changes — paired with
  // the setState resets above. Runs post-commit (effect timing) so
  // the new channel-setup effect, which also depends on eventId,
  // sees the freshly-zeroed refs when its subscribe callback fires.
  useEffect(() => {
    hasSubscribedBeforeRef.current = false;
    hasReportedFallbackRef.current = false;
  }, [eventId]);

  useEffect(() => {
    if (!enabled) return;
    // When pollFallback is on, this effect's cleanup has already run
    // (the dep change triggered it) and we skip channel setup so
    // useSetlistPolling owns the page.
    if (pollFallback) return;

    // ──── Snapshot fetch ────
    // Used both for the initial mount seed AND as the Path B refetch
    // triggered by SetlistItem / SongWish pushes AND as the gap-fill
    // refetch when the channel reconnects after a drop. Same
    // endpoint, same response shape — the polling and realtime paths
    // reconcile against identical data.
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
        // Network/JSON failure — also silent. The pollFallback path
        // catches *channel* errors; one-off /api/setlist hiccups
        // recover on the next push or reconnect refetch.
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    };

    // Seed initial state.
    void fetchSnapshot();

    // ──── Reaction diff merge (Path A) ────
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
      .subscribe((channelStatus) => {
        // R3: status transition observability + fallback gating.
        // Breadcrumb every transition so a Sentry session replay or
        // post-mortem can reconstruct exactly when the channel went
        // sideways. `level: warning` for non-SUBSCRIBED so they
        // surface above the routine info noise.
        Sentry.addBreadcrumb({
          category: "realtime",
          message: `event:${eventId} channel status → ${channelStatus}`,
          level: channelStatus === "SUBSCRIBED" ? "info" : "warning",
          data: { eventId, channelStatus },
        });

        if (channelStatus === "SUBSCRIBED") {
          if (hasSubscribedBeforeRef.current) {
            // Reconnect after a transient drop — supabase-js
            // re-subscribed inside its retry budget. We may have
            // missed pushes during the gap; refetch the snapshot
            // to converge.
            void fetchSnapshot();
          } else {
            hasSubscribedBeforeRef.current = true;
          }
          return;
        }

        if (
          channelStatus === "CHANNEL_ERROR" ||
          channelStatus === "TIMED_OUT"
        ) {
          // First fallback per session: tell Sentry. Subsequent
          // status churn (which shouldn't happen since we don't
          // auto-recover) stays in the breadcrumb stream only.
          if (!hasReportedFallbackRef.current) {
            hasReportedFallbackRef.current = true;
            Sentry.captureMessage("Realtime fallback to polling", {
              level: "warning",
              tags: {
                eventId,
                transitionReason: channelStatus,
              },
            });
          }
          // Hand the page off to useSetlistPolling. The dep change
          // triggers the cleanup below (channel removed, fetch
          // aborted) and the next render's useEffect early-returns.
          setPollFallback(true);
          return;
        }

        // CLOSED — graceful unmount or eventId change. No fallback,
        // no Sentry. The cleanup function handles the bookkeeping.
      });

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
  }, [eventId, locale, enabled, pollFallback]);

  // R3: fallback return shape. When polling has taken over, prefer
  // its state — but during the warmup window (first poll hasn't
  // landed yet, so polled.lastUpdated is still null), keep showing
  // realtime's last-known state so the user doesn't see a flash of
  // stale SSR initialItems for ≤5s.
  if (pollFallback) {
    return {
      items: polled.lastUpdated ? polled.items : items,
      reactionCounts: polled.lastUpdated
        ? polled.reactionCounts
        : reactionCounts,
      top3Wishes: polled.lastUpdated ? polled.top3Wishes : top3Wishes,
      status: polled.status ?? status,
      lastUpdated: polled.lastUpdated ?? lastUpdated,
    };
  }

  return { items, reactionCounts, top3Wishes, status, lastUpdated };
}
