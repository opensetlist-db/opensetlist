/**
 * Board expected songs → prediction entries (n15).
 *
 * The Predict builder's "import my expected songs" appends the fan's
 * board expected songs to their setlist prediction. Rules:
 *   - Expected songs only — never wishes: the setlist is a prediction,
 *     and wishes are what the fan wants, not what they expect.
 *   - Grouped by board group, in board order; picks carry no rank, so
 *     the caller flags the list provisional until the fan reorders it.
 *
 * Runs in the browser only (localStorage); no network, no cache.
 */
import type { StoredBoardPick } from "@/lib/board/pickStorage";
import type { AvailableSong } from "@/lib/types/predict";
import type { PredictionEntry } from "@/lib/predictionsStorage";

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
