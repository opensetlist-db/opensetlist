"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslations } from "next-intl";
import { displayOriginalTitle } from "@/lib/display";
import type { PredictionEntry } from "@/lib/predictionsStorage";
import styles from "@/components/event/eventDetail.module.css";
import { colors, zIndex } from "@/styles/tokens";

import { DIMMED_ROW_OPACITY } from "@/components/predict-row-style";

/**
 * Visual state per the mockup's during-show divider rules:
 *   - "default":              pre-show, or post-show non-match
 *   - "matched-in-rank":      green bg + green text (counts toward score)
 *   - "matched-out-of-rank":  green bg + green text + opacity 0.4
 *                             (played, but predicted-rank > current actual count)
 *   - "below-divider":        opacity 0.4, no green (predicted but
 *                             not yet matched and below the divider)
 */
export type PredictRowState =
  | "default"
  | "matched-in-rank"
  | "matched-out-of-rank"
  | "below-divider";

interface Props {
  entry: PredictionEntry;
  rank: number;
  state: PredictRowState;
  /** Pre-show only. Drag handle, ✕ remove hidden when locked. */
  locked: boolean;
  locale: string;
  onRemove: () => void;
}

/**
 * Single row in the Predicted Setlist.
 *
 * Mockup source: `raw/mockups/mockup-wish-predict.jsx` PredictTab
 * row rendering (lines 441-459).
 *
 * Drag handle uses `useSortable` from @dnd-kit to expose the
 * row's drag listeners ONLY on the handle (not the whole row) —
 * this lets the user tap the title or ✕ button without
 * accidentally starting a drag. `attributes` + `listeners` are
 * spread on the handle span; `setNodeRef` + `transform` go on
 * the row container.
 */
export function PredictSongRow({
  entry,
  rank,
  state,
  locked,
  locale,
  onRemove,
}: Props) {
  const t = useTranslations("Predict");
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.songId, disabled: locked });

  const display = displayOriginalTitle(
    {
      originalTitle: entry.song.originalTitle,
      originalLanguage: entry.song.originalLanguage,
      variantLabel: entry.song.variantLabel,
    },
    entry.song.translations,
    locale,
  );

  const isMatched =
    state === "matched-in-rank" || state === "matched-out-of-rank";
  const isDimmed =
    state === "matched-out-of-rank" || state === "below-divider";

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDimmed ? DIMMED_ROW_OPACITY : 1,
        // While dragging, lift the row above siblings. Reuses the
        // `sticky` z-index token (= 10) since both consumers want
        // "above default flow, well below modals".
        zIndex: isDragging ? zIndex.sticky : "auto",
        boxShadow: isDragging ? "0 1px 4px rgba(0,0,0,0.08)" : undefined,
      }}
      // 18-v3 `.prediction-list li`: a white card row with a lavender
      // rank chip; rows outside the counted rank get the muted wash
      // on top of the existing dimming.
      className={`${styles.predictRow} ${isDimmed ? styles.predictRowOut : ""}`}
    >
      {/* Rank number */}
      <span className={styles.predictRank}>{rank}</span>

      {/* Drag handle — only when unlocked. The grip glyph (⠿) is
          common in drag UI but use the visually similar Braille
          pattern dot (U+2820) which renders consistently across
          fonts. */}
      {!locked && (
        <button
          type="button"
          aria-label={t("dragHandleAria")}
          {...attributes}
          {...listeners}
          // `touch-none`: touch devices must not take the drag as a
          // scroll gesture.
          className={`${styles.predictTool} cursor-grab active:cursor-grabbing touch-none`}
        >
          ⠿
        </button>
      )}

      {/* Song title */}
      <span
        className={styles.predictTitle}
        style={
          isMatched
            ? {
                background: colors.wishlistMatchBg,
                color: colors.wishlistMatchText,
                borderRadius: 4,
                padding: "1px 5px",
              }
            : undefined
        }
      >
        {display.main}
        {display.sub && (
          <span className={styles.songSub}> {display.sub}</span>
        )}
      </span>

      {/* Remove button — pre-show only. */}
      {!locked && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("removeAria")}
          className={styles.predictTool}
        >
          ✕
        </button>
      )}
    </div>
  );
}
