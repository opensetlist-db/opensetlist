/**
 * CSS grid template shared between the desktop SeriesBlock's
 * table-header strip and each EventTableRow. Single source of truth
 * so the column widths can never drift between header and body.
 *
 *   Date | Status | Event name | Venue | Songs | ›
 *
 * Date track widened from 90px to 110px to fit the year-included
 * format `2026년 4월 25일` / `April 25, 2026` (operator feedback
 * 2026-04-29). Korean's `2026년 4월 25일` is the tightest at fontSize
 * 12 (~95px); 110px gives breathing room.
 */
export const EVENT_TABLE_COLUMNS =
  "110px 100px 1fr 200px 60px 28px";
