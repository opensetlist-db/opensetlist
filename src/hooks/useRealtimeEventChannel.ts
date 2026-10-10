"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import * as Sentry from "@sentry/nextjs";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";
import { useSetlistPolling } from "@/hooks/useSetlistPolling";
import { useLiveSnapshot } from "@/hooks/useLiveSnapshot";
import type { FanTop3Entry, ReactionCountsMap } from "@/lib/types/setlist";
import {
  nextEventStatusBoundaryDelay,
  type ResolvedEventStatus,
} from "@/lib/eventStatus";
import {
  RECOVERY_DELAY_MS,
  MAX_RECOVERY_ATTEMPTS,
  isDocumentHidden,
  subscribeToDocumentHidden,
  getDocumentHiddenSnapshot,
  getDocumentHiddenServerSnapshot,
} from "@/lib/realtimeRecovery";
import type { Freshness } from "@/lib/snapshotFreshness";
import {
  HEALTHY_PERIODIC_MS,
  HEALTHY_PERIODIC_SPREAD_MS,
  createLiveScheduler,
} from "@/lib/liveScheduler";

export type { ReactionCountsMap };

declare global {
  interface Window {
    /**
     * Non-production test hooks for the live page. Set from DevTools or
     * Playwright; see `consumeDroppedNotification` below.
     */
    __osl?: { dropNextNotification?: boolean };
  }
}

/**
 * Silent-loss drill (task n14 run #2): with
 * `window.__osl = { dropNextNotification: true }` the hook ignores the
 * next notification for this event exactly once (the flag is cleared),
 * so a tester can prove the periodic repair poll converges the page
 * without the push.
 *
 * Gate: everything except the production deployment. Keyed on
 * `NEXT_PUBLIC_VERCEL_ENV` first because Vercel PREVIEW builds — where
 * run #2 executes — are `next build` output and therefore have
 * `NODE_ENV === "production"`; a NODE_ENV-only gate would compile the
 * drill out of the very environment it exists for. Without the Vercel
 * variable (local dev, tests) NODE_ENV decides.
 */
function consumeDroppedNotification(): boolean {
  const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV;
  const nonProduction = vercelEnv
    ? vercelEnv !== "production"
    : process.env.NODE_ENV !== "production";
  if (!nonProduction || typeof window === "undefined") return false;
  const hooks = window.__osl;
  if (hooks?.dropNextNotification !== true) return false;
  hooks.dropNextNotification = false;
  return true;
}

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
   * schedule a boundary snapshot request at the upcoming → ongoing
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
   * `status`. With Realtime, `/api/setlist` is refetched on push and
   * by the 20 s ± 4 s repair poll, so without this timer a startTime
   * crossing in a no-activity window would leave the
   * polled status stale, and the `polledStatus ?? status`
   * precedence in `LiveEventLayout` would mask a fresh SSR
   * `status` (router.refresh from `<EventStatusTicker>`) with the
   * stale polled value for up to one poll period. The boundary timer
   * here closes that window.
   */
  startTime: string | null;
  /**
   * SSR snapshot revision (`Event.setlistRevision` at render) and its
   * `capturedAt` ISO string. Seed the acceptance watermark so the first
   * client fetch can never roll the server-rendered page back to an
   * older snapshot. Optional: absent → unknown, the first response
   * applies unconditionally (pre-n14 behaviour).
   */
  initialRev?: number | null;
  initialCapturedAt?: string | null;
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
  /**
   * Whether THIS browser is keeping up with the event: client time of
   * the last successful snapshot plus live / retrying / delayed. Drives
   * the 「最終同期 / 更新が遅れています」 indicator in `<LiveSetlist>`.
   * Reflects sync success, not data age — a quiet MC with a healthy
   * channel stays "live". See `src/lib/snapshotFreshness.ts`.
   */
  freshness: Freshness;
  /** Revision of the snapshot on screen (SSR seed until the first fetch). */
  rev: number | null;
  /**
   * `capturedAt` (ISO) of the snapshot on screen. Passed down to
   * `<ReactionButtons>` as `snapshotCapturedAt` for the reaction ack
   * hold. Advances on every applied fetch, periodic ones included.
   */
  capturedAt: string | null;
}

/**
 * Realtime-push variant of `useSetlistPolling`. Same API, same return
 * shape, picked between by `LAUNCH_FLAGS.realtimeEnabled` inside
 * `LiveEventLayout`.
 *
 * Channel: `event:{eventId}` carries SetlistItem changes only. Every
 * slice the page shows — items, reaction counts, wish TOP-3, status —
 * comes from the `/api/setlist` snapshot; a push is just a NOTIFICATION
 * that a new snapshot exists.
 *
 * n14 (R1) — why the per-row Realtime paths are gone: postgres_changes
 * does not scale past ~100 subscribers on our project (DB-side
 * subscription registration runs at ~3–9/s; a SetlistItem INSERT
 * reached 0/300 subscribers in the n12 probe). The SetlistItemReaction
 * diff-merge (Path A) and the SongWish refetch therefore stopped
 * carrying their weight and only added registrations; reaction counts
 * and wishes now arrive with the snapshot (the periodic repair poll
 * below keeps them ≤ ~24 s fresh), and the tapping viewer's own count
 * is held by `<ReactionButtons>`' ack watermark. EventImpression no
 * longer uses Realtime either (`useImpressionPolling` only).
 *
 *   - SetlistItem → notification. The handler scope-checks the row's
 *     eventId and asks the shared scheduler (`src/lib/liveScheduler.ts`)
 *     for a fetch: jittered U(0, 500 ms), at most one per second per
 *     client, single-flight with one dirty follow-up. R2 replaces this
 *     source with the transactional `rev` broadcast; the scheduler and
 *     acceptance rule stay.
 *
 *   - Periodic repair poll every 20 s ± 4 s while the tab is visible
 *     (the channel effect — and with it the scheduler — is torn down
 *     while hidden). Before n14 the hook never fetched while "healthy",
 *     so a viewer whose subscription silently never registered sat on
 *     SSR data indefinitely.
 *
 *   - Acceptance (`src/lib/snapshotAcceptance.ts`): a response is shown
 *     only if its `(rev, capturedAt)` is not older than what is on
 *     screen; every request sends `?minRev=` with the highest revision
 *     the server has shown us, so the server's repair path can rebuild a
 *     stale cache entry.
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
 *   - Refetch on every `SUBSCRIBED`: if the channel briefly drops and
 *     reconnects before the retry budget is exhausted (supabase-js
 *     handles this internally), `SUBSCRIBED` fires again and the
 *     refetch fills any pushes that landed during the drop window.
 *     The FIRST `SUBSCRIBED` refetches too (catch-up): the seed
 *     fetch is issued before the channel is live, so a write landing
 *     between the seed's DB read and subscription activation would
 *     otherwise be invisible until the next unrelated push.
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
 *     visibility return we re-subscribe and fetch a snapshot to
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
 *
 * Snapshot freshness (bounded retries + indicator):
 *
 *   - Every snapshot request carries an 8 s deadline. A non-OK
 *     response, a thrown network/JSON error, a deadline expiry, or a
 *     response older than a revision the server already showed us
 *     schedules a retry on the 1/2/4/8/15/30 s (±20 %) schedule,
 *     honouring `Retry-After`; after the 30 s step it keeps retrying
 *     every ~30 s for as long as the channel effect is alive (i.e.
 *     while the tab is visible — hiding tears the effect down and
 *     with it the retry timer). Any newer explicit trigger (a push, a
 *     reconnect) supersedes a pending retry; periodic ticks wait for
 *     it; success resets the schedule. A `Retry-After` is also a
 *     floor for EVERY trigger (the scheduler's `notBeforeAt`): a burst
 *     of pushes during a 503 window waits it out instead of
 *     superseding the retry.
 *
 *   - A snapshot failure does NOT flip `pollFallback`. If the DB is
 *     what's struggling, switching every viewer to 5 s polling would
 *     add load exactly when it hurts. R3 stays tied to channel-level
 *     CHANNEL_ERROR / TIMED_OUT.
 *
 *   - `freshness` reports live → retrying (1–2 failures, silent) →
 *     delayed (≥ 3 failures, or a channel fallback until polling has
 *     produced a newer sync than realtime last did).
 */
export function useRealtimeEventChannel<T>({
  eventId,
  initialItems,
  initialReactionCounts,
  initialTop3Wishes,
  locale,
  enabled,
  startTime,
  initialRev,
  initialCapturedAt,
}: UseRealtimeEventChannelOptions<T>): UseRealtimeEventChannelResult<T> {
  // Snapshot state, acceptance watermark, and the request runner
  // (deadline + n13 failure bookkeeping) — shared with
  // useSetlistPolling. The failure count inside is hook-scoped, so the
  // "delayed" indicator survives the channel effect re-running on a
  // visibility pause or a fallback recovery attempt.
  const { data: snapshot, createRunner } = useLiveSnapshot<T>({
    eventId,
    locale,
    initialItems,
    initialReactionCounts,
    initialTop3Wishes,
    initialRev,
    initialCapturedAt,
  });

  // R3: fallback gate. Flips to true on CHANNEL_ERROR / TIMED_OUT.
  // Adding it to the realtime effect's deps means the effect re-runs
  // (cleanup → realtime channel torn down) the moment we flip, which
  // is what we want. R3.5 (PR for Sentry issue 7485048757) allows
  // controlled flips back to false via either (a) the bounded
  // setTimeout-based auto-recovery scheduled from the CHANNEL_ERROR
  // handler, or (b) the visibility-resume path when the prior fallback
  // happened in a backgrounded tab.
  const [pollFallback, setPollFallback] = useState(false);

  // R3.5: visibility-driven pause gate. Tied directly to
  // `document.hidden` via `useSyncExternalStore` — React's blessed
  // pattern for subscribing component state to an external reactive
  // source. Replaces the earlier useState + visibility-listener
  // useEffect pair, which the push-review hook on PR #452 flagged
  // (lazy initializer = hydration hazard; mount-time `setState` in
  // an effect body = `react-hooks/set-state-in-effect` violation).
  //
  // The store's three callbacks: subscribe attaches/detaches the
  // listener (React calls them automatically on mount/unmount);
  // getSnapshot reads the current value during render; the SSR
  // snapshot returns a constant `false` so server-rendered HTML is
  // identical to client first-render HTML (React reconciles the
  // post-hydration `document.hidden` read into state on the next
  // tick if they differ — no manual sync needed).
  //
  // Semantics unchanged vs the prior `paused` state: `pollFallback`
  // means "realtime is dead, polling takes over"; `paused` means
  // "user can't see this tab, don't hold a heartbeat-throttled
  // channel". Polling stays in its current enabled/disabled state
  // across the pause — the browser throttles `setInterval` the same
  // way it throttles the socket.
  const paused = useSyncExternalStore(
    subscribeToDocumentHidden,
    getDocumentHiddenSnapshot,
    getDocumentHiddenServerSnapshot,
  );

  // R3.5: latest-value refs so the visibility listener (mounted once
  // in a separate effect with `[]` deps) can read current state
  // without re-subscribing on every render. Same "latest ref" pattern
  // as `useImpressionPolling`'s `onUpdateRef`.
  const pollFallbackRef = useRef(pollFallback);
  useEffect(() => {
    pollFallbackRef.current = pollFallback;
  }, [pollFallback]);

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
    // Seed the fallback with what realtime has actually applied (SSR
    // values until the first fetch lands), not the SSR props: a stale
    // cache answering the first poll must not roll the page back below
    // what the viewer already saw. Polling adopts it on enable.
    initialRev: snapshot.rev,
    initialCapturedAt: snapshot.capturedAt,
  });

  // Server-directed `Retry-After` floor (clock ms) carried from one
  // channel session's scheduler to the next — see
  // `LiveSchedulerOptions.initialNotBeforeAt`. Not reset on event
  // change: the floor is back-pressure from the shared snapshot
  // endpoint, not a property of one event.
  const retryFloorRef = useRef<number | null>(null);

  // Once-per-session latch for the Sentry captureMessage. The
  // breadcrumb stream still records every transition, but a sustained
  // outage shouldn't generate one captureMessage per status flip —
  // operators only need the first signal that this session fell back.
  const hasReportedFallbackRef = useRef(false);

  // Event change: the snapshot state itself is re-seeded inside
  // useLiveSnapshot (same "track previous prop" idiom). Here only the
  // channel-level gate is reset.
  const [prevEventId, setPrevEventId] = useState(eventId);
  if (prevEventId !== eventId) {
    setPrevEventId(eventId);
    // The fallback gate stays sticky — if we fell back on event A,
    // navigating to event B gets a fresh attempt at realtime. This
    // matches "user refresh = fresh retry" semantics. Matching ref
    // resets live INSIDE the channel-setup effect below: refs are
    // bound to the channel's lifetime, and the channel restarts on
    // any of [eventId, locale, enabled, pollFallback, paused] changing.
    setPollFallback(false);
    // No `setPaused(...)` here: `paused` is now derived from
    // `useSyncExternalStore` (see the declaration above), so visibility
    // state stays in sync without any manual reset — covers both
    // mount-in-background-tab and programmatic-navigation-while-hidden
    // cases for free.
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

  // R3.5: visibility-transition side effects. `paused` itself is
  // driven by `useSyncExternalStore` above (channel cleanup on hide
  // / re-subscribe on resume happens via the channel-setup effect's
  // dep on `paused`); this effect runs ONLY for the cross-cutting
  // bookkeeping that those transitions trigger:
  //
  //   - On hide (paused: false → true): cancel any pending recovery
  //     timer (no point spinning up a channel we're about to tear
  //     down). The gap-fill on resume needs no bookkeeping: the
  //     re-run channel effect seeds a snapshot and every SUBSCRIBED
  //     refetches.
  //
  //   - On resume (paused: true → false): if we'd already fallen
  //     back to polling while hidden, give realtime a fresh shot.
  //     Reset the recovery budget — background-throttle failures
  //     aren't real network/server problems and shouldn't count
  //     against visible-tab attempts.
  //
  // `prevPausedRef` discriminates direction so we don't re-fire the
  // hide side effects on every re-render that happens to commit
  // while paused. The `eslint-disable-next-line` comments below
  // suppress `react-hooks/set-state-in-effect` — the setState here
  // IS the intentional sync from external (DOM) visibility state to
  // React, which is the precise use case React.dev calls out as
  // legitimate. The cascading render is the design.
  const prevPausedRef = useRef(paused);
  useEffect(() => {
    const wasPrev = prevPausedRef.current;
    prevPausedRef.current = paused;
    if (!wasPrev && paused) {
      if (pendingRecoveryTimeoutRef.current !== null) {
        clearTimeout(pendingRecoveryTimeoutRef.current);
        pendingRecoveryTimeoutRef.current = null;
      }
    } else if (wasPrev && !paused) {
      if (pollFallbackRef.current) {
        recoveryAttemptsRef.current = 0;
        setPollFallback(false);
      }
    }
  }, [paused]);

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

    // `hasReportedFallbackRef` is deliberately NOT reset per channel
    // setup — it's a per-session latch (eventId-scoped, see the
    // eventId-change block above). With R3.5 auto-recovery the effect
    // re-runs on every retry attempt; resetting the latch here would
    // re-fire the captureMessage on every recovery cycle's failure,
    // defeating the "one capture per session" invariant the operator
    // relies on.

    // ──── Snapshot requests ────
    // One runner (request mechanics: URL + `minRev`, 8 s deadline,
    // acceptance, n13 failure bookkeeping — see useLiveSnapshot) and
    // one scheduler (WHEN to fetch — see src/lib/liveScheduler.ts) per
    // channel session. Both die with this effect: hiding the tab, a
    // fallback flip, or an event change stops every timer, including
    // the periodic repair poll and a pending retry.
    const runner = createRunner(({ failures, delayMs, reason }) => {
      Sentry.addBreadcrumb({
        category: "realtime",
        message: `event:${eventId} snapshot failed (${failures} consecutive), retry in ${delayMs}ms`,
        level: "warning",
        data: { eventId, failures, delayMs, reason },
      });
    });
    const scheduler = createLiveScheduler({
      runFetch: runner.runFetch,
      periodic: {
        intervalMs: HEALTHY_PERIODIC_MS,
        spreadMs: HEALTHY_PERIODIC_SPREAD_MS,
        // The seed below covers t = 0.
        firstTick: "interval",
      },
      // A Retry-After window opened by the previous session (e.g. a
      // tab re-shown inside it) still holds for this one.
      initialNotBeforeAt: retryFloorRef.current,
    });
    scheduler.start();

    // Seed: initial mount, and the re-run after a visibility resume or
    // a fallback recovery (gap-fill for the away window).
    scheduler.requestFetch("catchup");

    // Network came back: whatever was pushed meanwhile is lost, and a
    // pending retry may be up to 30 s out — fetch now.
    const handleOnline = () => scheduler.requestFetch("resume");
    window.addEventListener("online", handleOnline);

    // ──── Status-boundary scheduler ────
    // Self-rescheduling setTimeout that requests a snapshot at each
    // event-status boundary (upcoming → ongoing at startTime, then
    // ongoing → completed at startTime + ONGOING_BUFFER_MS). After
    // the first boundary fires and the snapshot lands, the
    // recursive call queries the helper for the NEXT boundary —
    // which becomes the completed flip — and schedules again. After
    // the second boundary, the helper returns null and the chain
    // ends. The post-first-boundary snapshot also flips
    // polledStatus to "ongoing", which propagates up to the
    // wishlist + predicted-setlist editor lock without waiting for
    // an unrelated push. (The 20 s periodic poll would get there too;
    // the boundary timer makes the flip prompt.)
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
        scheduler.requestFetch("manual");
        scheduleNextStatusBoundary();
      }, delayMs);
    };
    scheduleNextStatusBoundary();

    const currentEventIdStr = String(eventId);

    // ──── Notification scope-check ────
    //
    // The SetlistItem subscription (the R1 notification source) carries
    // NO server-side `filter: eventId=eq.X`
    // — the filter was dropped 2026-05-16 to sidestep Supabase Realtime's
    // stale filter-validation cache (see the subscription blocks below
    // and prisma/post-deploy.sql). Without a server-side filter, a write
    // to ANY event's SetlistItem row is delivered to EVERY
    // subscriber of EVERY `event:{id}` channel. The original handlers
    // refetched unconditionally, on the (then-reasonable) assumption that
    // cross-event pushes were "a few wasted refetches per minute."
    //
    // That assumption broke once the catalog grew to many concurrently-
    // active events (multi-IP onboarding): bulk-importing or editing one
    // IP's setlist rows fans a full /api/setlist refetch out to every
    // live viewer of every OTHER event. Post-F24 each refetch is ~83 KB
    // on the (uncompressed) Supabase pooler wire, and that pooler hop is
    // ~99.9% of our Free-tier egress — so the cross-event fan-out, not
    // the per-call size, is what holds egress flat on live days when
    // other events are being edited.
    //
    // The fix is a client-side scope-check (NOT a server-side filter, so
    // it's immune to the validator-cache bug): compare the pushed row's
    // eventId — present on INSERT/UPDATE via `payload.new` and on DELETE
    // via `payload.old`, both populated because SetlistItem is REPLICA
    // IDENTITY FULL (prisma/post-deploy.sql) — against this page's
    // eventId, and only notify the scheduler on a match. If eventId is
    // absent (REPLICA IDENTITY
    // misconfigured or an unexpected payload shape) we fall through and
    // refetch — correctness over efficiency.
    const scopedRefetch = (payload: {
      new?: { eventId?: number | string | bigint | null } | null;
      old?: { eventId?: number | string | bigint | null } | null;
    }) => {
      const pushedEventId = payload.new?.eventId ?? payload.old?.eventId;
      if (
        pushedEventId != null &&
        String(pushedEventId) !== currentEventIdStr
      ) {
        return;
      }
      if (consumeDroppedNotification()) {
        Sentry.addBreadcrumb({
          category: "realtime",
          message: `event:${eventId} notification dropped (__osl.dropNextNotification drill)`,
          level: "info",
          data: { eventId },
        });
        return;
      }
      // A notification only marks the snapshot stale; the scheduler
      // decides when to fetch (jitter, cooldown, single-flight).
      scheduler.requestFetch("notification");
    };

    // ──── Channel subscription ────
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`event:${eventId}`)
      // SetlistItem — notification (scheduler fetches the snapshot).
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
      // the SetlistItem filter too — same refetch-on-push pattern,
      // same risk surface. The server-side filter is replaced by the
      // client-side `scopedRefetch` guard (see its JSDoc above): the
      // handler reads the pushed row's eventId from the WAL payload we
      // already receive and refetches only on a match, so cross-event
      // pushes cost an O(1) check instead of a wasted ~83 KB refetch.
      // Client-side scoping (perf optimization) < server-side filter
      // risk (subscription rejected by the stale validator cache).
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "SetlistItem",
        },
        (payload) => {
          // Scope-check the pushed row's eventId before refetching —
          // see the scopedRefetch JSDoc above. Cross-event SetlistItem
          // writes (e.g. another IP's bulk import) no longer fan a
          // refetch out to this event's live viewers.
          scopedRefetch(payload);
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
          // Catch-up on EVERY SUBSCRIBED — initial join, supabase-js
          // reconnect after a transient drop, and the re-subscribe
          // after a visibility resume all need it:
          //
          //   - Initial join: the seed request above runs BEFORE the
          //     channel is live. A write that commits between the
          //     seed's read and this moment is in neither the seed nor
          //     any push. If the seed is still in flight, the scheduler
          //     marks itself dirty and runs exactly one follow-up after
          //     the seed settles (its read then starts after
          //     activation) — no abort, so no wasted server work.
          //   - Reconnect / resume (gap-fill): pushes that landed while
          //     the socket was down are lost; the snapshot converges.
          //
          // SUBSCRIBED does not prove postgres_changes delivery
          // (registration lags join by tens of seconds under load —
          // n12); the periodic repair poll covers that window.
          scheduler.requestFetch("catchup");
          return;
        }

        if (
          channelStatus === "CHANNEL_ERROR" ||
          channelStatus === "TIMED_OUT"
        ) {
          // R3.5: if the tab is hidden, ignore the error entirely.
          // The "visibility-driven teardown is silent" contract must
          // hold across every reachable path — a stale subscribe
          // callback firing after the visibility hide handler has
          // already torn the channel down (rare but possible if
          // supabase-js queued the status transition before the
          // `removeChannel` took effect) would otherwise (a) emit a
          // captureMessage from a tab the user can't see (noise),
          // (b) flip `pollFallback` to true and engage
          // `useSetlistPolling` against a backgrounded tab (wasted
          // 5s polling cycles the user won't see), and (c) consume
          // a recovery budget attempt against what's really a
          // background-throttle artifact. The visibility resume path
          // handles re-subscribe with a fresh budget regardless.
          // CodeRabbit feedback on PR #452.
          if (isDocumentHidden()) return;

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

          // R3.5: bounded auto-recovery. Each attempt counts against
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
          //
          // No `!document.hidden` re-check here — the early-return
          // above already filtered hidden-tab errors out of this
          // entire branch.
          if (
            recoveryAttemptsRef.current < MAX_RECOVERY_ATTEMPTS &&
            pendingRecoveryTimeoutRef.current === null
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
      // Dispose the scheduler first so a request settling during the
      // abort below can't arm a retry or a follow-up; the abort then
      // resolves every in-flight request as cancelled (never a
      // failure). Unlike pre-n14, an abort only ever happens here —
      // nothing supersedes an in-flight request any more.
      retryFloorRef.current = scheduler.getState().notBeforeAt;
      scheduler.dispose();
      runner.abort();
      if (boundaryTimer !== null) {
        clearTimeout(boundaryTimer);
      }
      window.removeEventListener("online", handleOnline);
      // `removeChannel` both unsubscribes and removes the channel
      // from the supabase-js internal registry. If we only called
      // `channel.unsubscribe()`, the registry would leak the
      // channel name and a remount with the same eventId would
      // reuse the dead channel.
      void supabase.removeChannel(channel);
    };
  }, [eventId, locale, enabled, pollFallback, paused, startTime, createRunner]);

  // R3: fallback return shape. When polling has taken over, prefer
  // its state — but during the warmup window (first poll hasn't
  // landed yet, so polled.lastUpdated is still null), keep showing
  // realtime's last-known state so the user doesn't see a flash of
  // stale SSR initialItems for ≤5s.
  if (pollFallback) {
    const polledReady = polled.lastUpdated !== null;
    return {
      items: polledReady ? polled.items : snapshot.items,
      reactionCounts: polledReady
        ? polled.reactionCounts
        : snapshot.reactionCounts,
      top3Wishes: polledReady ? polled.top3Wishes : snapshot.top3Wishes,
      status: polled.status ?? snapshot.status,
      lastUpdated: polled.lastUpdated ?? snapshot.lastUpdated,
      freshness: fallbackFreshness(snapshot.freshness, polled.freshness),
      // rev/capturedAt follow the data actually on screen, so the
      // reaction ack hold compares against the snapshot it is shown
      // next to.
      rev: polledReady ? polled.rev : snapshot.rev,
      capturedAt: polledReady ? polled.capturedAt : snapshot.capturedAt,
    };
  }

  return snapshot;
}

/**
 * Freshness while R3 polling owns the page. Realtime's own snapshots
 * stop the moment `pollFallback` flips (the channel effect early-
 * returns), so its `lastSyncAt` is frozen at the hand-off. Polling is
 * "driving" only once it has synced MORE RECENTLY than that — its
 * state can carry over from an earlier fallback stint in the same
 * session, so `lastSyncAt !== null` alone would misreport. Until then
 * the page is not updating and says so ("delayed"); after, polling's
 * own live / retrying / delayed applies — a healthy 5 s poll is an
 * honest "last sync" clock, not a warning.
 */
function fallbackFreshness(realtime: Freshness, polled: Freshness): Freshness {
  const realtimeAt = realtime.lastSyncAt?.getTime() ?? -Infinity;
  if (polled.lastSyncAt && polled.lastSyncAt.getTime() > realtimeAt) {
    return polled;
  }
  return { lastSyncAt: realtime.lastSyncAt, state: "delayed" };
}
