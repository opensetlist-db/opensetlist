import type {
  BoardGroupTally,
  BoardTally,
  BoardTopEntry,
} from "@/lib/board/types";

/**
 * Pure rules of the post-show tally (n15). The cached loader in
 * `boardRead.ts` feeds these; nothing here touches the database.
 *
 * What gets graded: each group's SHORTLIST — the expect column's TOP3
 * computed by the crowd TOP3 ranking over the picks that existed at the
 * lock. The loader builds that column from at-lock picks only, so the
 * shortlist is that column's `top`, and the grade is of exactly the
 * TOP3 fans saw when picking closed. Operator starters are not picks
 * and are never graded.
 *
 * What counts as played: the share card's lenient rule
 * (`isSongMatched`): a shortlisted base song is played when the final
 * setlist holds the song itself, any variant of it, or a medley that
 * includes it. Ids here are decimal strings (BigInt-safe), where
 * `isSongMatched` takes numbers, hence a set instead of a call to it.
 */

/** One song of the final setlist, as the loader reads it: one row per
 *  `SetlistItemSong`, so a medley is several rows. */
export interface SetlistSongRow {
  songId: string;
  baseVersionId: string | null;
}

/** Every id the setlist counts as played: each song and the base of
 *  each variant (so a shortlisted base matches "… (SAKURA Ver.)"). */
export function playedSongIds(rows: readonly SetlistSongRow[]): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    out.add(r.songId);
    if (r.baseVersionId !== null) out.add(r.baseVersionId);
  }
  return out;
}

/**
 * Grade every group's shortlist against the played set.
 *
 * Per group: K = the shortlist's size (≤ 3; fewer when fewer distinct
 * songs were picked, 0 when nobody picked). Overall: K = the DISTINCT
 * songs across all shortlists, so a song shortlisted under two groups
 * (a festival song credited to both) counts once — and is played once.
 * A soft-deleted song keeps its shortlist slot and counts toward K; it
 * can still be played if the setlist names it.
 */
export function tallyBoard(
  shortlists: readonly { groupId: string; top: readonly BoardTopEntry[] }[],
  played: ReadonlySet<string>,
): BoardTally {
  const distinct = new Map<string, boolean>();
  const groups: BoardGroupTally[] = shortlists.map(({ groupId, top }) => {
    const shortlist = top.map((e) => ({ ...e, played: played.has(e.songId) }));
    for (const e of shortlist) distinct.set(e.songId, e.played);
    return {
      groupId,
      shortlist,
      played: shortlist.filter((e) => e.played).length,
      size: shortlist.length,
    };
  });
  return {
    played: [...distinct.values()].filter(Boolean).length,
    size: distinct.size,
    groups,
    playedSongIds: [...played],
  };
}
