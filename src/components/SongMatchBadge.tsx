"use client";

import type { ReactNode } from "react";
import { isSongMatched, type SongMatchInputItem } from "@/lib/songMatch";
import { colors } from "@/styles/tokens";

interface Props {
  songId: number;
  setlistItems: SongMatchInputItem[];
  /**
   * Skip the green-bg highlight even when the song would otherwise
   * match. Used by `<EventWishSection>` to suppress badges in the
   * pre-show state — match-highlights only make sense after the
   * actual setlist exists, and the wishlist's pre-show display
   * intentionally reads as "candidate songs" not "winners".
   */
  disabled?: boolean;
  children: ReactNode;
}

/**
 * Inline wrapper that paints a green-bg + green-text highlight when
 * `songId` matches anything in `setlistItems` per `isSongMatched()`
 * (direct id, or variant via `baseVersionId`). When not matched (or
 * `disabled`), renders `children` byte-identically with no wrapper
 * styles — drop-in safe inside flex/grid rows.
 *
 * Shared with the future `<PredictedSetlist>` per
 * `wiki/output/task-week2-wishlist-feature.md` "Match-highlight"
 * decision: the green-bg rule is one definition, two consumers.
 */
export function SongMatchBadge({
  songId,
  setlistItems,
  disabled = false,
  children,
}: Props) {
  const matched = !disabled && isSongMatched(songId, setlistItems);
  if (!matched) {
    // Pass-through. No wrapper element so flex/grid layouts that
    // depend on the child being a direct child still work.
    return <>{children}</>;
  }
  return (
    <span
      // Inline-block so background-color paints around the text
      // without breaking the surrounding flex row's truncation
      // (`overflow:hidden + text-overflow:ellipsis` on the parent).
      style={{
        background: colors.wishlistMatchBg,
        color: colors.wishlistMatchText,
        borderRadius: 3,
        padding: "0 4px",
        // Ensure the highlight respects the parent's truncation rules
        // — without this, Safari sometimes paints the bg outside the
        // clipped text region.
        display: "inline-block",
        maxWidth: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        verticalAlign: "bottom",
      }}
    >
      {children}
    </span>
  );
}
