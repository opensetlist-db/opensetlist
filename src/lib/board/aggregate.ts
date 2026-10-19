import { boardColumnLabel } from "@/lib/board/thresholds";
import type { BoardColumn } from "@/lib/board/types";

/**
 * Pure rules of the fan board's crowd aggregate (n15). The cached
 * loader in `boardRead.ts` feeds these grouped DB counts; keeping the
 * rules here makes them testable without a database and lets the
 * post-show tally reuse the exact same ranking — the shortlist
 * graded after the show must be the TOP3 fans saw before it.
 */

/** Rows shown per column. */
export const BOARD_TOP_SIZE = 3;

/** One song's picks within one group column. */
export interface BoardSongCount {
  songId: string;
  count: number;
  /** When the song was first picked in this column. */
  firstAt: Date;
}

/** Decimal-string id compare without `Number` (ids are BigInt-safe on
 *  the wire): shorter is smaller, equal length compares lexically. */
function compareIds(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * TOP3 of one column. Ranking is total and deterministic so every
 * cache entry (and the post-lock shortlist) agrees on ties:
 *   1. submission count, descending
 *   2. earliest first submission — the song fans thought of first
 *   3. song id, ascending (numeric)
 */
export function rankBoardSongs(
  rows: readonly BoardSongCount[],
): BoardSongCount[] {
  return [...rows]
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.firstAt.getTime() - b.firstAt.getTime() ||
        compareIds(a.songId, b.songId),
    )
    .slice(0, BOARD_TOP_SIZE);
}

/**
 * Fold one more batch of submissions of the same song into `into`:
 * counts add, the earlier first submission wins. Mutates `into`.
 */
export function addSongCount(into: BoardSongCount, more: BoardSongCount): void {
  into.count += more.count;
  if (more.firstAt.getTime() < into.firstAt.getTime()) into.firstAt = more.firstAt;
}

/**
 * File legacy wishes (n15) under the board's groups.
 *
 * A legacy wish (written before per-group wishes, so no stored group
 * and no anon id) still counts — it is a real submission — under the
 * group its song resolves to. `groupOf` answers that (first board
 * group in roster order whose catalog holds the song, or null). A
 * legacy wish that resolves to no group appears in no column; it still
 * counts in the event's overall wish TOP3, which reads the table
 * directly and knows nothing of groups.
 *
 * A song wished both the legacy way and under a group merges into one
 * row: counts add, the earlier first submission wins. Inputs are not
 * mutated; the result is a new map.
 */
export function mergeLegacyWishes(
  byGroup: ReadonlyMap<string, readonly BoardSongCount[]>,
  legacy: readonly BoardSongCount[],
  groupOf: (songId: string) => string | null,
): Map<string, BoardSongCount[]> {
  const out = new Map<string, BoardSongCount[]>();
  for (const [groupId, rows] of byGroup) {
    out.set(groupId, rows.map((r) => ({ ...r })));
  }
  for (const row of legacy) {
    const groupId = groupOf(row.songId);
    if (groupId === null) continue;
    const rows = out.get(groupId) ?? [];
    const same = rows.find((r) => r.songId === row.songId);
    if (same) {
      addSongCount(same, row);
    } else {
      rows.push({ ...row });
    }
    out.set(groupId, rows);
  }
  return out;
}

/**
 * One group's column — "want" (wishes) or "expect" (picks); both use
 * the same ranking, counts and labels.
 *
 * `submissions` totals EVERY row of the column, not just the TOP3 —
 * it is what decides "operator" (zero) vs fan data. `participants`
 * (distinct non-null anon ids) comes from a separate count because one
 * fan contributes up to three rows.
 *
 * `titleOf` resolves a title from the group's cached catalog, which
 * holds only live base songs. A song missing there was soft-deleted
 * after it was picked: it keeps its votes and its rank (moderation must
 * not silently reshuffle the board) but is sent with an empty title and
 * `available: false` — the UI renders it as "removed" without a link.
 * The catalog is the only title source on purpose: the aggregate adds
 * no song query of its own.
 */
export function buildBoardColumn(
  rows: readonly BoardSongCount[],
  participants: number,
  titleOf: (songId: string) => string | null,
): BoardColumn {
  const submissions = rows.reduce((sum, r) => sum + r.count, 0);
  const top = rankBoardSongs(rows).map((r) => {
    const title = titleOf(r.songId);
    return {
      songId: r.songId,
      title: title ?? "",
      count: r.count,
      available: title !== null,
    };
  });
  return {
    top,
    submissions,
    participants,
    label: boardColumnLabel(submissions, participants),
  };
}
