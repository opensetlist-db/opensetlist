"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useMounted } from "@/hooks/useMounted";
import { setTimeoutAt } from "@/lib/timeoutAt";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import styles from "@/components/event/eventDetail.module.css";
import { PredictSongRow, type PredictRowState } from "@/components/PredictSongRow";
import { ShareCardButton } from "@/components/ShareCardButton";
import {
  CopyPastSetlistSheet,
  type CopyApplyMeta,
} from "@/components/CopyPastSetlistSheet";
import { SongPickerContent } from "@/components/predict/SongPickerContent";
import { SongPickerSheet } from "@/components/predict/SongPickerSheet";
import type { AvailableSong, UnitFilter } from "@/lib/types/predict";
import {
  readPredictions,
  writePredictions,
  markLocked,
  type PredictionEntry,
} from "@/lib/predictionsStorage";
import type { BoardToBuilderOutcome } from "@/lib/board/toPredictions";
import type { BoardChip } from "@/lib/board/types";
import { BoardPublishProposal } from "@/components/board/BoardPublishProposal";
import { BOARD_PICKS_PER_GROUP } from "@/lib/board/config";
import { calcPredictScore } from "@/lib/predictScore";
import { isSongMatched } from "@/lib/songMatch";
import { trackEvent } from "@/lib/analytics";
import type { ResolvedEventStatus } from "@/lib/eventStatus";
import type { LiveSetlistItem } from "@/lib/types/setlist";
import { colors } from "@/styles/tokens";

/**
 * Desktop picker column width. 18-v3 `.predict-layout` draws the
 * inline picker at 240px; the live picker also carries the unit chips,
 * the result count and the sort toggle, which need more room than the
 * mockup's sample list, so the column keeps the wider 280px and the
 * editor (`minmax(0, 1fr)`) takes the rest.
 */
const DESKTOP_PICKER_COL_PX = 280;

interface Props {
  eventId: string;
  locale: string;
  /** UTC; both Date and ISO string accepted (page serializes BigInt rows). */
  startTime: Date | string | null;
  status: ResolvedEventStatus;
  /**
   * Polled actual setlist (filtered to song-type rows by
   * `<SetlistSection>`). Full `LiveSetlistItem[]` shape — the
   * score functions structurally accept it (they only need
   * `songs[].song.{id, baseVersionId}`), and `<ShareCardButton>`
   * needs the full shape downstream for its preview render.
   */
  actualSongs: LiveSetlistItem[];
  /**
   * Share-card header trio (v0.11.5+) — forwarded to
   * `<ShareCardButton>`. See `<LiveSetlist>` for the per-field
   * meaning and the iOS-feedback rationale.
   */
  seriesName: string;
  eventTitle: string;
  dateLine: string;
  /**
   * Catalog for the song picker (server-fetched in `page.tsx` via
   * `getAvailableSongs`). Empty array on multi-artist festivals or
   * when the resolved status isn't `upcoming` — the picker hides
   * itself in those cases and the surface degrades to the same
   * "📋 지난 공연에서" + share affordances that already exist.
   */
  availableSongs: AvailableSong[];
  /** Filter chip set derived from `availableSongs` server-side. */
  unitFilters: UnitFilter[];
  /**
   * What the board's "go to full setlist mode" did just before this
   * mount (n15), or null when the fan came by the tab. Drives the
   * one-line notice: songs imported, or the existing list kept.
   */
  bridgeOutcome?: BoardToBuilderOutcome | null;
  /** Mode switch back to the board block; absent on non-board events. */
  onBackToBoard?: () => void;
  /**
   * The board's groups (n15), present only where the board takes
   * picks right now. Enables "put on the board": the list → an
   * editable proposal → published expected songs.
   */
  boardGroups?: readonly BoardChip[];
  /** After a publish, so the parent refreshes the board block. */
  onBoardPublished?: () => void;
}

/**
 * Phase 1B Stage C — Predicted Setlist surface.
 *
 * Three modes per `event.status` + lock state:
 *   - Pre-show (now < startTime): unlimited prediction list with
 *     drag-reorder, ✕ remove, `+ 곡 추가` inline `<SongSearch>`.
 *   - During-show (status === "ongoing"): edit affordances hidden;
 *     divider at `현재 N곡 — 여기까지 매칭`; rows above the divider
 *     (predicted-rank ≤ N) compute matched/unmatched per
 *     `calcPredictScore`; rows below dimmed (opacity 0.4) but matched
 *     hits within them get green-bg + dim, then auto-promote when
 *     actual count grows past their rank.
 *   - Post-show (status === "completed"): `결과 공유 🎯` button at
 *     the bottom (rendered via `<ShareCardButton>` which gates on
 *     status + actual+prediction non-empty).
 *
 * Lock state mirrors the `<EventWishSection>` pattern (lazy
 * `useState(() => Date.now() >= startMs)` + `useEffect` setTimeout)
 * so already-past events render the locked UI on first paint
 * without a flash of unlocked affordances.
 *
 * Replaces the Stage B `<PredictedSetlist>` placeholder
 * (PR #280) — the tab body wiring in `<SetlistSection>` already
 * routes the active tab to this component.
 */
export function PredictedSetlist({
  eventId,
  locale,
  startTime,
  status,
  actualSongs,
  seriesName,
  eventTitle,
  dateLine,
  availableSongs,
  unitFilters,
  bridgeOutcome = null,
  onBackToBoard,
  boardGroups,
  onBoardPublished,
}: Props) {
  const t = useTranslations("Predict");
  const mounted = useMounted();
  const isDesktop = useIsDesktop();

  // ─── Lock state (mirror <EventWishSection>) ─────────────────
  // Treat null startTime as "never lock" — the Predicted tab is
  // useful both on dated and TBA events. `Date.now() >= startMs`
  // semantic only fires when we actually have a startTime.
  //
  // Two-layer lock: setTimeout flips `scheduledLocked` reliably
  // when running, and the rendered `isLocked` falls back to a
  // wall-clock check on every render after mount. v0.10.0 smoke
  // caught the failure mode: a long-open page where the system
  // suspended (laptop sleep / mobile lock) past `startMs` left
  // the timer un-fired, so the editor stayed open across the
  // event start. The wall-clock fallback re-evaluates on each
  // re-render (5s polling drives plenty of these), catching the
  // missed-timer case. Same shape as `<EventWishSection>`.
  const startMs = startTime
    ? startTime instanceof Date
      ? startTime.getTime()
      : new Date(startTime).getTime()
    : null;
  const [scheduledLocked, setScheduledLocked] = useState(() =>
    startMs === null ? false : Date.now() >= startMs,
  );
  useEffect(() => {
    if (scheduledLocked) return;
    if (startMs === null) return;
    const remaining = startMs - Date.now();
    if (remaining <= 0) return;
    // `setTimeoutAt`, not a bare `setTimeout`: a show more than
    // ~24.8 days out overflows setTimeout's 32-bit delay and would
    // lock on mount (see `src/lib/timeoutAt.ts`).
    return setTimeoutAt(startMs, () => setScheduledLocked(true));
  }, [scheduledLocked, startMs]);
  // Three-input lock — see `<EventWishSection>` for the full
  // rationale. The polled `status` (server-resolved via
  // `getEventStatus` server-side, refreshed every 5s) is the
  // bypass-resistant signal for clock-skewed clients; the
  // wall-clock check covers missed setTimeout (laptop sleep /
  // mobile lock); scheduledLocked is the best-case timer fire.
  // `react-hooks/purity` block disable applies because the
  // violating Date.now() call sits on line 3 of the expression —
  // `next-line` would only reach the first line.
  /* eslint-disable react-hooks/purity */
  const isLocked =
    scheduledLocked ||
    status !== "upcoming" ||
    (mounted && startMs !== null && Date.now() >= startMs);
  /* eslint-enable react-hooks/purity */

  // Stamp lockedAt to localStorage when lock fires for the first
  // time. `markLocked` is idempotent so a re-mount that re-reads a
  // stale `false` and then flips true won't overwrite the original
  // lock instant.
  useEffect(() => {
    if (isLocked) markLocked(eventId);
  }, [isLocked, eventId]);

  // GA4 Phase 1B `predict_lock_view`: track the first observation
  // of the locked Predicted view per session, per event. The KPI
  // is "% of returning visitors who view live results during the
  // show" — sessionStorage is intentional (not localStorage) so
  // the count resets across sessions; a long-running tab that
  // crosses startTime fires once at that transition. Best-effort:
  // private-mode browsers throw on sessionStorage access, in
  // which case we still fire (one extra event per pageview is
  // preferable to silently losing the metric for that audience).
  useEffect(() => {
    if (!isLocked) return;
    if (typeof window === "undefined") return;
    const key = `predict_lock_viewed:${eventId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // private mode / quota — fall through and fire anyway.
    }
    trackEvent("predict_lock_view", { event_id: String(eventId) });
  }, [isLocked, eventId]);

  // ─── Predictions state ──────────────────────────────────────
  // Mounted-gated read of localStorage, mirroring EventWishSection
  // (avoids react-hooks/set-state-in-effect; the canonical project
  // pattern, see useMounted.ts:9-18).
  const [predictions, setPredictions] = useState<PredictionEntry[]>([]);
  // A list pre-filled from board picks (n15) is grouped, not
  // ranked; the builder says so until the fan reorders. Stored with the
  // list, so the label survives a reload.
  const [provisional, setProvisional] = useState(false);
  // "Put on the board" panel (n15) and the last publish's count.
  const [proposalOpen, setProposalOpen] = useState(false);
  const [publishedCount, setPublishedCount] = useState<number | null>(null);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  if (mounted && hydratedKey !== eventId) {
    setHydratedKey(eventId);
    const stored = readPredictions(eventId);
    setPredictions(stored ? stored.songs : []);
    setProvisional(stored?.provisional === true);
  }

  // ─── Picker sheet state (mobile pre-show only) ──────────────
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerTrigger = useRef<HTMLButtonElement>(null);

  // ─── Copy-from-past sheet state (pre-show only) ─────────────
  const [copyOpen, setCopyOpen] = useState(false);

  // ─── Score (live + post-show) ───────────────────────────────
  const score = useMemo(
    () => calcPredictScore(predictions, actualSongs),
    [predictions, actualSongs],
  );

  // ─── Drag sensors ───────────────────────────────────────────
  // PointerSensor with `distance: 5` so a tap-to-remove on a row
  // doesn't accidentally fire a drag. KeyboardSensor for a11y —
  // reorder via Space/Arrow keys.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      // Defensive isLocked check, mirrors handleAdd / handleRemove.
      // The drag handle is hidden via `<PredictSongRow locked>` once
      // isLocked flips, so this branch should be unreachable. But a
      // long-open page where a drag began before lock and dropped
      // after could otherwise mutate the post-lock list.
      if (isLocked) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      setProvisional(false);
      setPredictions((prev) => {
        const oldIndex = prev.findIndex((p) => p.songId === active.id);
        const newIndex = prev.findIndex((p) => p.songId === over.id);
        if (oldIndex < 0 || newIndex < 0) return prev;
        const next = arrayMove(prev, oldIndex, newIndex);
        // A reorder is the fan arranging the list — it settles a
        // board-imported order.
        writePredictions(eventId, next, { provisional: false });
        // GA4 Phase 1B: one fire per drop commit, never per drag
        // pixel. The active.id === over.id no-op was rejected
        // above; the index-not-found branch is rejected here. So we
        // only reach this point when the order actually changed.
        trackEvent("predict_reorder", { event_id: String(eventId) });
        return next;
      });
    },
    [eventId, isLocked],
  );

  // ─── Add / remove handlers ──────────────────────────────────
  /**
   * Single toggle handler shared by the picker (mobile sheet + desktop
   * panel) AND the prediction-row ✕ delete button. Lock guard mirrors
   * the historical `handleAdd` / `handleRemove` shape: trigger UI is
   * gated by `isPreShow`, but a long-open page that crossed `startMs`
   * mid-tap can still reach the callback. v0.10.0 smoke caught the
   * post-lock-edit symptom; the wall-clock-fallback `isLocked`
   * derivation upstream pairs with this guard.
   *
   * Analytics: `predict_add` on insert, `predict_remove` on removal.
   * Both fire after the `writePredictions` commit so dedup / lock
   * short-circuits never stamp the funnel.
   */
  const handleToggle = useCallback(
    (songId: number) => {
      if (isLocked) return;
      const existing = predictions.find((p) => p.songId === songId);
      if (existing) {
        const next = predictions.filter((p) => p.songId !== songId);
        setPredictions(next);
        writePredictions(eventId, next);
        // Mirrors the storage rule: emptying the list ends the board
        // import, so songs added afterwards aren't labelled provisional.
        if (next.length === 0) setProvisional(false);
        trackEvent("predict_remove", {
          event_id: String(eventId),
          song_id: String(songId),
        });
        return;
      }
      // Defensive: client doesn't know about the song. Should never
      // happen because the picker only emits ids from its loaded
      // `availableSongs` set, but a stale payload + a future call
      // path that reuses `handleToggle` for an arbitrary id would
      // otherwise write an entry with no embedded `WishSongDisplay`.
      const found = availableSongs.find((s) => s.songId === songId);
      if (!found) return;
      const entry: PredictionEntry = {
        songId: found.songId,
        song: {
          originalTitle: found.originalTitle,
          originalLanguage: found.originalLanguage,
          variantLabel: found.variantLabel,
          baseVersionId: found.baseVersionId,
          translations: found.translations,
        },
      };
      const next = [...predictions, entry];
      setPredictions(next);
      writePredictions(eventId, next);
      trackEvent("predict_add", {
        event_id: String(eventId),
        song_id: String(songId),
      });
    },
    [eventId, predictions, isLocked, availableSongs],
  );

  /**
   * Per-row ✕ delete. Today's only caller is `<PredictSongRow>` (the
   * picker uses `handleToggle` directly). Kept as a thin wrapper so
   * the row API stays stable — flipping the row's onRemove to
   * `handleToggle` would also work, but the explicit name documents
   * intent at the call site.
   */
  const handleRemove = useCallback(
    (songId: number) => handleToggle(songId),
    [handleToggle],
  );

  // Copy-from-past commit. Defensive isLocked guard mirrors
  // handleAdd / handleRemove — the sheet's trigger only renders
  // inside the `isPreShow` block, but a long-open sheet that crosses
  // `startMs` mid-deliberation must not commit. Sheet's onApply
  // builds the merged list (append-unique or replace) so the parent
  // here just persists it and fires the analytics event with the
  // metadata the sheet supplied.
  const handleCopyApply = useCallback(
    (merged: PredictionEntry[], meta: CopyApplyMeta) => {
      if (isLocked) return;
      setPredictions(merged);
      // A replace swaps the board-imported songs out entirely, so its
      // "provisional" label no longer describes the list; an append
      // leaves the imported block as unarranged as before.
      const settles = meta.mode === "replace";
      writePredictions(
        eventId,
        merged,
        settles ? { provisional: false } : undefined,
      );
      if (settles) setProvisional(false);
      setCopyOpen(false);
      trackEvent("predict_copy_apply", {
        event_id: String(eventId),
        source_event_id: String(meta.sourceEventId),
        mode: meta.mode,
        incoming_count: meta.incoming,
        added_count: meta.added,
        final_count: meta.final,
      });
    },
    [eventId, isLocked],
  );

  const handleCopyFetched = useCallback(
    (pastEventCount: number) => {
      trackEvent("predict_copy_open", {
        event_id: String(eventId),
        past_event_count: pastEventCount,
      });
    },
    [eventId],
  );

  // ─── Per-row state derivation ───────────────────────────────
  // `predictions[i]` is matched iff some actualSongs entry's song
  // (or its variant base) matches `predictions[i].songId`. Then
  // we classify by predicted-rank vs actualSongs.length:
  //   - rank ≤ actualCount AND matched  → "matched-in-rank"
  //   - rank > actualCount AND matched  → "matched-out-of-rank"
  //   - rank > actualCount AND unmatched → "below-divider"
  //   - rank ≤ actualCount AND unmatched → "default"
  //   - pre-show / post-show "default" handles all unmatched cases
  // The during-show divider is drawn between rank `actualCount` and
  // `actualCount + 1` to communicate the matching boundary.
  const total = actualSongs.length;
  // `!isLocked` implies `status === "upcoming"` because the 3-input
  // lock (#291 + #294) includes `status !== "upcoming"` as one of
  // the OR branches.
  //
  // `isDuringShow` is `status === "ongoing"` specifically — NOT
  // `isLocked && status !== "completed"`. The earlier shape would
  // light up live hints + the matching divider on `cancelled`
  // events too (they're locked AND not completed), which is wrong:
  // a cancelled show should never advertise a live mid-show
  // experience to a viewer who happens to have predictions stored.
  // CR #297. Cancelled events fall through to neither pre nor
  // during nor "completed" branches — top hint strip stays empty
  // for them, which matches the absence of a meaningful "show
  // ended" or "live now" copy for the cancelled state.
  const isPreShow = !isLocked;
  const isDuringShow = status === "ongoing";
  const isPostShow = status === "completed";

  function rowState(rank: number, songId: number): PredictRowState {
    // Pre-show: nothing to match against; everything renders default.
    if (isPreShow) return "default";
    // Cancelled events (status === "cancelled"): locked AND not
    // ongoing AND not completed — no live matching context, no
    // post-show recap to anchor matched/dim/below-divider styles
    // against. Render every row as "default" so a cancelled event
    // with stored predictions doesn't show fake "matched" or
    // "below divider" styling against an empty actuals list. CR #297
    // round 2 — the earlier sibling fix narrowed `isDuringShow` for
    // the top hint strip but `rowState`'s `!isPreShow` fallthrough
    // was still reaching the matching branches for cancelled.
    if (!isDuringShow && !isPostShow) return "default";
    // Computed match: is this prediction's songId in the actual list?
    const matched = isSongMatched(
      songId,
      // calc against the full actualSongs (variant + medley free).
      actualSongs,
    );
    const inRank = rank <= total;
    if (matched && inRank) return "matched-in-rank";
    if (matched && !inRank) return "matched-out-of-rank";
    if (!inRank) return "below-divider";
    return "default";
  }

  // SortableContext expects an array of stable string/number ids.
  const sortableIds = predictions.map((p) => p.songId);

  // Where to draw the during-show divider — between predictions at
  // index `total - 1` and `total`. Hidden when not during-show OR
  // total === 0 OR predictions empty OR total >= predictions.length
  // (no below-divider rows to separate).
  const showDivider =
    isDuringShow && total > 0 && total < predictions.length;

  // Picker visibility: only when pre-show, the artist has a non-
  // empty catalog AND filter chips were derivable. On desktop a
  // populated picker switches the surface into a 2-col layout
  // (picker on the right, always visible — no trigger button
  // needed for the picker, only for copy-from-past).
  //
  // `mounted` guard on `isDesktopPicker`: `useIsDesktop`'s server
  // snapshot is always `false`, so SSR + first hydration paint
  // render the mobile shape. Without the `mounted` gate, the
  // client snapshot flips to `true` for desktop users on the
  // very next render — flashing the layout from single-col to
  // 2-col grid. Gating on `mounted` defers the 2-col path until
  // after the mount commit, matching the project's canonical
  // pattern for SSR-safe responsive components (handoff §12).
  const selectedIds = predictions.map((p) => p.songId);
  const showPicker =
    isPreShow && availableSongs.length > 0 && unitFilters.length > 0;
  const isDesktopPicker = mounted && isDesktop && showPicker;

  // Bridge strip parts (n15), see the strip below.
  const showBridgeNotice = bridgeOutcome !== null && bridgeOutcome.kind !== "none";
  const showProvisional = provisional && predictions.length > 0;
  // "Put on the board" (n15): only before the lock, with a list to
  // derive from — an empty list has nothing to propose. (A fan who
  // removes every chip in the proposal can still publish the empty set,
  // which clears their picks; the preview lists each removal first.)
  // Without a catalog the derivation finds no song in any group, so the
  // proposal would be empty and a confirm would silently clear the
  // fan's picks — no button then.
  const canPublish =
    !isLocked &&
    boardGroups !== undefined &&
    boardGroups.length > 0 &&
    predictions.length > 0 &&
    availableSongs.length > 0;

  return (
    // 18-v3 `.predict-layout`: the editor beside an always-visible
    // lavender picker panel when the desktop picker applies, otherwise
    // one column (the picker opens as a sheet).
    <div
      className={isDesktopPicker ? styles.predictLayout : undefined}
      style={
        isDesktopPicker
          ? { gridTemplateColumns: `minmax(0, 1fr) ${DESKTOP_PICKER_COL_PX}px` }
          : undefined
      }
    >
      <div className={styles.predictEditor}>
      {/* Status line: the pre/during/after hint, and once matching
          applies the score as the 18-v3 lavender result strip. */}
      <p className={styles.predictHint}>
        {isPreShow && t("preShowHint", { count: predictions.length })}
        {isDuringShow && t("duringHint", { count: predictions.length })}
        {status === "completed" && t("afterHint")}
      </p>
      {(isDuringShow || status === "completed") && total > 0 && (
        <div className={styles.resultStrip}>
          <strong>
            {t("finalScore", {
              matched: score.matched,
              total: score.total,
              pct: score.percentage,
            })}
          </strong>
        </div>
      )}

      {/* Instructional description: explains the prediction rules
          (no cap on entries, but only the top-N matches against the
          actual setlist count toward the score). Pre-show only —
          once `isLocked` flips, the user can no longer edit, so the
          rules copy retires alongside the editor. Visual treatment
          mirrors the during-show legend strip further down. */}
      {isPreShow && <p className={styles.predictNote}>{t("description")}</p>}
      {/* Board events only: this list and the board's expected songs
          are stored apart (localStorage vs the server ballot) and never
          sync on their own — only "put on the board" copies the first
          picks per group over. Said here because the fan who came from
          the board otherwise assumes the two are one list. */}
      {isPreShow && boardGroups && boardGroups.length > 0 && (
        <p data-testid="predict-board-link-note" className={styles.predictNote}>
          {t("boardLinkNote", { max: BOARD_PICKS_PER_GROUP })}
        </p>
      )}

      {/* Two-mode bridge strip (n15), pre-show only: the outcome of
          the board import that opened this tab, the provisional-order
          label, and the switch back to the board. Hidden as a whole
          when none applies, so non-board events render as before. */}
      {isPreShow && (onBackToBoard || showBridgeNotice || showProvisional || boardGroups) && (
          <div className={styles.predictBridge}>
            {/* No role="status" here: this node mounts with its text
                (the builder remounts per tap), which screen readers
                often skip. `<SetlistSection>` keeps the announcing live
                region mounted across the remount. */}
            {showBridgeNotice && (
              <p data-testid="predict-bridge-notice">
                {bridgeOutcome.kind === "imported"
                  ? t("bridgeImported", { count: bridgeOutcome.count })
                  : t("bridgeKept")}
              </p>
            )}
            {showProvisional && (
              <p
                data-testid="predict-provisional"
                style={{ color: colors.textMuted }}
              >
                {t("provisionalOrder")}
              </p>
            )}
            {/* Publish outcome (n15). Unlike the import notice,
                this region stays mounted while the builder does (a
                publish doesn't remount it), so it can announce. */}
            {boardGroups && (
              <p role="status" data-testid="predict-board-published">
                {publishedCount !== null
                  ? t("boardPublished", { count: publishedCount })
                  : ""}
              </p>
            )}
            <div className="mt-0.5 flex flex-wrap gap-x-3">
              {onBackToBoard && (
                <button
                  type="button"
                  onClick={onBackToBoard}
                  className={styles.textButton}
                >
                  {t("toBoard")}
                </button>
              )}
              {canPublish && !proposalOpen && (
                <button
                  type="button"
                  onClick={() => {
                    setPublishedCount(null);
                    setProposalOpen(true);
                  }}
                  className={styles.textButton}
                >
                  {t("toBoardPublish")}
                </button>
              )}
            </div>
          </div>
        )}

      {/* The proposal derives from the list as it stands at open and
          is unmounted on close, so reopening derives afresh. */}
      {canPublish && proposalOpen && boardGroups && (
        <BoardPublishProposal
          eventId={eventId}
          locale={locale}
          groups={boardGroups}
          catalog={availableSongs}
          draft={predictions}
          onCancel={() => setProposalOpen(false)}
          onPublished={(count) => {
            setProposalOpen(false);
            setPublishedCount(count);
            onBoardPublished?.();
          }}
        />
      )}

      {/* Predicted rows */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
          <div className={styles.predictList}>
          {predictions.map((entry, idx) => {
            const rank = idx + 1;
            const state = rowState(rank, entry.songId);
            // Render the divider AFTER the row at index `total - 1`
            // (i.e. before the first below-rank row).
            const isLastInRank = showDivider && idx + 1 === total;
            return (
              <div key={entry.songId}>
                <PredictSongRow
                  entry={entry}
                  rank={rank}
                  state={state}
                  locked={isLocked}
                  locale={locale}
                  onRemove={() => handleRemove(entry.songId)}
                />
                {isLastInRank && <DuringShowDivider count={total} t={t} />}
              </div>
            );
          })}
          </div>
        </SortableContext>
      </DndContext>

      {/* During-show legend */}
      {isDuringShow && predictions.length > 0 && (
        <p className={styles.predictNote}>{t("legendLine")}</p>
      )}

      {/* Action row (pre-show only). Mobile shape: two secondary buttons
          side-by-side — picker trigger + copy-from-past trigger.
          Desktop with a populated picker: only copy-from-past
          (the picker itself is the always-visible right column,
          so a separate trigger button would be redundant). Desktop
          fallback (no picker — multi-artist festival or empty
          catalog): same as mobile shape, just without the picker
          trigger since `showPicker` is false. */}
      {isPreShow && (
        <div className={styles.predictActions}>
          {showPicker && !isDesktopPicker && (
            <button
              ref={pickerTrigger}
              type="button"
              onClick={() => setPickerOpen(true)}
              className={styles.secondaryButton}
            >
              {t("add")}
            </button>
          )}
          <button
            type="button"
            onClick={() => setCopyOpen(true)}
            className={styles.secondaryButton}
          >
            {t("copyFromPast")}
          </button>
        </div>
      )}

      {isPreShow && (
        <CopyPastSetlistSheet
          eventId={eventId}
          locale={locale}
          isLocked={isLocked}
          existingPredictions={predictions}
          open={copyOpen}
          onOpenChange={setCopyOpen}
          onApply={handleCopyApply}
          onFetched={handleCopyFetched}
        />
      )}

      {/* Mobile picker sheet — mounted only when the picker is
          available AND we're on a mobile-shape viewport. Desktop
          picker lives in the right column below the outer-div
          close. */}
      {showPicker && !isDesktopPicker && (
        <SongPickerSheet
          locale={locale}
          songs={availableSongs}
          selectedIds={selectedIds}
          unitFilters={unitFilters}
          open={pickerOpen}
          triggerRef={pickerTrigger}
          onOpenChange={setPickerOpen}
          onToggle={handleToggle}
        />
      )}

      {/* Post-show: share button (gated by ShareCardButton itself) */}
      <ShareCardButton
        eventId={eventId}
        seriesName={seriesName}
        eventTitle={eventTitle}
        dateLine={dateLine}
        locale={locale}
        status={status}
        actualSongs={actualSongs}
        predictions={predictions}
      />
      </div>
      {isDesktopPicker && (
        // Fixed-height lavender panel: the catalog list scrolls inside
        // it, so a festival catalog of hundreds of songs no longer
        // stretches the page to the list's full height.
        <div className={styles.inlinePicker}>
          <SongPickerContent
            songs={availableSongs}
            selectedIds={selectedIds}
            unitFilters={unitFilters}
            onToggle={handleToggle}
            locale={locale}
          />
        </div>
      )}
    </div>
  );
}

function DuringShowDivider({
  count,
  t,
}: {
  count: number;
  t: ReturnType<typeof useTranslations<"Predict">>;
}) {
  return (
    // 18-v3 `.progress-divider`: where the actual setlist has got to,
    // a blue rule with its label (was an amber band).
    <div className={styles.progressDivider}>{t("dividerLabel", { count })}</div>
  );
}
