import type { BoardColumnLabel } from "@/lib/board/types";

/**
 * Below this many distinct participants a column is an "early sample":
 * a 2-vs-1 result must not read like a landslide, so the UI shows
 * titles and counts only, no bars. Per column per group, not per event
 * — a busy group must not lift a quiet group's label.
 */
export const BOARD_EARLY_PARTICIPANTS = 5;

/**
 * Presentation label for one board column.
 *
 * Starter picks appear only at zero *submissions* — not zero
 * participants — so a column holding only legacy rows (submissions
 * without an anon id) already counts as fan data and is an early
 * sample, never an operator column.
 */
export function boardColumnLabel(
  submissions: number,
  participants: number,
): BoardColumnLabel {
  if (submissions === 0) return "operator";
  if (participants < BOARD_EARLY_PARTICIPANTS) return "early";
  return "ok";
}
