"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import * as Sentry from "@sentry/nextjs";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";
import { useLiveSnapshot } from "@/hooks/useLiveSnapshot";
import type { FanTop3Entry, ReactionCountsMap } from "@/lib/types/setlist";
import {
  nextEventStatusBoundaryDelay,
  type ResolvedEventStatus,
} from "@/lib/eventStatus";
import {
  HEALTHY_BUDGET_RESET_MS,
  MAX_RECREATE_ATTEMPTS,
  REJOIN_GRACE_MS,
  recreateBackoffMs,
  isDocumentHidden,
  subscribeToDocumentHidden,
  getDocumentHiddenSnapshot,
  getDocumentHiddenServerSnapshot,
} from "@/lib/realtimeRecovery";
import type { Freshness } from "@/lib/snapshotFreshness";
import {
  FALLBACK_POLL_MS,
  FALLBACK_POLL_SPREAD_MS,
  HEALTHY_PERIODIC_MS,
  HEALTHY_PERIODIC_SPREAD_MS,
  createLiveScheduler,
  type LiveFetchReason,
  type PeriodicConfig,
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

/** Healthy path: notifications + a slow repair poll (seed covers t = 0). */
const HEALTHY_CADENCE: PeriodicConfig = {
  intervalMs: HEALTHY_PERIODIC_MS,
  spreadMs: HEALTHY_PERIODIC_SPREAD_MS,
  firstTick: "interval",
};

/**
 * Polling while the channel is disconnected: the R3 fallback cadence,
 * with a random first tick so a population that dropped together does
 * not poll in lock-step.
 */
const DISCONNECTED_CADENCE: PeriodicConfig = {
  intervalMs: FALLBACK_POLL_MS,
  spreadMs: FALLBACK_POLL_SPREAD_MS,
  firstTick: "random-phase",
};

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
 * shape (`LiveEventLayout` calls this one).
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
 * ONE data source. Every request this hook makes — seed, notification,
 * catch-up, healthy repair poll, polling while disconnected, retry —
 * goes through one `useLiveSnapshot` (one acceptance watermark, one
 * failure count) and one scheduler per channel session. The polling
 * fallback used to be a second `useSetlistPolling` instance with its
 * own state, and the return value picked between the two; the hand-over
 * in either direction could then render a lower `rev` than the other
 * source had already shown. With one source the rendered snapshot is
 * monotonic in `(rev, capturedAt)` across every transition by
 * construction.
 *
 * Channel recovery — a state machine owned by ONE effect, keyed on
 * (eventId, locale, enabled, paused, startTime); the connection state
 * lives in that effect's closure and is never a React dependency, so a
 * channel error can no longer re-run the effect and tear the channel
 * down. realtime-js reconnects the socket and rejoins the channel by
 * itself (1/2/5/10 s socket backoff, 1/2/5 s rejoin backoff — see
 * `src/lib/realtimeRecovery.ts`); the hook's job is to keep the page
 * fresh while that happens and to step in only when it doesn't:
 *
 *   joining ──SUBSCRIBED──▶ subscribed ──CHANNEL_ERROR / TIMED_OUT──▶
 *   disconnected ──SUBSCRIBED──▶ subscribed …
 *
 *   - joining (mount / resume): healthy cadence (20 s ± 4 s); the seed
 *     covers t = 0.
 *   - subscribed: healthy cadence; every `SUBSCRIBED` (first join or a
 *     rejoin after a gap) requests a jittered catch-up — pushes that
 *     landed during the gap are lost, and the seed ran before the
 *     channel was live. After `HEALTHY_BUDGET_RESET_MS` (5 min) of
 *     continuous health the re-creation budget is refunded.
 *   - disconnected (`CHANNEL_ERROR`, `TIMED_OUT`, or an unexpected
 *     `CLOSED` on the current channel): the channel object is KEPT and
 *     the same scheduler switches to the fallback cadence (5 s ± 1 s,
 *     random first tick). A recovery timer is armed for
 *     `REJOIN_GRACE_MS` (60 s) + `recreateBackoffMs(n)` (5–15 s,
 *     10–30 s, 20–60 s). `SUBSCRIBED` before it fires cancels it and
 *     returns to the healthy cadence (+ catch-up). If it fires, the
 *     channel is removed and re-created (attempt n of
 *     `MAX_RECREATE_ATTEMPTS` = 3) and the timer is re-armed for the
 *     next attempt. With the budget spent the hook stops adding joins
 *     but keeps the last channel — realtime-js may still bring it back.
 *     Repeated errors while already disconnected change nothing.
 *   - hidden tab: unchanged R3.5 behaviour — the effect tears the
 *     channel down while `document.hidden` (background tabs get their
 *     heartbeats throttled into spurious errors) and re-runs on return
 *     with a fresh budget and a jittered "resume" gap-fill. Errors that
 *     arrive while hidden are ignored.
 *
 * Load safety (the n12 lesson — nothing may make 500 tabs act in the
 * same instant): the 60 s grace absorbs everything realtime-js can
 * recover itself; the re-creation backoff is randomized over ≥ 10 s;
 * the disconnected poll starts at a random phase; the catch-up after a
 * mass rejoin is jittered and cooled down by the scheduler.
 *
 * Sentry: one breadcrumb per state TRANSITION (→ disconnected with the
 * raw status, → subscribed with the gap length, each re-creation, budget
 * exhausted), never per realtime-js retry; one `captureMessage`
 * ("Realtime fallback to polling") on the first disconnect per event
 * per page, so the operator learns that a viewer dropped at all without
 * flap reports. Sentry "Users affected" is pinned at 0 (no setUser,
 * sendDefaultPii false), so "Events" count IS the signal.
 *
 * Operator kill switch: `enabled = false` (from `LiveEventLayout`)
 * makes this hook a no-op that shows the SSR data.
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
 *   - A snapshot failure does NOT switch the page to the disconnected
 *     cadence. If the DB is what's struggling, polling every 5 s would
 *     add load exactly when it hurts. The cadence follows the CHANNEL
 *     state only.
 *
 *   - `freshness` reports live → retrying (1–2 failures, silent) →
 *     delayed (≥ 3 failures). A channel disconnect alone does not flag
 *     "delayed": the page keeps syncing every 5 s through it, and
 *     `lastSyncAt` stays an honest clock.
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
  // (deadline + n13 failure bookkeeping). The failure count inside is
  // hook-scoped, so the "delayed" indicator survives the channel effect
  // re-running on a visibility pause.
  const { data: snapshot, createRunner } = useLiveSnapshot<T>({
    eventId,
    locale,
    initialItems,
    initialReactionCounts,
    initialTop3Wishes,
    initialRev,
    initialCapturedAt,
  });

  // R3.5: visibility-driven pause gate, tied directly to
  // `document.hidden` via `useSyncExternalStore` — React's blessed
  // pattern for subscribing component state to an external reactive
  // source (a lazy useState initializer would be a hydration hazard;
  // a mount-time setState in an effect trips
  // `react-hooks/set-state-in-effect`). The SSR snapshot is a constant
  // `false` so server HTML matches the client's first render.
  //
  // `paused` means "the user can't see this tab, don't hold a
  // heartbeat-throttled channel": the channel effect tears down and
  // re-runs on return.
  const paused = useSyncExternalStore(
    subscribeToDocumentHidden,
    getDocumentHiddenSnapshot,
    getDocumentHiddenServerSnapshot,
  );

  // Server-directed `Retry-After` floor (clock ms) carried from one
  // channel session's scheduler to the next — see
  // `LiveSchedulerOptions.initialNotBeforeAt`. Not reset on event
  // change: the floor is back-pressure from the shared snapshot
  // endpoint, not a property of one event.
  const retryFloorRef = useRef<number | null>(null);

  // `eventId\0locale` of the last channel session that seeded. A
  // session whose key matches is a re-run (visibility resume, …) and
  // seeds with the jittered "resume"; a new key is a page load or an
  // event switch and seeds immediately ("initial").
  const seededKeyRef = useRef<string | null>(null);

  // Once-per-event latch for the Sentry captureMessage. The breadcrumb
  // stream records every transition, but a sustained outage or a
  // flapping network shouldn't generate one captureMessage per flip —
  // operators only need the first signal that this viewer dropped.
  // Event-scoped (not per channel session): the effect re-runs on every
  // visibility resume, and resetting there would re-fire the capture.
  const hasReportedFallbackRef = useRef(false);
  useEffect(() => {
    hasReportedFallbackRef.current = false;
  }, [eventId]);

  useEffect(() => {
    if (!enabled) return;
    // R3.5: no channel (and no polling) while the tab is hidden.
    if (paused) return;

    // ──── Snapshot requests ────
    // One runner (request mechanics: URL + `minRev`, 8 s deadline,
    // acceptance, n13 failure bookkeeping — see useLiveSnapshot) and
    // one scheduler (WHEN to fetch — see src/lib/liveScheduler.ts) per
    // channel session. Both die with this effect: hiding the tab or an
    // event change stops every timer, including the periodic poll and
    // a pending retry. A channel error does NOT end the session.
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
      periodic: HEALTHY_CADENCE,
      // A Retry-After window opened by the previous session (e.g. a
      // tab re-shown inside it) still holds for this one.
      initialNotBeforeAt: retryFloorRef.current,
    });
    scheduler.start();

    // Seed. The first session of this event/locale on this page is the
    // page load ("initial": immediate — page loads are spread by the
    // viewers themselves). Any later session is a re-run after a
    // visibility resume (gap-fill for the away window), jittered like
    // every other trigger that can hit many viewers at once.
    const sessionKey = `${eventId}\u0000${locale}`;
    const seedReason: LiveFetchReason =
      seededKeyRef.current === sessionKey ? "resume" : "initial";
    seededKeyRef.current = sessionKey;
    scheduler.requestFetch(seedReason);

    // Network came back: whatever was pushed meanwhile is lost, and a
    // pending retry may be up to 30 s out — fetch soon. Jittered: an
    // `online` event fires for a whole venue's Wi-Fi at once.
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
        // Every viewer's timer fires at the same startTime — jittered
        // by the scheduler like the other correlated triggers.
        scheduler.requestFetch("boundary");
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
    // stale filter-validation cache (see the subscription block below
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

    // ──── Channel state machine (see the hook's JSDoc) ────
    const supabase = getSupabaseBrowserClient();
    type Channel = ReturnType<typeof supabase.channel>;

    let disposed = false;
    let connection: "joining" | "subscribed" | "disconnected" = "joining";
    let channel: Channel | null = null;
    // Identity of the current channel's subscribe callback. Bumped when
    // a channel is retired, so a late status from a removed channel
    // (its CLOSED after `removeChannel`, a queued CHANNEL_ERROR) can
    // never drive the state of its replacement.
    let channelSeq = 0;
    let disconnectedAt = 0;
    let recreateAttempts = 0;
    let budgetExhaustedReported = false;
    let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
    let healthyTimer: ReturnType<typeof setTimeout> | null = null;

    const clearRecoveryTimer = () => {
      if (recoveryTimer !== null) {
        clearTimeout(recoveryTimer);
        recoveryTimer = null;
      }
    };
    const clearHealthyTimer = () => {
      if (healthyTimer !== null) {
        clearTimeout(healthyTimer);
        healthyTimer = null;
      }
    };

    const openChannel = () => {
      const seq = ++channelSeq;
      try {
        channel = supabase
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
          // client-side `scopedRefetch` guard (see its comment above):
          // the handler reads the pushed row's eventId from the WAL
          // payload we already receive and refetches only on a match, so
          // cross-event pushes cost an O(1) check instead of a wasted
          // ~83 KB refetch. Client-side scoping (perf optimization) <
          // server-side filter risk (subscription rejected by the stale
          // validator cache).
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "SetlistItem",
            },
            (payload) => {
              if (disposed || seq !== channelSeq) return;
              scopedRefetch(payload);
            },
          )
          .subscribe((channelStatus) => onStatus(seq, channelStatus));
      } catch (error) {
        // realtime-js returns an existing channel for a topic that is
        // still registered (a removal whose leave was not acked), and
        // re-subscribing a closed, once-joined channel throws. Nothing
        // to do but wait: the recovery timer (armed by the caller) is
        // the retry, and polling keeps the page fresh meanwhile.
        channel = null;
        Sentry.addBreadcrumb({
          category: "realtime",
          message: `event:${eventId} channel subscribe threw`,
          level: "warning",
          data: { eventId, error: String(error) },
        });
      }
    };

    // Recovery timer: grace for realtime-js's own rejoin, then a
    // randomized backoff, then re-create — bounded by the budget.
    const armRecovery = () => {
      if (recoveryTimer !== null) return;
      if (recreateAttempts >= MAX_RECREATE_ATTEMPTS) {
        if (!budgetExhaustedReported) {
          budgetExhaustedReported = true;
          Sentry.addBreadcrumb({
            category: "realtime",
            message: `event:${eventId} channel re-creation budget exhausted (${MAX_RECREATE_ATTEMPTS}); polling until realtime-js rejoins`,
            level: "warning",
            data: { eventId, attempts: recreateAttempts },
          });
        }
        return;
      }
      const attempt = recreateAttempts + 1;
      const delayMs = REJOIN_GRACE_MS + recreateBackoffMs(attempt);
      recoveryTimer = setTimeout(() => {
        recoveryTimer = null;
        if (disposed || connection !== "disconnected") return;
        recreateAttempts = attempt;
        Sentry.addBreadcrumb({
          category: "realtime",
          message: `event:${eventId} re-creating channel (attempt ${attempt}/${MAX_RECREATE_ATTEMPTS}) after ${Date.now() - disconnectedAt}ms disconnected`,
          level: "info",
          data: { eventId, attempt },
        });
        // Retire the old channel FIRST (its late statuses are ignored
        // from here on), then wait for the removal: realtime-js hands
        // back the registered channel for a topic that is still in its
        // list, so opening before the leave completes would reuse the
        // dead one. On a dropped socket the leave completes at once; on
        // a live one it waits for the ack (bounded by the push timeout).
        // The result value does not matter: phoenix's `leave()` fires
        // the channel's close on BOTH the "ok" ack and the timeout, and
        // close is what deregisters the topic from the socket — only
        // `teardown()` (timer cleanup) is skipped on a timeout, and
        // `leave()` already reset the rejoin timer. Should a stale
        // channel ever be handed back anyway, `openChannel`'s catch and
        // the re-armed recovery timer are the retry.
        channelSeq += 1;
        const old = channel;
        channel = null;
        void (async () => {
          if (old) {
            try {
              await supabase.removeChannel(old);
            } catch {
              // Removal failure leaves nothing for us to clean up; the
              // next attempt (or cleanup) runs regardless.
            }
          }
          if (disposed || connection !== "disconnected") return;
          openChannel();
          // The new channel gets its own grace window + next backoff.
          armRecovery();
        })();
      }, delayMs);
    };

    const enterDisconnected = (channelStatus: string) => {
      clearHealthyTimer();
      if (connection !== "disconnected") {
        connection = "disconnected";
        disconnectedAt = Date.now();
        Sentry.addBreadcrumb({
          category: "realtime",
          message: `event:${eventId} channel status → ${channelStatus} (polling while realtime-js reconnects)`,
          level: "warning",
          data: { eventId, channelStatus, recreateAttempts },
        });
        // First disconnect per event: tell Sentry once.
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
        scheduler.setPeriodic(DISCONNECTED_CADENCE);
      }
      armRecovery();
    };

    const onStatus = (seq: number, channelStatus: string) => {
      // A removed channel, or a callback after cleanup.
      if (disposed || seq !== channelSeq) return;

      if (channelStatus === "SUBSCRIBED") {
        const previous = connection;
        connection = "subscribed";
        clearRecoveryTimer();
        if (previous !== "subscribed") {
          Sentry.addBreadcrumb({
            category: "realtime",
            message: `event:${eventId} channel status → SUBSCRIBED`,
            level: "info",
            data: {
              eventId,
              channelStatus,
              previous,
              gapMs: previous === "disconnected" ? Date.now() - disconnectedAt : 0,
            },
          });
        }
        if (previous === "disconnected") {
          scheduler.setPeriodic(HEALTHY_CADENCE);
        }
        if (healthyTimer === null) {
          healthyTimer = setTimeout(() => {
            healthyTimer = null;
            recreateAttempts = 0;
            budgetExhaustedReported = false;
          }, HEALTHY_BUDGET_RESET_MS);
        }
        // Catch-up on EVERY SUBSCRIBED — initial join and every rejoin
        // after a gap:
        //
        //   - Initial join: the seed request runs BEFORE the channel is
        //     live. A write that commits between the seed's read and
        //     this moment is in neither the seed nor any push. If the
        //     seed is still in flight, the scheduler marks itself dirty
        //     and runs exactly one follow-up after the seed settles (its
        //     read then starts after activation) — no abort, so no
        //     wasted server work.
        //   - Rejoin (gap-fill): pushes that landed while the socket was
        //     down are lost; the snapshot converges.
        //
        // Jittered + cooled down by the scheduler: realtime-js rejoins a
        // whole audience on the same fixed schedule after a server-side
        // drop. SUBSCRIBED does not prove postgres_changes delivery
        // (registration lags join by tens of seconds under load — n12);
        // the periodic repair poll covers that window.
        scheduler.requestFetch("catchup");
        return;
      }

      if (
        channelStatus === "CHANNEL_ERROR" ||
        channelStatus === "TIMED_OUT" ||
        channelStatus === "CLOSED"
      ) {
        // R3.5: if the tab is hidden, ignore the status entirely. The
        // effect is about to tear the channel down (or already has);
        // a status racing that teardown must not send a captureMessage
        // from a tab the user can't see, switch a backgrounded tab to
        // 5 s polling, or spend re-creation budget on what is really a
        // background-throttle artifact. Resume starts a fresh session.
        if (isDocumentHidden()) return;
        // CLOSED on the CURRENT channel (our own removals are filtered
        // by `channelSeq` above) means the server closed it: realtime-js
        // will not rejoin a closed channel, so treat it as a failure and
        // let the recovery timer re-create it.
        enterDisconnected(channelStatus);
      }
    };

    openChannel();

    return () => {
      disposed = true;
      clearRecoveryTimer();
      clearHealthyTimer();
      // Dispose the scheduler first so a request settling during the
      // abort below can't arm a retry or a follow-up; the abort then
      // resolves every in-flight request as cancelled (never a
      // failure). An abort only ever happens here — nothing supersedes
      // an in-flight request.
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
      if (channel) void supabase.removeChannel(channel);
      channel = null;
    };
  }, [eventId, locale, enabled, paused, startTime, createRunner]);

  return snapshot;
}
