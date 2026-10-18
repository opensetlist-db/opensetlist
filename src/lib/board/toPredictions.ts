/**
 * Bridge: board picks → full setlist draft (n15-09a).
 *
 * "Go to full setlist mode" seeds the Predict builder with the fan's
 * expected songs so the two prediction modes feel like one feature.
 * Rules, all from the n15 spec:
 *   - Expected songs only — never wishes. The caller passes the
 *     expected-song picks (`useBoardPicks`); wishes live elsewhere.
 *   - Pre-fill ONLY an empty list. A list the fan already built is
 *     never touched, not even merged into: its order is the fan's own
 *     work, and silently appending would push their ranking around.
 *   - Grouped by board group, unordered within a group: picks carry no
 *     rank, so the draft is flagged `provisional` and the builder says
 *     so until the fan reorders it.
 *
 * Runs in the browser only (localStorage); no network, no cache.
 */

import type { StoredBoardPick } from "@/lib/board/pickStorage";
import type { AvailableSong } from "@/lib/types/predict";
import {
  readPredictionEntries,
  writePredictions,
  type PredictionEntry,
} from "@/lib/predictionsStorage";

export type BoardToBuilderOutcome =
  /** An empty list was pre-filled with `count` songs. */
  | { kind: "imported"; count: number }
  /** The fan already has a list; it was left exactly as it was. */
  | { kind: "kept" }
  /** Nothing importable (no picks, or none still in the catalog). */
  | { kind: "none" };

/**
 * Board picks → builder entries, in board group order.
 *
 * A pick is skipped when it is unavailable (moderated out — the caller
 * folds per-group catalog availability into `available`, as the copy
 * text does) or when the catalog lacks the song: the builder renders
 * each entry from its embedded display payload, which only the catalog
 * can supply. A song picked under two groups (a crossover; the server
 * refuses this, but older local data may hold it) lands once, under
 * the first group. Picks of a group the board no longer lists go last
 * rather than vanishing.
 */
export function predictionsFromBoardPicks(
  picks: readonly StoredBoardPick[],
  groupOrder: readonly string[],
  catalog: readonly AvailableSong[],
): PredictionEntry[] {
  const byId = new Map(catalog.map((s) => [String(s.songId), s]));
  const rank = (groupId: string) => {
    const i = groupOrder.indexOf(groupId);
    return i < 0 ? groupOrder.length : i;
  };
  // `sort` is stable, so picks keep their stored order within a group.
  const ordered = [...picks].sort((a, b) => rank(a.groupId) - rank(b.groupId));
  const seen = new Set<string>();
  const entries: PredictionEntry[] = [];
  for (const p of ordered) {
    if (!p.available || seen.has(p.songId)) continue;
    const song = byId.get(p.songId);
    if (!song) continue;
    seen.add(p.songId);
    entries.push({
      songId: song.songId,
      song: {
        originalTitle: song.originalTitle,
        originalLanguage: song.originalLanguage,
        variantLabel: song.variantLabel,
        baseVersionId: song.baseVersionId,
        translations: song.translations,
      },
    });
  }
  return entries;
}

/**
 * Pre-fill the event's prediction list from board picks, unless the
 * fan already has one. "Kept" is reported only when there was
 * something to import — a fan with a list and no picks just switches
 * modes, with no "we didn't change your list" notice to puzzle over.
 */
export function importBoardPicksToPredictions({
  eventId,
  picks,
  groupOrder,
  catalog,
}: {
  eventId: string;
  picks: readonly StoredBoardPick[];
  groupOrder: readonly string[];
  catalog: readonly AvailableSong[];
}): BoardToBuilderOutcome {
  const entries = predictionsFromBoardPicks(picks, groupOrder, catalog);
  if (entries.length === 0) return { kind: "none" };
  if (readPredictionEntries(eventId).length > 0) return { kind: "kept" };
  writePredictions(eventId, entries, { provisional: true });
  return { kind: "imported", count: entries.length };
}

/**
 * A "go to full setlist mode" tap, as `<LiveSetlist>` hands it to the
 * setlist section. `seq` grows on every tap so a second tap re-opens
 * the Predict tab (and re-reads storage) even with an identical
 * outcome.
 */
export interface BuilderRequest {
  seq: number;
  outcome: BoardToBuilderOutcome;
}
