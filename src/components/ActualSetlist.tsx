"use client";

import { useCallback, useEffect, useReducer } from "react";
import { useTranslations } from "next-intl";
import { SetlistRow } from "@/components/SetlistRow";
import type { RowState, RowVote } from "@/components/NumberSlot";
import type {
  LiveSetlistItem,
  ReactionCountsMap,
} from "@/lib/types/setlist";
import { colors } from "@/styles/tokens";
import {
  SETLIST_DESKTOP_GRID_COLS,
  SETLIST_DESKTOP_GRID_GAP,
} from "@/components/setlistLayout";
import { AUTO_CONFIRM_TICK_MS, getConfirmStatus } from "@/lib/confirmStatus";
import { useLocalConfirm } from "@/hooks/useLocalConfirm";
import { useLocalDisagree } from "@/hooks/useLocalDisagree";
import { trackEvent } from "@/lib/analytics";
import { LAUNCH_FLAGS } from "@/lib/launchFlags";

interface Props {
  items: LiveSetlistItem[];
  reactionCounts: ReactionCountsMap;
  locale: string;
  eventId: string;
}

/**
 * Renders the actual-setlist body for the SETLIST surface — the
 * column header + main rows + encore divider + encore rows. Carved
 * out of `<LiveSetlist>` as part of the Stage B tab refactor so
 * `<SetlistSection>` can swap this for `<PredictedSetlist>` when
 * the Predicted tab is active.
 *
 * Behavior is **byte-equivalent** to the pre-refactor inline
 * rendering in `<LiveSetlist>` — the load-bearing constraint of
 * this refactor is that events without predictions render
 * identical HTML to Phase 1A.
 *
 * Empty-state ("no setlist") rendering stays in `<LiveSetlist>`
 * because it predates the tab structure and shouldn't change shape
 * just because the tab system was added.
 */
export function ActualSetlist({
  items,
  reactionCounts,
  locale,
  eventId,
}: Props) {
  const t = useTranslations("Event");
  const ct = useTranslations("Common");
  const confirmT = useTranslations("Confirm");

  // Auto-promote ticker for `getConfirmStatus`'s 1-min boundary.
  // The function reads `new Date()` per call, so the row's visual
  // state only updates when the component re-renders. Pre-Realtime
  // the 5s polling cadence in `useSetlistPolling` provided that
  // re-render implicitly; with the Realtime push path active
  // there's no cadence (only event-driven re-renders), so a
  // rumoured row stays rumoured visually until either a push
  // arrives or the user reloads. This explicit setInterval restores
  // the documented "≤5s of the boundary" promote contract,
  // independent of the data source — works uniformly for polling,
  // realtime, and R3 polling-fallback paths.
  //
  // Skip the timer entirely when no rumoured items exist — keeps
  // the cost zero for completed events and once every row has
  // settled. `hasRumoured` is intentionally NOT memoized: the
  // boolean must re-derive on every render so the post-tick render
  // sees rows that just crossed the boundary as confirmed and
  // flips the dep, tearing down the timer.
  const hasRumoured = items.some(
    (item) => getConfirmStatus(item) === "rumoured",
  );
  const [, tickAutoPromote] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!hasRumoured) return;
    const id = setInterval(tickAutoPromote, AUTO_CONFIRM_TICK_MS);
    return () => clearInterval(id);
  }, [hasRumoured]);

  // Per-viewer vote sets, owned ONCE here so every row sees the
  // same Set instances. Mounted-gated hydration inside each hook
  // keeps SSR + first client render matching (sets are empty until
  // after mount). `useLocalConfirm` also fires the (gated) POST on
  // confirm; `useLocalDisagree` is localStorage-only at v0.10.x
  // (no POST endpoint yet — Week 3 work).
  const { confirmedItemIds, toggleConfirm } = useLocalConfirm(eventId);
  const { disagreedItemIds, toggleDisagree } = useLocalDisagree(eventId);

  // Mutual exclusivity: a viewer can't simultaneously confirm AND
  // disagree on the same row. Tapping ✓ clears any matching
  // disagree, and vice versa. This coordination lives at the
  // consumer level (here) rather than inside the hooks so each
  // hook stays independently testable. The handler is memoized so
  // child `<SetlistRow>` consumers don't re-render unnecessarily;
  // each row composes its own per-id closure over the memoized
  // handler.
  const handleConfirmTap = useCallback(
    (itemId: number) => {
      // GA4 Phase 1B 🔴 5/23 Kobe blocking subset: fire BEFORE the
      // toggleConfirm call (which contains the gated POST). The
      // whole point of the Kobe UI-test event with
      // `confirmDbEnabled=false` is measuring tap intent under the
      // gated state — `db_enabled` is carried as a per-event param
      // (not a session dimension) so the 5/30 flag flip is
      // queryable in a single GA4 view across the cutover.
      // The 1-min auto-promote in `getConfirmStatus` is NOT a tap;
      // it lives in `deriveRowState` and never reaches this
      // handler.
      trackEvent("confirm_click", {
        event_id: String(eventId),
        setlist_item_id: String(itemId),
        target_state: confirmedItemIds.has(itemId)
          ? "to_unconfirmed"
          : "to_confirmed",
        db_enabled: LAUNCH_FLAGS.confirmDbEnabled,
      });
      if (disagreedItemIds.has(itemId)) {
        // Clear opposing vote first. The disagree toggle is
        // idempotent — calling it on a present id removes it.
        toggleDisagree(itemId);
      }
      toggleConfirm(itemId);
    },
    [
      eventId,
      confirmedItemIds,
      disagreedItemIds,
      toggleDisagree,
      toggleConfirm,
    ],
  );
  const handleDisagreeTap = useCallback(
    (itemId: number) => {
      // GA4 Phase 1B: local-only at v0.10.x (no server endpoint
      // yet — Week 3 work). No `db_enabled` param since there's
      // no DB write to gate. Mutual-exclusivity below is a UI
      // mechanic, not a separate user action; we don't fire a
      // confirm_click for the auto-clear of the opposite vote.
      trackEvent("disagree_click", {
        event_id: String(eventId),
        setlist_item_id: String(itemId),
        target_state: disagreedItemIds.has(itemId)
          ? "to_undisagreed"
          : "to_disagreed",
      });
      if (confirmedItemIds.has(itemId)) {
        toggleConfirm(itemId);
      }
      toggleDisagree(itemId);
    },
    [
      eventId,
      confirmedItemIds,
      disagreedItemIds,
      toggleConfirm,
      toggleDisagree,
    ],
  );

  const mainItems = items.filter((item) => !item.isEncore);
  const encoreItems = items.filter((item) => item.isEncore);

  return (
    <>
      {/* Confirm-vote instructional strip: tells first-time visitors
          how to ✓/✕ newly-registered (rumoured) rows. Visible only
          while at least one row is still rumoured — once every row
          promotes to confirmed (DB-confirmed or via the 1-min auto-
          promote in `getConfirmStatus`), the action it describes is
          gone and the strip retires with it. The same `hasRumoured`
          flag drives the auto-promote ticker above, so visibility and
          re-render cadence stay coupled. Visual treatment mirrors the
          adjacent `<SetlistColumnHeader>` (same padding + bg) so the
          strip reads as part of the column-header block. */}
      {hasRumoured && (
        <div
          className="text-[11px]"
          style={{
            padding: "8px 20px",
            color: colors.textMuted,
            background: colors.bgFaint,
            borderBottom: `0.5px solid ${colors.border}`,
          }}
        >
          {confirmT("description")}
        </div>
      )}
      <SetlistColumnHeader
        labels={{
          position: t("colPosition"),
          song: t("colSong"),
          performers: t("colPerformers"),
          reactions: t("colReactions"),
        }}
      />
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {mainItems.map((item, index) => (
          <SetlistRow
            key={item.id}
            item={item}
            index={index}
            reactionCounts={reactionCounts}
            locale={locale}
            eventId={eventId}
            rowState={deriveRowState(item)}
            myVote={deriveMyVote(item.id, confirmedItemIds, disagreedItemIds)}
            onConfirmTap={() => handleConfirmTap(item.id)}
            onDisagreeTap={() => handleDisagreeTap(item.id)}
          />
        ))}
      </ol>
      {encoreItems.length > 0 && (
        <>
          <EncoreDivider label={ct("encore")} />
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {encoreItems.map((item, index) => (
              <SetlistRow
                key={item.id}
                item={item}
                index={index}
                reactionCounts={reactionCounts}
                locale={locale}
                eventId={eventId}
                rowState={deriveRowState(item)}
                myVote={deriveMyVote(item.id, confirmedItemIds, disagreedItemIds)}
                onConfirmTap={() => handleConfirmTap(item.id)}
                onDisagreeTap={() => handleDisagreeTap(item.id)}
              />
            ))}
          </ol>
        </>
      )}
    </>
  );
}

/**
 * Binary row state — `confirmed` or `rumoured`. The viewer's vote
 * is now a separate axis (`RowVote` via `deriveMyVote` below), not
 * a row-level state, since v0.10.1's dual-button NumberSlot
 * (✓/✕) collapsed the previous 3-state shape.
 *
 * `getConfirmStatus` (`src/lib/confirmStatus.ts`) handles the DB-
 * level decision (`status === "confirmed" | "live"` always wins;
 * `rumoured` rows past 1-min auto-promote to confirmed too).
 *
 * Read-time evaluation: `getConfirmStatus` reads `now` per call,
 * so each render sees the current bucket. The 5s `setInterval`
 * declared above (gated on `hasRumoured`) forces a re-render at
 * that cadence so rows crossing the 60s mark promote within ≤ 5s
 * of the boundary — independent of whether the data source is
 * polling, realtime push, or R3 polling-fallback.
 */
function deriveRowState(item: LiveSetlistItem): RowState {
  const confirmStatus = getConfirmStatus(item);
  return confirmStatus === "confirmed" ? "confirmed" : "rumoured";
}

/**
 * Per-viewer vote derivation for `<NumberSlot>`. Confirm wins ties
 * defensively (a row in both sets is a logic bug elsewhere — the
 * mutual-exclusivity handlers above prevent it — but if it ever
 * happens, treating the row as confirmed is the safer default
 * since confirm has the gated DB write and disagree doesn't).
 */
function deriveMyVote(
  itemId: number,
  confirmedItemIds: Set<number>,
  disagreedItemIds: Set<number>,
): RowVote {
  if (confirmedItemIds.has(itemId)) return "confirm";
  if (disagreedItemIds.has(itemId)) return "disagree";
  return "none";
}

// Lifted verbatim from `<LiveSetlist>` so `<ActualSetlist>` stays
// self-contained. Single source of truth for the column template +
// gap is `setlistLayout.ts`.
function SetlistColumnHeader({
  labels,
}: {
  labels: {
    position: string;
    song: string;
    performers: string;
    reactions: string;
  };
}) {
  const headerStyle = {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
  };
  return (
    <div
      aria-hidden="true"
      className="hidden lg:grid"
      style={{
        gridTemplateColumns: SETLIST_DESKTOP_GRID_COLS,
        columnGap: SETLIST_DESKTOP_GRID_GAP,
        padding: "8px 20px",
        background: colors.bgFaint,
        borderBottom: `2px solid ${colors.border}`,
      }}
    >
      <span style={headerStyle}>{labels.position}</span>
      <span style={headerStyle}>{labels.song}</span>
      <span style={headerStyle}>{labels.performers}</span>
      <span style={headerStyle}>{labels.reactions}</span>
    </div>
  );
}

function EncoreDivider({ label }: { label: string }) {
  return (
    <div className="my-4 flex items-center gap-3">
      <div className="h-px flex-1 bg-zinc-200" />
      <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
        {label}
      </span>
      <div className="h-px flex-1 bg-zinc-200" />
    </div>
  );
}
