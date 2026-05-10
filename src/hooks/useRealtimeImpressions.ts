"use client";

import { useEffect, useRef, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";
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
 *   - No auto-recovery: once flipped, stays true for the page
 *     lifetime. Matches `useRealtimeEventChannel`.
 *
 *   - Sentry: breadcrumb on every transition (separate category
 *     `realtime-impressions` so it doesn't blur with the setlist
 *     channel's stream); a single `captureMessage` on first
 *     fallback per session.
 */
export function useRealtimeImpressions({
  eventId,
  enabled,
  onUpsert,
  onRemove,
}: UseRealtimeImpressionsOptions): UseRealtimeImpressionsResult {
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [pollFallback, setPollFallback] = useState(false);

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
  // The matching ref reset lives in the useEffect below to satisfy
  // react-hooks/refs (no ref writes during render).
  const [prevEventId, setPrevEventId] = useState(eventId);
  if (prevEventId !== eventId) {
    setPrevEventId(eventId);
    setPollFallback(false);
  }
  useEffect(() => {
    hasReportedFallbackRef.current = false;
  }, [eventId]);

  useEffect(() => {
    if (!enabled) return;
    // Once polling has taken over, this effect has cleaned up the
    // dead channel and we skip re-subscribing.
    if (pollFallback) return;

    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`event:${eventId}:impressions`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "EventImpression",
          filter: `eventId=eq.${eventId}`,
        },
        (payload) => {
          const row = payload.new as ImpressionRowPayload;
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
          filter: `eventId=eq.${eventId}`,
        },
        (payload) => {
          const newRow = payload.new as ImpressionRowPayload;
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
          filter: `eventId=eq.${eventId}`,
        },
        (payload) => {
          // payload.old has the full row only with REPLICA IDENTITY
          // FULL on the table (see prisma/post-deploy.sql). We only
          // need `id` for removal, which is the primary key — that's
          // populated even without FULL — but the cast still requires
          // the field to be present on the type. Defensive: bail if
          // missing rather than passing undefined to the consumer.
          const oldRow = payload.old as Partial<ImpressionRowPayload>;
          if (!oldRow.id) return;
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
  }, [eventId, enabled, pollFallback]);

  return { lastUpdated, pollFallback };
}
