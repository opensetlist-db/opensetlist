"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import * as Sentry from "@sentry/nextjs";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";
import {
  RECOVERY_DELAY_MS,
  MAX_RECOVERY_ATTEMPTS,
  isDocumentHidden,
  subscribeToDocumentHidden,
  getDocumentHiddenSnapshot,
  getDocumentHiddenServerSnapshot,
} from "@/lib/realtimeRecovery";
// Import from `src/lib/types/` (cross-layer type module) instead of
// `@/components/EventImpressions` to avoid the hook ↔ component
// circular dependency — EventImpressions imports this hook.
import type { Impression } from "@/lib/types/impression";

interface UseRealtimeImpressionsOptions {
  eventId: string;
  enabled: boolean;
  /**
   * Called for INSERT events that pass the visibility filter, AND
   * for UPDATE events whose new state is visible. The consumer
   * applies the same `mergeImpression(imp)` logic it uses today
   * for POST responses (dedupe-by-rootImpressionId, prepend) — the
   * impression interface here is identical to the polling payload's
   * row shape.
   */
  onUpsert?: (impression: Impression) => void;
  /**
   * Called for DELETE events AND for UPDATE events whose new state
   * is no longer visible (supersededAt set, isDeleted, or isHidden).
   * The consumer removes by `id` from its impressions list. The
   * supersede flow produces an onRemove on the old row id and an
   * onUpsert on the new row — the consumer's existing
   * mergeImpression(byRootId) takes care of the replacement.
   */
  onRemove?: (id: string) => void;
}

interface UseRealtimeImpressionsResult {
  lastUpdated: string | null;
  /**
   * R3: realtime channel exhausted its retry budget (`CHANNEL_ERROR`
   * or `TIMED_OUT`) and the consumer should switch to its polling
   * fallback. Once true, stays true for the page lifetime — no
   * auto-recovery, matching `useRealtimeEventChannel`'s semantics.
   *
   * Different fallback wiring than `useRealtimeEventChannel`: that
   * hook calls `useSetlistPolling` *internally* and seamlessly
   * swaps; this hook coexists with `useImpressionPolling` at the
   * `EventImpressions` call site (because the impressions feed
   * has its own cursor + load-more state owned by the consumer),
   * so the consumer needs to see the flag and decide when to
   * enable polling. Mirrors the `pendingPollCounts` / loading-flag
   * pattern that already governs the consumer's prop-sync logic.
   */
  pollFallback: boolean;
}

// Bare-row shape from the EventImpression `postgres_changes`
// payload. INSERT carries every column on `payload.new`. UPDATE
// + DELETE carry `payload.old` ONLY when REPLICA IDENTITY FULL is
// set on the table — see prisma/post-deploy.sql.
interface ImpressionRowPayload {
  id: string;
  eventId: number | string | bigint;
  rootImpressionId: string;
  content: string;
  locale: string;
  createdAt: string;
  // Visibility-filter columns. Server-side, /api/impressions
  // filters supersededAt IS NULL AND isDeleted = false AND
  // isHidden = false; we mirror that here against the raw row
  // before notifying the consumer.
  supersededAt: string | null;
  isDeleted: boolean;
  isHidden: boolean;
}

function isVisible(row: ImpressionRowPayload): boolean {
  return (
    row.supersededAt === null && row.isDeleted === false && row.isHidden === false
  );
}

function rowToImpression(row: ImpressionRowPayload): Impression {
  return {
    id: row.id,
    rootImpressionId: row.rootImpressionId,
    eventId: String(row.eventId),
    content: row.content,
    locale: row.locale,
    createdAt: row.createdAt,
  };
}

/**
 * Realtime-push variant of `useImpressionPolling`. Drop-in replacement
 * triggered by `LAUNCH_FLAGS.realtimeEnabled` inside
 * `EventImpressions`. Owns its OWN per-event channel
 * (`event:{eventId}:impressions`) so the impressions feed and the
 * setlist feed (`useRealtimeEventChannel`) can be swapped
 * independently — both share the underlying supabase-js WebSocket
 * connection per page.
 *
 * Reconciliation: per-row diff (Path A) into the consumer's existing
 * impressions state via two callbacks:
 *
 *   - onUpsert(impression) — INSERT visible row, OR UPDATE whose
 *     new state is still visible. Consumer's mergeImpression
 *     (dedupe-by-rootImpressionId, prepend) handles both cases:
 *     a brand-new chain INSERTs a new rootImpressionId; an edit
 *     INSERTs a new id sharing an existing rootImpressionId, and
 *     mergeImpression replaces the prior row at the same chain.
 *
 *   - onRemove(id) — UPDATE whose new state is no longer visible
 *     (supersededAt set / isDeleted / isHidden), OR a hard DELETE.
 *     Consumer filters its impressions array by `p.id !== id`.
 *
 * The supersede flow produces ONE onRemove on the old row and ONE
 * onUpsert on the new row. Order doesn't matter — mergeImpression
 * is idempotent on the rootId axis, and the onRemove on a row
 * already replaced is a no-op filter pass.
 *
 * No own-action suppression window: EventImpressions calls
 * mergeImpression synchronously on POST response, and the realtime
 * onUpsert for that same row is a no-op replace. The DELETE/hide
 * flows similarly converge — the consumer's optimistic state
 * already removed the row by rootId before the realtime UPDATE
 * arrives, so the realtime onRemove is a no-op filter.
 *
 * R3 — polling fallback + observability:
 *
 *   - On `CHANNEL_ERROR` / `TIMED_OUT`, expose `pollFallback: true`
 *     in the return shape. EventImpressions watches this flag and
 *     enables `useImpressionPolling` (which is always called
 *     alongside this hook) so the impressions feed keeps updating
 *     via the proven 5/30s polling path.
 *
 *   - Sentry: breadcrumb on every transition (separate category
 *     `realtime-impressions` so it doesn't blur with the setlist
 *     channel's stream); a single `captureMessage` on first
 *     fallback per session.
 *
 * R3.5 — visibility handling + bounded auto-recovery (PR for Sentry
 * issue 7501479492, paired with the setlist channel's identical R3.5
 * patch since the two channels share one WebSocket and fall together).
 *
 *   - `document.visibilitychange` integration. Tab hidden → tear down
 *     the channel proactively (Chrome / Safari background-tab
 *     throttling kills WebSocket heartbeats; better to release the
 *     channel cleanly than let supabase-js exhaust its retry budget
 *     against a throttled socket and emit a CHANNEL_ERROR we then
 *     have to recover from). Tab visible → re-subscribe. No snapshot
 *     refetch on resume — the impressions feed is purely append-
 *     driven, and the consumer's load-more click already surfaces
 *     anything that landed during the away window (same rationale as
 *     the original reconnect-no-refetch decision in this hook's R3
 *     comment block below).
 *
 *   - Bounded time-based auto-recovery for failures while the tab IS
 *     visible (network blip, momentary server reject). After
 *     `pollFallback` flips, schedule a single
 *     `setPollFallback(false)` retry after RECOVERY_DELAY_MS, up to
 *     MAX_RECOVERY_ATTEMPTS per session. Visibility resume from
 *     `pollFallback === true` also triggers an immediate retry with
 *     the budget RESET (background failures don't count).
 *
 *   - `captureMessage` still emits once per session even after
 *     successful recovery — operator gets one signal per session
 *     that "this user dropped at least once," not flap reports.
 */
export function useRealtimeImpressions({
  eventId,
  enabled,
  onUpsert,
  onRemove,
}: UseRealtimeImpressionsOptions): UseRealtimeImpressionsResult {
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [pollFallback, setPollFallback] = useState(false);

  // R3.5: visibility-driven pause gate. Tied directly to
  // `document.hidden` via `useSyncExternalStore` — see the matching
  // declaration in `useRealtimeEventChannel.ts` for the full
  // rationale. Difference from the setlist channel: this hook does
  // no fetchSnapshot-on-resume because impressions are append-driven
  // and the consumer's load-more click already surfaces anything
  // missed during the away window.
  const paused = useSyncExternalStore(
    subscribeToDocumentHidden,
    getDocumentHiddenSnapshot,
    getDocumentHiddenServerSnapshot,
  );

  // R3.5: latest-value ref for the visibility listener (mounted once
  // with [] deps) so its closure reads current `pollFallback` without
  // re-attaching on every render. Same "latest ref" pattern as the
  // existing `onUpsertRef` / `onRemoveRef` below.
  const pollFallbackRef = useRef(pollFallback);
  useEffect(() => {
    pollFallbackRef.current = pollFallback;
  }, [pollFallback]);

  // R3.5: bounded auto-recovery state. `recoveryAttemptsRef` counts
  // attempts across the hook lifetime (or eventId change, whichever
  // comes first); `pendingRecoveryTimeoutRef` holds the currently-
  // scheduled setTimeout id so cleanup (unmount, eventId change,
  // visibility hide) can cancel a pending retry before it fires.
  const recoveryAttemptsRef = useRef(0);
  const pendingRecoveryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Hold callbacks in refs so a fresh callback identity per render
  // doesn't tear down + rebuild the channel subscription. Same
  // "latest ref" pattern as useImpressionPolling. Ref writes go
  // through useEffect — react-hooks/refs forbids ref writes during
  // render.
  const onUpsertRef = useRef(onUpsert);
  const onRemoveRef = useRef(onRemove);
  useEffect(() => {
    onUpsertRef.current = onUpsert;
  }, [onUpsert]);
  useEffect(() => {
    onRemoveRef.current = onRemove;
  }, [onRemove]);

  // Once-per-session latch for the Sentry captureMessage. Mirrors the
  // pattern in useRealtimeEventChannel — sustained outages shouldn't
  // generate one captureMessage per status flip.
  const hasReportedFallbackRef = useRef(false);

  // Reset transient state when eventId changes (mirror the pattern in
  // useRealtimeEventChannel — fresh attempt at realtime per event).
  // The matching ref reset lives INSIDE the channel-setup effect
  // below — channel-bound refs need to reset whenever the channel
  // is re-created, which here means any of `[eventId, enabled,
  // pollFallback]` changing (this hook doesn't take a `locale`
  // option; that's useRealtimeEventChannel). Also reset
  // `lastUpdated` so consumers don't read the previous event's
  // timestamp before any event B push lands.
  const [prevEventId, setPrevEventId] = useState(eventId);
  if (prevEventId !== eventId) {
    setPrevEventId(eventId);
    setPollFallback(false);
    setLastUpdated(null);
    // No `setPaused(...)` here — `paused` is derived from
    // `useSyncExternalStore` (see declaration above) and stays in
    // sync with `document.hidden` automatically across event
    // changes.
  }

  // R3.5: per-event ref cleanup. State setters above are allowed in
  // render (React's "setState during render" pattern), but refs
  // must be mutated outside render. Declared before the channel-
  // setup effect so the cleanup runs first in declaration order.
  useEffect(() => {
    recoveryAttemptsRef.current = 0;
    if (pendingRecoveryTimeoutRef.current !== null) {
      clearTimeout(pendingRecoveryTimeoutRef.current);
      pendingRecoveryTimeoutRef.current = null;
    }
    // R3.5: latch reset moved here from the channel-setup effect-top.
    // Per-eventId is the right boundary — auto-recovery re-runs the
    // channel-setup effect, and resetting per-attempt would defeat
    // the captureMessage's "one per session" invariant.
    hasReportedFallbackRef.current = false;
  }, [eventId]);

  // R3.5: visibility-transition side effects. `paused` itself is
  // driven by `useSyncExternalStore` above; this effect runs only
  // for the bookkeeping that transitions trigger — see the matching
  // block in `useRealtimeEventChannel.ts` for the full rationale.
  // The impressions hook has no `wasPausedRef` analog because it
  // doesn't do fetchSnapshot-on-resume; only the recovery-timer
  // cleanup on hide and the post-resume budget reset on show.
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

  // R3.5: cleanup pending recovery timer on unmount only. The
  // channel-setup effect's cleanup runs on every dep change and would
  // prematurely cancel the very retry it just scheduled — empty-deps
  // unmount-only cleanup is the right shape.
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
    // Once polling has taken over, this effect has cleaned up the
    // dead channel and we skip re-subscribing.
    if (pollFallback) return;
    // R3.5: paused gate. Same shape as the pollFallback early-return
    // — visibility hide tears the channel down without emitting a
    // CHANNEL_ERROR; visibility resume flips paused back to false
    // and this effect re-runs to re-subscribe.
    if (paused) return;

    // R3.5: the latch reset moved OUT of this effect-top to the
    // eventId-change block above. Before R3.5 it was reset here on
    // every channel-setup re-run, since "each channel" was the
    // natural session boundary. With auto-recovery the channel
    // re-subscribes on every retry attempt; resetting per-attempt
    // would re-fire the captureMessage on every recovery cycle's
    // failure and defeat the "one capture per session" invariant.
    // Per-eventId is the right boundary for this latch.

    const supabase = getSupabaseBrowserClient();
    // Pre-computed scope key for each handler's eventId check. The
    // EventImpression subscriptions below drop the `filter:` clause
    // and scope-check `row.eventId` inside each handler instead —
    // see the SetlistItemReaction comment block in
    // useRealtimeEventChannel.ts for the full story. Pre-emptive
    // here: the prod incident on 2026-05-16 took out three of four
    // filtered subscriptions on the event:N channel (SongWish +
    // SetlistItem + SetlistItemReaction) via Supabase Realtime's
    // per-table filter-validation cache going stale. This channel
    // is separate (`event:N:impressions`), so EventImpression's
    // validator cache hasn't been observed bitten yet, but the
    // priors are bad — converting now before a real incident.
    // Correctness is preserved by the in-handler eventId check
    // (REPLICA IDENTITY FULL on EventImpression guarantees
    // payload.new.eventId and payload.old.eventId are present).
    const currentEventIdStr = String(eventId);
    const channel = supabase
      .channel(`event:${eventId}:impressions`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "EventImpression",
        },
        (payload) => {
          const row = payload.new as ImpressionRowPayload;
          if (String(row.eventId) !== currentEventIdStr) return;
          if (!isVisible(row)) return;
          onUpsertRef.current?.(rowToImpression(row));
          setLastUpdated(new Date().toISOString());
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "EventImpression",
        },
        (payload) => {
          const newRow = payload.new as ImpressionRowPayload;
          if (String(newRow.eventId) !== currentEventIdStr) return;
          // Same payload shape as INSERT: both halves of the
          // supersede dance flow through here. If the new state is
          // still visible (e.g., a moderator un-hid the row), the
          // consumer upserts; otherwise it removes by id.
          if (isVisible(newRow)) {
            onUpsertRef.current?.(rowToImpression(newRow));
          } else {
            onRemoveRef.current?.(newRow.id);
          }
          setLastUpdated(new Date().toISOString());
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "EventImpression",
        },
        (payload) => {
          // payload.old has the full row only with REPLICA IDENTITY
          // FULL on the table (see prisma/post-deploy.sql). Both
          // `id` (PK, always present) and `eventId` (present under
          // FULL) are required here — `eventId` for the scope check
          // now that the server-side filter is gone, `id` for the
          // consumer's remove-by-id. Defensive: bail if either is
          // missing.
          const oldRow = payload.old as Partial<ImpressionRowPayload>;
          if (!oldRow.id) return;
          if (oldRow.eventId == null) return;
          if (String(oldRow.eventId) !== currentEventIdStr) return;
          onRemoveRef.current?.(oldRow.id);
          setLastUpdated(new Date().toISOString());
        },
      )
      .subscribe((channelStatus) => {
        // R3: status transition observability + fallback gating.
        // Separate breadcrumb category from `useRealtimeEventChannel`
        // so post-mortems can tell the two channels apart at a
        // glance.
        Sentry.addBreadcrumb({
          category: "realtime-impressions",
          message: `event:${eventId}:impressions channel status → ${channelStatus}`,
          level: channelStatus === "SUBSCRIBED" ? "info" : "warning",
          data: { eventId, channelStatus },
        });

        if (
          channelStatus === "CHANNEL_ERROR" ||
          channelStatus === "TIMED_OUT"
        ) {
          // R3.5: if the tab is hidden, ignore the error entirely.
          // The "visibility-driven teardown is silent" contract must
          // hold across every reachable path — see the matching block
          // in useRealtimeEventChannel.ts for the full rationale.
          // CodeRabbit feedback on PR #452.
          if (isDocumentHidden()) return;

          if (!hasReportedFallbackRef.current) {
            hasReportedFallbackRef.current = true;
            Sentry.captureMessage(
              "Realtime impressions fallback to polling",
              {
                level: "warning",
                tags: {
                  eventId,
                  transitionReason: channelStatus,
                },
              },
            );
          }
          // Tell the consumer (EventImpressions) to enable polling.
          // The dep change triggers cleanup below; the next render's
          // effect early-returns.
          setPollFallback(true);

          // R3.5: bounded auto-recovery. Pending-timer guard prevents
          // duplicate timers from a rapid CHANNEL_ERROR burst
          // (CodeRabbit feedback on PR #450). No `!document.hidden`
          // re-check — the early-return above already filtered
          // hidden-tab errors out of this entire branch. See the
          // setlist channel's matching block for the full rationale.
          if (
            recoveryAttemptsRef.current < MAX_RECOVERY_ATTEMPTS &&
            pendingRecoveryTimeoutRef.current === null
          ) {
            recoveryAttemptsRef.current += 1;
            const attempt = recoveryAttemptsRef.current;
            Sentry.addBreadcrumb({
              category: "realtime-impressions",
              message: `event:${eventId}:impressions scheduling auto-recovery attempt ${attempt}/${MAX_RECOVERY_ATTEMPTS} in ${RECOVERY_DELAY_MS}ms`,
              level: "info",
              data: { eventId, attempt, delayMs: RECOVERY_DELAY_MS },
            });
            pendingRecoveryTimeoutRef.current = setTimeout(() => {
              pendingRecoveryTimeoutRef.current = null;
              Sentry.addBreadcrumb({
                category: "realtime-impressions",
                message: `event:${eventId}:impressions auto-recovery attempt ${attempt} firing`,
                level: "info",
                data: { eventId, attempt },
              });
              setPollFallback(false);
            }, RECOVERY_DELAY_MS);
          }
        }
        // Reconnect-SUBSCRIBED gap-fill is NOT done here. The
        // impressions feed is purely append-driven (chains either
        // grow or are hidden); a brief gap during a reconnect would
        // cause us to miss INSERTs that landed during the drop, but
        // those would surface naturally on the consumer's next
        // load-more click (or be re-pushed if the user posts after
        // reconnect). Refetching the full feed on reconnect would
        // require us to mirror the cursor-pagination state in this
        // hook, which is the consumer's concern. Trade-off accepted
        // for R3.
      });

    return () => {
      void supabase.removeChannel(channel);
    };
    // Callbacks are NOT in the deps array — they're held in refs and
    // the latest value is read on each push. Adding them here would
    // re-subscribe the channel on every parent re-render with a fresh
    // callback identity, which would be a regression. `pollFallback`
    // IS in the deps so the effect re-runs (cleanup + early return)
    // when we hand off to polling.
  }, [eventId, enabled, pollFallback, paused]);

  return { lastUpdated, pollFallback };
}
