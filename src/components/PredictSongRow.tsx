"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslations } from "next-intl";
import { displayOriginalTitle } from "@/lib/display";
import type { PredictionEntry } from "@/lib/predictionsStorage";
import { colors, zIndex } from "@/styles/tokens";

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
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 14px",
        borderBottom: `0.5px solid ${colors.borderLight}`,
        opacity: isDimmed ? 0.4 : 1,
        // While dragging, lift the row visually + above siblings.
        // Reuses the `sticky` z-index token (= 10) since both
        // consumers want "above default flow, well below modals".
        zIndex: isDragging ? zIndex.sticky : "auto",
        background: isDragging ? colors.bgCard : "transparent",
        boxShadow: isDragging ? "0 1px 4px rgba(0,0,0,0.08)" : undefined,
      }}
    >
      {/* Rank number */}
      <span
        className="font-mono text-xs"
        style={{
          color: colors.textMuted,
          width: 18,
          textAlign: "right",
          flexShrink: 0,
        }}
      >
        {rank}
      </span>

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
          className="cursor-grab active:cursor-grabbing touch-none"
          style={{
            border: "none",
            background: "transparent",
            padding: 0,
            color: colors.textMuted,
            fontSize: 12,
            flexShrink: 0,
            // Touch devices: prevent the browser from intercepting
            // the drag as a scroll gesture.
          }}
        >
          ⠿
        </button>
      )}

      {/* Song title */}
      <span
        className="text-[13px] flex-1 truncate min-w-0"
        style={
          isMatched
            ? {
                background: colors.wishlistMatchBg,
                color: colors.wishlistMatchText,
                borderRadius: 4,
                padding: "1px 5px",
              }
            : { color: colors.textPrimary }
        }
      >
        {display.main}
        {display.sub && (
          <span
            className="ml-1 text-[11px]"
            style={{ color: colors.textMuted }}
          >
            {display.sub}
          </span>
        )}
      </span>

      {/* Remove button — pre-show only. */}
      {!locked && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("removeAria")}
          className="text-[11px] cursor-pointer"
          style={{
            border: "none",
            background: "transparent",
            color: colors.textMuted,
            padding: 0,
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
