"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { SongSearch, type SongSearchResult } from "@/components/SongSearch";
import { PredictSongRow, type PredictRowState } from "@/components/PredictSongRow";
import { ShareCardButton } from "@/components/ShareCardButton";
import {
  readPredictionEntries,
  writePredictions,
  markLocked,
  type PredictionEntry,
} from "@/lib/predictionsStorage";
import { calcPredictScore } from "@/lib/predictScore";
import { isSongMatched } from "@/lib/songMatch";
import type { ResolvedEventStatus } from "@/lib/eventStatus";
import type { LiveSetlistItem } from "@/lib/types/setlist";
import { colors } from "@/styles/tokens";

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
  /** Series + event name for the share card text payload. */
  seriesName: string;
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
}: Props) {
  const t = useTranslations("Predict");
  const mounted = useMounted();

  // ─── Lock state (mirror <EventWishSection>) ─────────────────
  // Treat null startTime as "never lock" — the Predicted tab is
  // useful both on dated and TBA events. `Date.now() >= startMs`
  // semantic only fires when we actually have a startTime.
  const startMs = startTime
    ? startTime instanceof Date
      ? startTime.getTime()
      : new Date(startTime).getTime()
    : null;
  const [isLocked, setIsLocked] = useState(() =>
    startMs === null ? false : Date.now() >= startMs,
  );
  useEffect(() => {
    if (isLocked) return;
    if (startMs === null) return;
    const remaining = startMs - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => setIsLocked(true), remaining);
    return () => clearTimeout(timer);
  }, [isLocked, startMs]);

  // Stamp lockedAt to localStorage when lock fires for the first
  // time. `markLocked` is idempotent so a re-mount that re-reads a
  // stale `false` and then flips true won't overwrite the original
  // lock instant.
  useEffect(() => {
    if (isLocked) markLocked(eventId);
  }, [isLocked, eventId]);

  // ─── Predictions state ──────────────────────────────────────
  // Mounted-gated read of localStorage, mirroring EventWishSection
  // (avoids react-hooks/set-state-in-effect; the canonical project
  // pattern, see useMounted.ts:9-18).
  const [predictions, setPredictions] = useState<PredictionEntry[]>([]);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  if (mounted && hydratedKey !== eventId) {
    setHydratedKey(eventId);
    setPredictions(readPredictionEntries(eventId));
  }

  // ─── Search reveal toggle (pre-show only) ───────────────────
  const [searchOpen, setSearchOpen] = useState(false);

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
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      setPredictions((prev) => {
        const oldIndex = prev.findIndex((p) => p.songId === active.id);
        const newIndex = prev.findIndex((p) => p.songId === over.id);
        if (oldIndex < 0 || newIndex < 0) return prev;
        const next = arrayMove(prev, oldIndex, newIndex);
        writePredictions(eventId, next);
        return next;
      });
    },
    [eventId],
  );

  // ─── Add / remove handlers ──────────────────────────────────
  const handleAdd = useCallback(
    (song: SongSearchResult) => {
      // Client-side dedup: don't re-add a song already in the list.
      if (predictions.some((p) => p.songId === song.id)) {
        setSearchOpen(false);
        return;
      }
      const entry: PredictionEntry = {
        songId: song.id,
        song: {
          originalTitle: song.originalTitle,
          originalLanguage: song.originalLanguage,
          variantLabel: song.variantLabel,
          baseVersionId: song.baseVersionId,
          translations: song.translations,
        },
      };
      const next = [...predictions, entry];
      setPredictions(next);
      writePredictions(eventId, next);
      setSearchOpen(false);
    },
    [eventId, predictions],
  );

  const handleRemove = useCallback(
    (songId: number) => {
      const next = predictions.filter((p) => p.songId !== songId);
      setPredictions(next);
      writePredictions(eventId, next);
    },
    [eventId, predictions],
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
  const isPreShow = !isLocked && status !== "completed";
  const isDuringShow = isLocked && status !== "completed";

  function rowState(rank: number, songId: number): PredictRowState {
    // Pre-show: nothing to match against; everything renders default.
    if (isPreShow) return "default";
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

  return (
    <div>
      {/* Top status strip — mirrors mockup-wish-predict.jsx PredictTab top bar */}
      <div
        className="flex items-center justify-between"
        style={{
          padding: "7px 14px",
          background: colors.bgSubtle,
          borderBottom: `0.5px solid ${colors.borderLight}`,
        }}
      >
        <span
          className="text-[11px]"
          style={{ color: colors.textSecondary }}
        >
          {isPreShow && t("preShowHint", { count: predictions.length })}
          {isDuringShow && t("duringHint", { count: predictions.length })}
          {status === "completed" && t("afterHint")}
        </span>
        {(isDuringShow || status === "completed") && total > 0 && (
          <span
            className="text-xs font-medium"
            style={{ color: colors.primary }}
          >
            {t("finalScore", {
              matched: score.matched,
              total: score.total,
              pct: score.percentage,
            })}
          </span>
        )}
      </div>

      {/* Predicted rows */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
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
        </SortableContext>
      </DndContext>

      {/* During-show legend */}
      {isDuringShow && predictions.length > 0 && (
        <div
          className="text-[11px]"
          style={{
            padding: "6px 14px",
            color: colors.textMuted,
            background: colors.bgSubtle,
            borderTop: `0.5px solid ${colors.borderLight}`,
          }}
        >
          {t("legendLine")}
        </div>
      )}

      {/* + Add (pre-show only) */}
      {isPreShow && (
        <div style={{ borderTop: `0.5px solid ${colors.borderLight}` }}>
          {searchOpen ? (
            <div style={{ padding: "8px 14px", background: colors.bgSubtle }}>
              <SongSearch
                onSelect={handleAdd}
                locale={locale}
                texts={{
                  placeholder: t("searchPlaceholder"),
                  loading: t("searchLoading"),
                  noResults: t("searchNoResults"),
                }}
                excludeSongIds={predictions.map((p) => p.songId)}
                variant="compact"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                className="mt-1 text-[11px]"
                style={{
                  color: colors.textMuted,
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                {t("cancel")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="text-xs w-full text-left"
              style={{
                padding: "10px 14px",
                color: colors.primary,
                background: "transparent",
                border: "none",
                cursor: "pointer",
              }}
            >
              {t("add")}
            </button>
          )}
        </div>
      )}

      {/* Post-show: share button (gated by ShareCardButton itself) */}
      <ShareCardButton
        eventId={eventId}
        seriesName={seriesName}
        locale={locale}
        status={status}
        actualSongs={actualSongs}
        predictions={predictions}
      />
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
    <div
      className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider"
      style={{
        padding: "6px 14px",
        background: colors.predictDividerBg,
        borderTop: `2px solid ${colors.warning}`,
        borderBottom: `2px solid ${colors.warning}`,
        color: colors.predictDividerText,
      }}
    >
      <div className="flex-1" />
      <span style={{ whiteSpace: "nowrap" }}>{t("dividerLabel", { count })}</span>
      <div className="flex-1" />
    </div>
  );
}
