"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";
import { useSetlistPolling } from "@/hooks/useSetlistPolling";
import type { FanTop3Entry, ReactionCountsMap } from "@/lib/types/setlist";
import {
  nextEventStatusBoundaryDelay,
  type ResolvedEventStatus,
} from "@/lib/eventStatus";
import {
  RECOVERY_DELAY_MS,
  MAX_RECOVERY_ATTEMPTS,
} from "@/lib/realtimeRecovery";

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
  /**
   * Event start time as ISO string (or null when unknown). Used to
   * schedule a boundary `fetchSnapshot()` at the upcoming → ongoing
   * and ongoing → completed flips, so the polled `status` field
   * re-derives without depending on a fan/admin push to land.
   *
   * String — NOT `Date` — so the value is reference-stable across
   * renders for the channel-setup effect's deps array. The caller
   * is expected to coerce a `Date` via `.toISOString()` before
   * passing in. Mirrors the pattern used at `<EventStatusTicker>`'s
   * call site (`<EventHeader>`).
   *
   * Pre-Realtime, the 5s polling cadence implicitly caught these
   * boundaries — every poll's response carried server-resolved
   * `status`. With Realtime, `/api/setlist` only refetches on push
   * (Path B for SetlistItem and SongWish), so without this timer a
   * startTime crossing in a no-activity window would leave the
   * polled status stale, and the `polledStatus ?? status`
   * precedence in `LiveEventLayout` would mask a fresh SSR
   * `status` (router.refresh from `<EventStatusTicker>`) with the
   * stale polled value. The boundary timer here closes that
   * window.
   */
  startTime: string | null;
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
 *
 * R3.5 — visibility handling + bounded auto-recovery (PR for Sentry
 * issue 7485048757, ~19 fallbacks/day baseline as of 2026-05-24):
 *
 *   - `document.visibilitychange` integration. When the tab is
 *     hidden we proactively pause the channel: Chrome / Safari
 *     aggressively throttle background WebSocket heartbeats, and
 *     after enough missed pings supabase-js's retry budget
 *     exhausts and we'd fall back to polling permanently on a
 *     channel we never actually wanted to lose. Pausing tears the
 *     channel down cleanly so no CHANNEL_ERROR is emitted; on
 *     visibility return we re-subscribe and fetchSnapshot to
 *     gap-fill any pushes that landed during the away window.
 *     This was the dominant root cause traced from the Sentry
 *     breadcrumb stream — 11 minutes of silent breadcrumbs
 *     between last user activity and CHANNEL_ERROR, classic
 *     macOS Chrome background-throttle signature.
 *
 *   - Bounded time-based auto-recovery for failures that happen
 *     while the tab IS visible (network blip, momentary server
 *     reject). After `pollFallback` flips, schedule a single
 *     `setPollFallback(false)` retry after RECOVERY_DELAY_MS.
 *     `recoveryAttemptsRef` enforces MAX_RECOVERY_ATTEMPTS per
 *     session so a pathologically flapping network can't pin us
 *     in a retry loop. If the retry's resubscribe also fails, the
 *     CHANNEL_ERROR handler runs the same logic again until budget
 *     exhausts, then we stay on polling for the rest of the page
 *     lifetime (matching the original "no auto-recovery" semantics
 *     once the budget is gone).
 *
 *   - Visibility resume from `pollFallback === true` ALSO triggers
 *     a recovery attempt with the budget RESET. Logic: failures
 *     during background throttling don't reflect real network /
 *     server issues — they reflect Chrome's throttle policy. When
 *     the user actively returns, the prior background-throttle
 *     failure shouldn't count against the visible-tab retry budget.
 *
 *   - Captures still emit once per session via `hasReportedFallbackRef`.
 *     Successful recoveries do NOT clear the flag — the operator
 *     gets one signal per session that "this user dropped at least
 *     once," and subsequent flips (retry storms, repeated drops)
 *     stay in the breadcrumb stream. Sentry "Users affected" is
 *     pinned at 0 anyway (no setUser, sendDefaultPii false), so
 *     "Events" count IS the signal — 168/9d ≈ 19/day as the
 *     pre-R3.5 baseline; expect this to drop sharply.
 */
export function useRealtimeEventChannel<T>({
  eventId,
  initialItems,
  initialReactionCounts,
  initialTop3Wishes,
  locale,
  enabled,
  startTime,
}: UseRealtimeEventChannelOptions<T>): UseRealtimeEventChannelResult<T> {
  const [items, setItems] = useState<T[]>(initialItems);
  const [reactionCounts, setReactionCounts] =
    useState<ReactionCountsMap>(initialReactionCounts);
  const [top3Wishes, setTop3Wishes] =
    useState<FanTop3Entry[]>(initialTop3Wishes);
  const [status, setStatus] = useState<ResolvedEventStatus | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // R3: fallback gate. Flips to true on CHANNEL_ERROR / TIMED_OUT.
  // Adding it to the realtime effect's deps means the effect re-runs
  // (cleanup → realtime channel torn down) the moment we flip, which
  // is what we want. R3.5 (PR for Sentry issue 7485048757) allows
  // controlled flips back to false via either (a) the bounded
  // setTimeout-based auto-recovery scheduled from the CHANNEL_ERROR
  // handler, or (b) the visibility-resume path when the prior fallback
  // happened in a backgrounded tab.
  const [pollFallback, setPollFallback] = useState(false);

  // R3.5: visibility-driven pause gate. Mirrors `pollFallback` in the
  // realtime effect's deps array so the channel cleans up the instant
  // the tab is hidden. Separate from `pollFallback` because the
  // semantics differ — `pollFallback` says "realtime is dead, polling
  // takes over"; `paused` says "the user can't see this tab anyway,
  // don't bother holding a heartbeat-throttled channel that's about
  // to be killed by the browser". Polling stays in its current
  // enabled/disabled state across the pause (mirrors the rest of the
  // page — `useImpressionPolling`, `useSetlistPolling` in the
  // LiveEventLayout — none of which know about visibility either; the
  // browser throttles their setInterval the same way it throttles the
  // socket, so they harmlessly drift until the tab is visible again).
  const [paused, setPaused] = useState(false);

  // R3.5: latest-value refs so the visibility listener (mounted once
  // in a separate effect with `[]` deps) can read current state
  // without re-subscribing on every render. Same "latest ref" pattern
  // as `useRealtimeImpressions`'s callback refs.
  const pollFallbackRef = useRef(pollFallback);
  useEffect(() => {
    pollFallbackRef.current = pollFallback;
  }, [pollFallback]);

  // R3.5: tracks whether the channel was torn down via the visibility
  // hide path (vs eventId/locale/enabled change or pollFallback flip).
  // Read inside the SUBSCRIBED handler — when the first SUBSCRIBED
  // after a pause fires, we treat it as a reconnect and refetch the
  // snapshot to gap-fill any pushes the user missed while away. The
  // existing `hasSubscribedBeforeRef` is reset at the top of the
  // channel-setup effect (intentional, per its own comment), so it
  // would misread the post-resume SUBSCRIBED as an initial join.
  // `wasPausedRef` survives the effect cleanup because it lives at
  // hook scope and is only mutated from the visibility handler + the
  // SUBSCRIBED handler that clears it.
  const wasPausedRef = useRef(false);

  // R3.5: bounded auto-recovery state. `recoveryAttemptsRef` counts
  // attempts across the whole hook lifetime (or eventId change,
  // whichever comes first); `pendingRecoveryTimeoutRef` holds the
  // currently-scheduled setTimeout id so cleanup (unmount, eventId
  // change, visibility hide) can cancel a pending retry before it
  // fires.
  const recoveryAttemptsRef = useRef(0);
  const pendingRecoveryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

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
    // matches "user refresh = fresh retry" semantics. Matching ref
    // resets live INSIDE the channel-setup effect below: refs are
    // bound to the channel's lifetime, and the channel restarts on
    // any of [eventId, locale, enabled, pollFallback, paused] changing.
    setPollFallback(false);
    // Also reset paused — visibility state happens to apply to the
    // page, but the per-event recovery budget belongs to the
    // event session. Navigating to a new event is conceptually a
    // fresh page session. Ref cleanup for the same boundary lives
    // in the `[eventId]` useEffect below (refs may not be mutated
    // during render per `react-hooks/refs`).
    setPaused(false);
  }

  // R3.5: per-event ref cleanup. State setters in the render-phase
  // block above are allowed (React's "setState during render"
  // pattern triggers a synchronous re-render), but refs may not be
  // mutated during render (`react-hooks/refs` lint rule, enforced
  // by React Compiler / React 19). This effect runs after commit
  // when `eventId` changes — close enough to the state reset that
  // a race against the channel-setup effect (which also depends on
  // eventId) is theoretical only; supabase-js's subscribe callback
  // is always asynchronous, so it can't fire between commit and the
  // first effect tick of the same render. Declared BEFORE the
  // channel-setup effect so cleanup runs first in declaration order
  // and the channel-setup effect sees refs at their reset values.
  useEffect(() => {
    wasPausedRef.current = false;
    recoveryAttemptsRef.current = 0;
    if (pendingRecoveryTimeoutRef.current !== null) {
      clearTimeout(pendingRecoveryTimeoutRef.current);
      pendingRecoveryTimeoutRef.current = null;
    }
    // R3.5: latch reset is eventId-scoped (was previously per-
    // channel-setup at the top of the effect). With auto-recovery
    // the channel-setup effect re-runs on every retry attempt;
    // resetting per-attempt would defeat the captureMessage's
    // "one per session" invariant. Per-event is the right boundary.
    hasReportedFallbackRef.current = false;
  }, [eventId]);

  // R3.5: visibility listener. Mounted once per hook instance — adding
  // [eventId, ...] to its deps would re-attach the listener on every
  // navigation, which doesn't help (a single global listener handles
  // page-level visibility) and would briefly leave the page with no
  // listener during the React commit gap. Listener uses refs so its
  // closure doesn't capture stale state — `pollFallbackRef` for the
  // resume-while-fallback path, no other state read.
  //
  // SSR guard: `document` is undefined in the Next.js server bundle.
  // This hook is "use client", so the effect only runs in the browser,
  // but the bundle still gets parsed server-side during build — and a
  // top-level `document.addEventListener` would crash. The `typeof`
  // check is the standard pattern (matches every other client-only
  // hook in this codebase that touches DOM globals).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      if (document.hidden) {
        // Tab is going away. Mark the pause so the eventual SUBSCRIBED
        // on resume triggers a snapshot refetch (gap-fill for missed
        // pushes during the away window), flip `paused` so the channel
        // effect cleans up the open channel right now (don't wait for
        // the browser to start throttling our heartbeats), and cancel
        // any pending auto-recovery timer (no point spinning up a
        // channel we're about to tear down).
        wasPausedRef.current = true;
        setPaused(true);
        if (pendingRecoveryTimeoutRef.current !== null) {
          clearTimeout(pendingRecoveryTimeoutRef.current);
          pendingRecoveryTimeoutRef.current = null;
        }
      } else {
        // User is back. Release `paused` so the channel effect
        // re-subscribes. If we'd already fallen back to polling
        // (likely cause: a CHANNEL_ERROR while the tab was hidden,
        // because supabase-js's heartbeat retries exhausted while the
        // browser was throttling them — though this entire path is
        // designed to AVOID that by pausing first, this branch covers
        // the race where the failure beats the visibilitychange
        // listener), give realtime a fresh shot. Resetting the
        // recovery budget here is intentional: the prior failure was
        // background-throttle-flavored, not a real "this network /
        // server is broken" signal, so it shouldn't count against
        // visible-tab attempts.
        setPaused(false);
        if (pollFallbackRef.current) {
          recoveryAttemptsRef.current = 0;
          setPollFallback(false);
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // R3.5: cleanup pending recovery timer on unmount. The channel-
  // setup effect's cleanup runs on every dep change (pollFallback,
  // paused, eventId, locale, enabled, startTime); putting the timer
  // clear there would prematurely cancel an auto-recovery retry that
  // was scheduled by the very dep change that triggered the cleanup.
  // Empty-deps unmount-only cleanup is the right shape.
  useEffect(() => {
    return () => {
      if (pendingRecoveryTimeoutRef.current !== null) {
        clearTimeout(pendingRecoveryTimeoutRef.current);
        pendingRecoveryTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    // When pollFallback is on, this effect's cleanup has already run
    // (the dep change triggered it) and we skip channel setup so
    // useSetlistPolling owns the page.
    if (pollFallback) return;
    // R3.5: paused gate. Mirror pollFallback for visibility-driven
    // pauses — same shape, same early return, same cleanup chain.
    if (paused) return;

    // Reset the channel-bound SUBSCRIBED tracker at the top of every
    // channel setup. It tracks state of the CURRENT channel —
    // initial-vs-reconnect for THIS channel's transitions — so
    // resetting only on eventId change (in a sibling useEffect)
    // would leak old-channel state into the new channel when locale
    // changes (the channel-setup effect re-runs but the sibling does
    // not, so the new channel's first SUBSCRIBED would be misread as
    // a reconnect and trigger a redundant /api/setlist refetch).
    //
    // `hasReportedFallbackRef` is NOT reset here, in contrast — it's
    // a per-session latch (eventId-scoped, see the eventId-change
    // block above). With R3.5 auto-recovery the effect re-runs on
    // every retry attempt; resetting the latch here would re-fire
    // the captureMessage on every recovery cycle's failure, defeating
    // the "one capture per session" invariant the operator relies on.
    hasSubscribedBeforeRef.current = false;

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

    // ──── Status-boundary scheduler ────
    // Self-rescheduling setTimeout that fires fetchSnapshot at each
    // event-status boundary (upcoming → ongoing at startTime, then
    // ongoing → completed at startTime + ONGOING_BUFFER_MS). After
    // the first boundary fires and fetchSnapshot lands, the
    // recursive call queries the helper for the NEXT boundary —
    // which becomes the completed flip — and schedules again. After
    // the second boundary, the helper returns null and the chain
    // ends. The post-first-boundary fetchSnapshot also flips
    // polledStatus to "ongoing", which propagates up to the
    // wishlist + predicted-setlist editor lock without waiting for
    // an unrelated push.
    //
    // Cleanup: we hold the timer in a closure variable; the effect
    // cleanup clears the latest scheduled one. The recursive
    // setTimeout chain only fires on a still-mounted hook because
    // each callback runs after the previous timer was assigned to
    // the same `boundaryTimer` slot — clearing the latest is
    // sufficient.
    let boundaryTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleNextStatusBoundary = () => {
      const delayMs = nextEventStatusBoundaryDelay(startTime);
      if (delayMs === null) return;
      boundaryTimer = setTimeout(() => {
        void fetchSnapshot();
        scheduleNextStatusBoundary();
      }, delayMs);
    };
    scheduleNextStatusBoundary();

    // ──── Reaction diff merge (Path A) ────
    //
    // Both handlers scope-check `row.eventId` against the current
    // page's eventId. The subscription no longer carries a server-side
    // `filter: eventId=eq.X` because Supabase Realtime's per-table
    // filter-validation cache rejected SetlistItemReaction DELETE on
    // prod (incident 2026-05-16, after the SongWish + SetlistItem
    // workaround had already been deployed — same validator cache
    // bug, now cascading to the only remaining Path A subscription).
    //
    // Client-side scope-check is correct because REPLICA IDENTITY
    // FULL is set on SetlistItemReaction (see prisma/post-deploy.sql),
    // so `payload.new.eventId` and `payload.old.eventId` are both
    // populated for INSERT and DELETE respectively. Without the
    // check, cross-event pushes would bloat (or with same
    // setlistItemId across events — impossible by FK design but worth
    // pinning) corrupt this event's reactionCounts.
    const currentEventIdStr = String(eventId);
    const applyReactionInsert = (row: ReactionRowPayload) => {
      if (String(row.eventId) !== currentEventIdStr) return;
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
      // setlistItemId + reactionType + eventId are present in
      // payload.old — see prisma/post-deploy.sql. Defensive guards:
      // bail if eventId scope mismatches, OR if either of the count-
      // cell fields is missing (REPLICA IDENTITY misconfigured) so
      // we don't accidentally decrement a wrong cell.
      if (String(row.eventId) !== currentEventIdStr) return;
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
      //
      // No eventId filter despite the channel being per-event. Why:
      // Supabase Realtime's filter-validation function (`realtime
      // .check_filters`) maintains a per-table column-filterability
      // cache that's seeded when a table joins the supabase_realtime
      // publication and is NOT refreshed by subsequent
      // `ALTER TABLE ... REPLICA IDENTITY FULL` or project restarts.
      // On prod we hit the stale-cache case for SongWish (incident
      // 2026-05-16, [[wiki/log.md#[2026-05-16] incident | SongWish
      // realtime filter rejected on prod]]) and pre-emptively dropped
      // the SetlistItem filter too — same Path B refetch pattern,
      // same risk surface. The fetchSnapshot() handler re-pulls
      // /api/setlist scoped to *this page's* eventId regardless of
      // which event triggered the push, so receiving cross-event
      // pushes is just a few wasted refetches per minute at prod
      // scale (~10s of wishes per show). Filter cost
      // (perf optimization) < filter risk (subscription rejected).
      //
      // Filters stay on SetlistItemReaction (Path A diff-merge —
      // needs row data, which the validator's stale cache for that
      // table happens to be in sync because REPLICA IDENTITY FULL
      // was set in the same migration that added it to the
      // publication) and EventImpression (separate channel anyway).
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "SetlistItem",
        },
        () => {
          void fetchSnapshot();
        },
      )
      // SetlistItemReaction — Path A (diff merge).
      //
      // Filter dropped (same prod incident as SongWish + SetlistItem
      // — the validator-cache staleness cascaded to SetlistItemReaction
      // DELETE on 2026-05-16 even after REPLICA IDENTITY FULL was
      // confirmed). Filter would have been a perf optimization; the
      // diff-merge handlers (applyReactionInsert / applyReactionDelete
      // above) scope-check `row.eventId` against this page's eventId,
      // so cross-event pushes are dropped before they can touch
      // reactionCounts. Correctness preserved without the filter.
      //
      // The Path A vs Path B trade-off still applies: cross-event
      // pushes arrive here too, but instead of triggering a wasted
      // /api/setlist refetch (Path B), they hit the cheap scope
      // check and exit. So Path A is actually *more* efficient than
      // Path B under no-filter operation — the handler is O(1), no
      // network call.
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "SetlistItemReaction",
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
      //
      // No eventId filter — see the SetlistItem subscription above
      // for the full incident write-up. tl;dr: Supabase Realtime's
      // filter-validation cache went stale on prod and rejected the
      // filter despite the column being in the publication with
      // REPLICA IDENTITY FULL. fetchSnapshot() is scoped to *this
      // page's* eventId regardless of trigger, so cross-event
      // pushes just cost a few wasted refetches per minute at
      // current scale.
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "SongWish",
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
          // R3.5: visibility-resume gap-fill. `wasPausedRef` is set by
          // the visibility handler when the tab goes hidden; the FIRST
          // SUBSCRIBED after a resume is functionally a reconnect (we
          // may have missed pushes during the away window) and
          // deserves a refetch. The `hasSubscribedBeforeRef` reset at
          // the top of this effect would otherwise misclassify it as
          // an initial join. Clear `wasPausedRef` after consuming so
          // subsequent reconnects-within-this-channel-lifecycle fall
          // through to the normal `hasSubscribedBeforeRef` path.
          if (wasPausedRef.current) {
            // Resume from a visibility pause. The mount-seed
            // `void fetchSnapshot()` at the top of this effect re-run
            // already fired the gap-fill (the effect re-runs when
            // `paused` flips back to false, going through the same
            // code path as an initial mount). Just clear the latch
            // and seed `hasSubscribedBeforeRef` so any subsequent
            // SUBSCRIBEDs within this channel lifetime (supabase-js
            // mid-session reconnects) are still treated as reconnects.
            wasPausedRef.current = false;
            hasSubscribedBeforeRef.current = true;
            return;
          }
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
          // status churn (post-recovery re-failures, retry storms)
          // stays in the breadcrumb stream only — the operator only
          // needs the first signal that this user dropped at all.
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

          // R3.5: bounded auto-recovery. Only schedule when the tab
          // is visible — a hidden-tab failure means the visibility
          // resume path will handle re-subscribe with a fresh budget
          // (failures during background throttling aren't real
          // network/server problems). Each attempt counts against
          // MAX_RECOVERY_ATTEMPTS. The setTimeout fires
          // setPollFallback(false), which triggers the effect to
          // re-run and re-subscribe; if that fails again, the new
          // CHANNEL_ERROR runs this same logic with the incremented
          // counter until budget exhausts.
          //
          // `pendingRecoveryTimeoutRef.current === null` guard prevents
          // duplicate timers: if CHANNEL_ERROR somehow fires twice
          // before the first timer's setPollFallback(false) has
          // re-subscribed (rapid burst in the subscribe callback, or
          // a stale closure from a prior effect lifecycle), we don't
          // want two concurrent setTimeouts racing to flip the same
          // flag. CodeRabbit feedback on PR #450.
          if (
            recoveryAttemptsRef.current < MAX_RECOVERY_ATTEMPTS &&
            pendingRecoveryTimeoutRef.current === null &&
            typeof document !== "undefined" &&
            !document.hidden
          ) {
            recoveryAttemptsRef.current += 1;
            const attempt = recoveryAttemptsRef.current;
            Sentry.addBreadcrumb({
              category: "realtime",
              message: `event:${eventId} scheduling auto-recovery attempt ${attempt}/${MAX_RECOVERY_ATTEMPTS} in ${RECOVERY_DELAY_MS}ms`,
              level: "info",
              data: { eventId, attempt, delayMs: RECOVERY_DELAY_MS },
            });
            pendingRecoveryTimeoutRef.current = setTimeout(() => {
              pendingRecoveryTimeoutRef.current = null;
              Sentry.addBreadcrumb({
                category: "realtime",
                message: `event:${eventId} auto-recovery attempt ${attempt} firing`,
                level: "info",
                data: { eventId, attempt },
              });
              setPollFallback(false);
            }, RECOVERY_DELAY_MS);
          }
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
      if (boundaryTimer !== null) {
        clearTimeout(boundaryTimer);
      }
      // `removeChannel` both unsubscribes and removes the channel
      // from the supabase-js internal registry. If we only called
      // `channel.unsubscribe()`, the registry would leak the
      // channel name and a remount with the same eventId would
      // reuse the dead channel.
      void supabase.removeChannel(channel);
    };
  }, [eventId, locale, enabled, pollFallback, paused, startTime]);

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
