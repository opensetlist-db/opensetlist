/**
 * Bridge: full setlist draft → board proposal (n15).
 *
 * "Put on the board" turns the fan's ordered Predict list into the
 * expected songs it implies: per group, the first three songs of that
 * group in list order. The result is a PROPOSAL — the fan edits it
 * (swap a song, choose the group of a crossover) and only an explicit
 * confirm publishes it. Nothing here writes, and nothing keeps the two
 * modes in sync afterwards: a later edit to the list leaves the
 * published picks alone until the fan publishes again.
 *
 * Pure and browser-free, so the derivation is tested without storage.
 */

import { BOARD_PICKS_PER_GROUP } from "@/lib/board/config";
import type { StoredBoardPick } from "@/lib/board/pickStorage";
import type { PredictionEntry } from "@/lib/predictionsStorage";
import type { AvailableSong } from "@/lib/types/predict";

/** One expected song of a proposal. Ids are decimal strings, like
 *  every board id on the client. */
export interface ProposalPick {
  songId: string;
  /** The group the song would be counted under. */
  groupId: string;
  /** Every board group whose catalog has the song, in board order. One
   *  entry for most songs; two or more for a crossover — the fan picks
   *  which one it counts under (it is never counted twice). */
  choices: string[];
}

/**
 * Which board groups each catalog song belongs to. On a festival every
 * catalog row lists its root groups (`festivalGroupIds`); on a
 * single-artist event that list is empty everywhere and the whole
 * catalog is the one group's — the same rule the board block uses for
 * its per-group pickers (`FanBoardSection` `songsOf`), so the proposal
 * never offers a song the board itself wouldn't.
 */
export function boardGroupsBySong(
  groupIds: readonly string[],
  catalog: readonly AvailableSong[],
): Map<string, string[]> {
  const isFestival = catalog.some((s) => s.festivalGroupIds.length > 0);
  const map = new Map<string, string[]>();
  for (const s of catalog) {
    const groups = isFestival
      ? groupIds.filter((g) => s.festivalGroupIds.includes(Number(g)))
      : groupIds.length === 1
        ? [groupIds[0]]
        : [];
    if (groups.length > 0) map.set(String(s.songId), groups);
  }
  return map;
}

/**
 * Derive the proposal from the ordered list.
 *
 *   - A variant counts as its base song (board picks are base songs;
 *     "Dream Believers (SAKURA Ver.)" in the list means "Dream
 *     Believers" on the board). A base song listed twice — itself and a
 *     variant — is proposed once, at its first position.
 *   - Songs on no board group's catalog (a guest's song, a song
 *     moderated out since it was listed) are skipped.
 *   - A crossover goes to the first of its groups (board order) that
 *     still has room, and carries all of them as `choices`. With every
 *     one of its groups full it is left out, like any fourth song.
 *
 * Returned in list order; the UI groups by `groupId`.
 */
export function deriveBoardProposal(
  draft: readonly PredictionEntry[],
  groupIds: readonly string[],
  catalog: readonly AvailableSong[],
): ProposalPick[] {
  const groupsOf = boardGroupsBySong(groupIds, catalog);
  const filled = new Map<string, number>();
  const seen = new Set<string>();
  const out: ProposalPick[] = [];
  for (const e of draft) {
    const baseId = String(e.song.baseVersionId ?? e.songId);
    if (seen.has(baseId)) continue;
    seen.add(baseId);
    const choices = groupsOf.get(baseId);
    if (!choices) continue;
    const target = choices.find(
      (g) => (filled.get(g) ?? 0) < BOARD_PICKS_PER_GROUP,
    );
    if (!target) continue;
    filled.set(target, (filled.get(target) ?? 0) + 1);
    out.push({ songId: baseId, groupId: target, choices });
  }
  return out;
}

export interface PublishPreview {
  /** Current picks the publish leaves in place (same song, same group). */
  kept: StoredBoardPick[];
  /** Current picks the publish deletes — including a song that moves
   *  to another group: the server re-creates it there as a new pick. */
  removed: StoredBoardPick[];
  /** Proposal songs that become new picks. */
  added: ProposalPick[];
}

/** What confirming `proposal` would do to the fan's current picks. */
export function previewPublish(
  proposal: readonly ProposalPick[],
  mine: readonly StoredBoardPick[],
): PublishPreview {
  const k = (groupId: string, songId: string) => `${groupId}:${songId}`;
  const proposed = new Set(proposal.map((p) => k(p.groupId, p.songId)));
  const current = new Set(mine.map((p) => k(p.groupId, p.songId)));
  return {
    kept: mine.filter((p) => proposed.has(k(p.groupId, p.songId))),
    removed: mine.filter((p) => !proposed.has(k(p.groupId, p.songId))),
    added: proposal.filter((p) => !current.has(k(p.groupId, p.songId))),
  };
}
