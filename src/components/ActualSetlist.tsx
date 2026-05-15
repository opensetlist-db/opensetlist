"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { SetlistRow } from "@/components/SetlistRow";
import { AddItemButton } from "@/components/AddItemBottomSheet/AddItemButton";
import { AddItemBottomSheet } from "@/components/AddItemBottomSheet";
import { ContestReportSheet } from "@/components/ContestReportSheet";
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
import type { ResolvedEventStatus } from "@/lib/eventStatus";

interface Props {
  items: LiveSetlistItem[];
  reactionCounts: ReactionCountsMap;
  locale: string;
  eventId: string;
  /**
   * Resolved event status (upcoming / ongoing / completed / cancelled)
   * — gates the `+ 곡 추가` button. Per Phase 1C spec the button is
   * only visible during `ongoing` (operator-only window pre-show and
   * post-show; mid-show is the user-contribution window). Threaded
   * through from `<SetlistSection>` which already owns this prop for
   * the Predicted-tab gating.
   */
  status: ResolvedEventStatus;
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
  status,
}: Props) {
  const t = useTranslations("Event");
  const ct = useTranslations("Common");
  const confirmT = useTranslations("Confirm");

  // Bottom-sheet state. Two pieces:
  //   - `open`: whether the sheet is mounted/visible.
  //   - `presetPosition`: the target position the sheet should land
  //     at on submit, frozen at the moment a button was clicked.
  //     `null` here represents "no current open intent"; an open
  //     sheet always has a non-null preset.
  //
  // Two entry points populate `presetPosition`:
  //   1. Footer "+ 곡 추가" — captures `currentMax + 1` from the
  //      `items` prop at the click moment. Realtime updates to
  //      `items` after the click don't shift it (that's the freeze).
  //   2. Per-row contest button (`<RowContestButton>` inside a
  //      conflict-group `<SetlistRow>`) — captures that row's
  //      `position` so the sheet pre-targets the contested slot
  //      directly. Same freeze.
  //
  // Submission writes through to `useLocalConfirm.toggleConfirm` so
  // the user's own row renders `[✓]` immediately.
  const [sheetState, setSheetState] = useState<{
    open: boolean;
    presetPosition: number | null;
  }>({ open: false, presetPosition: null });

  // ContestReportSheet state — separate sheet, separate intent
  // from the AddItemBottomSheet. Opens via `<IssueReportButton>`
  // on any row when `LAUNCH_FLAGS.contestReportEnabled` is true.
  // Captured at button click; setlistItemId is the row the user
  // intends to file a report against.
  const [contestSheetState, setContestSheetState] = useState<{
    open: boolean;
    setlistItemId: number | null;
  }>({ open: false, setlistItemId: null });
  const canReport = LAUNCH_FLAGS.contestReportEnabled;

  // Gate the AddItemBottomSheet entry point on (a) the launch flag —
  // false at Kobe (5/23), flips true at Kanagawa (5/30) by deleting
  // the flag entry — and (b) the event being currently ongoing. The
  // POST endpoint enforces the same `ongoing` check server-side
  // (defense in depth: a curl POST mid-show would otherwise bypass
  // the client gate).
  const canAddItem = LAUNCH_FLAGS.addItemEnabled && status === "ongoing";

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

  // Position-bucketing for conflict-handling render. Rows that share
  // a `(eventId, position)` (rumoured siblings created by concurrent
  // submission or explicit contest) collapse into a single visual
  // bucket — same position number, stacked top-down by confirmCount
  // DESC, createdAt ASC. Single-row buckets render exactly as before.
  //
  // Encore and non-encore buckets are computed separately because
  // they render in separate `<ol>` elements (with the encore divider
  // between). Conflict groups can occur in either.
  const mainBuckets = useMemo(() => bucketByPosition(mainItems), [mainItems]);
  const encoreBuckets = useMemo(
    () => bucketByPosition(encoreItems),
    [encoreItems],
  );

  // Capture-current-max for the footer "+ 곡 추가" button. Computed
  // at click time inside the onClick (not here) so a Realtime push
  // between renders doesn't pre-shift the value — what matters is
  // the value visible to the user at the precise moment they tap.
  const onAddButtonClick = useCallback(() => {
    const max = items.reduce((m, it) => Math.max(m, it.position), 0);
    setSheetState({ open: true, presetPosition: max + 1 });
  }, [items]);

  const onContest = useCallback((position: number) => {
    setSheetState({ open: true, presetPosition: position });
  }, []);

  const closeSheet = useCallback(() => {
    setSheetState({ open: false, presetPosition: null });
  }, []);

  const onIssueReport = useCallback((id: number) => {
    setContestSheetState({ open: true, setlistItemId: id });
  }, []);

  const closeContestSheet = useCallback(() => {
    setContestSheetState({ open: false, setlistItemId: null });
  }, []);

  return (
    <>
      <SetlistColumnHeader
        labels={{
          position: t("colPosition"),
          song: t("colSong"),
          performers: t("colPerformers"),
          reactions: t("colReactions"),
        }}
      />
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {mainBuckets.map(([position, bucket], bucketIndex) => (
          <Fragment key={position}>
            {bucket.map((item) => {
              // Siblings = the OTHER rows in this bucket. Empty array
              // and `undefined` would both mean "no conflict context"
              // — we use `undefined` so the row's prop signature
              // matches non-bucket single-row callers (admin
              // SetlistBuilder etc.) and `getConfirmStatus` can early-
              // return without the siblings check.
              const siblings =
                bucket.length > 1
                  ? bucket
                      .filter((b) => b.id !== item.id)
                      .map((b) => ({ id: b.id }))
                  : undefined;
              return (
                <SetlistRow
                  key={item.id}
                  item={item}
                  index={bucketIndex}
                  reactionCounts={reactionCounts}
                  locale={locale}
                  eventId={eventId}
                  rowState={deriveRowState(item, siblings)}
                  myVote={deriveMyVote(
                    item.id,
                    confirmedItemIds,
                    disagreedItemIds,
                  )}
                  onConfirmTap={() => handleConfirmTap(item.id)}
                  onDisagreeTap={() => handleDisagreeTap(item.id)}
                  siblings={siblings}
                  onContest={canAddItem ? onContest : undefined}
                  canReport={canReport}
                  onIssueReport={canReport ? onIssueReport : undefined}
                />
              );
            })}
          </Fragment>
        ))}
      </ol>
      {/* `+ 곡 추가` button + sheet — mounted between the main and
          encore lists per the spec's positional intent. Pre-show and
          post-show the entire conditional is false: `canAddItem`
          requires both the launch flag (false at Kobe 5/23) AND
          `event.status === 'ongoing'`. Realtime push delivers the
          new row to the items array; no optimistic insert here. The
          sheet's `presetPosition` is captured at button-click time
          and frozen for the deliberation window — Realtime updates
          to `items` surface as an in-sheet notice rather than
          shifting the target. */}
      {canAddItem && (
        <>
          <AddItemButton onClick={onAddButtonClick} />
          <AddItemBottomSheet
            eventId={eventId}
            locale={locale}
            open={sheetState.open}
            presetPosition={sheetState.presetPosition}
            items={items}
            onClose={closeSheet}
            onSubmitSuccess={(itemId) => {
              // Auto-mark the user's own row as confirmed by writing
              // through the existing useLocalConfirm hook. The
              // server's `confirmDbEnabled` gating inside the hook
              // decides whether a POST also fires; at 1C with the
              // confirm-DB gate flipped, the local-only path is
              // exercised (the auto-promote at 60s handles the
              // visual settle for everyone else).
              toggleConfirm(itemId);
            }}
          />
        </>
      )}
      {/* ContestReportSheet — separate sheet for the operator-queue
          path. Mounted independently of `canAddItem` because reports
          are valid against ANY row (rumoured or confirmed),
          regardless of whether the event is currently ongoing.
          Gated only by `LAUNCH_FLAGS.contestReportEnabled` (via
          `canReport`). The sheet itself returns null when
          `open=false`, so mounting it conditional-free is cheap. */}
      {canReport && (
        <ContestReportSheet
          eventId={eventId}
          setlistItemId={contestSheetState.setlistItemId}
          locale={locale}
          open={contestSheetState.open}
          onClose={closeContestSheet}
          onSubmitSuccess={() => {
            // 1C: no local follow-up state for filed reports.
            // Operator triages via /admin/contest-reports; the user
            // sees the success toast inside the sheet and the
            // sheet closes itself.
          }}
        />
      )}
      {encoreBuckets.length > 0 && (
        <>
          <EncoreDivider label={ct("encore")} />
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {encoreBuckets.map(([position, bucket], bucketIndex) => (
              <Fragment key={position}>
                {bucket.map((item) => {
                  const siblings =
                    bucket.length > 1
                      ? bucket
                          .filter((b) => b.id !== item.id)
                          .map((b) => ({ id: b.id }))
                      : undefined;
                  return (
                    <SetlistRow
                      key={item.id}
                      item={item}
                      index={bucketIndex}
                      reactionCounts={reactionCounts}
                      locale={locale}
                      eventId={eventId}
                      rowState={deriveRowState(item, siblings)}
                      myVote={deriveMyVote(
                        item.id,
                        confirmedItemIds,
                        disagreedItemIds,
                      )}
                      onConfirmTap={() => handleConfirmTap(item.id)}
                      onDisagreeTap={() => handleDisagreeTap(item.id)}
                      siblings={siblings}
                      onContest={canAddItem ? onContest : undefined}
                      canReport={canReport}
                      onIssueReport={canReport ? onIssueReport : undefined}
                    />
                  );
                })}
              </Fragment>
            ))}
          </ol>
        </>
      )}
      {/* Confirm-vote instructional strip: tells first-time visitors
          how to ✓/✕ newly-registered (rumoured) rows. Visible only
          while at least one row is still rumoured — once every row
          promotes to confirmed (DB-confirmed or via the 1-min auto-
          promote in `getConfirmStatus`), the action it describes is
          gone and the strip retires with it. The same `hasRumoured`
          flag drives the auto-promote ticker above, so visibility and
          re-render cadence stay coupled.

          Sits at the BOTTOM of the setlist body, not the top: new
          rumoured rows get appended at the bottom of the list as the
          operator adds them, so the description always renders right
          next to the rows whose ✓/✕ buttons it explains. A top-of-
          list placement (the v0.11.1-shipped position) put the help
          copy far away from new rows once the list had any length.
          Visual treatment mirrors `<SetlistColumnHeader>` (same
          padding + bg, borderTop instead of borderBottom) so the
          strip reads as a "footer" answer to the header above. */}
      {hasRumoured && (
        <div
          className="text-[11px]"
          style={{
            padding: "8px 20px",
            color: colors.textMuted,
            background: colors.bgFaint,
            borderTop: `0.5px solid ${colors.border}`,
          }}
        >
          {confirmT("description")}
        </div>
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
 * `rumoured` rows past 1-min auto-promote to confirmed too,
 * EXCEPT when in a conflict group — siblings non-empty suspends
 * the 60s auto-promote so vote-driven resolution stays in charge).
 *
 * Read-time evaluation: `getConfirmStatus` reads `now` per call,
 * so each render sees the current bucket. The 5s `setInterval`
 * declared above (gated on `hasRumoured`) forces a re-render at
 * that cadence so rows crossing the 60s mark promote within ≤ 5s
 * of the boundary — independent of whether the data source is
 * polling, realtime push, or R3 polling-fallback.
 */
function deriveRowState(
  item: LiveSetlistItem,
  siblings?: ReadonlyArray<{ id: number }>,
): RowState {
  const confirmStatus = getConfirmStatus(item, undefined, siblings);
  return confirmStatus === "confirmed" ? "confirmed" : "rumoured";
}

/**
 * Group items by `position` so conflict siblings render in the same
 * visual bucket. Within a bucket of size > 1, sort by
 * `confirmCount DESC, createdAt ASC` — the highest-voted candidate
 * appears on top; tied buckets break by submission order so the
 * earlier-submitted row sorts above identically-voted later
 * submissions.
 *
 * Returns a tuple list keyed by position (ASC) — the entry value is
 * the (sorted) sibling array. Stable across re-renders if the
 * underlying items array is stable, which combined with `useMemo` at
 * the call site keeps the render layer cheap.
 */
function bucketByPosition(
  items: LiveSetlistItem[],
): Array<[number, LiveSetlistItem[]]> {
  const map = new Map<number, LiveSetlistItem[]>();
  for (const item of items) {
    const bucket = map.get(item.position);
    if (bucket) bucket.push(item);
    else map.set(item.position, [item]);
  }
  const entries = [...map.entries()];
  entries.sort(([a], [b]) => a - b);
  return entries.map(([pos, list]) => [pos, sortConflictBucket(list)]);
}

function sortConflictBucket(
  items: LiveSetlistItem[],
): LiveSetlistItem[] {
  if (items.length <= 1) return items;
  return [...items].sort((a, b) => {
    const countDiff = (b.confirmCount ?? 0) - (a.confirmCount ?? 0);
    if (countDiff !== 0) return countDiff;
    return (
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  });
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
