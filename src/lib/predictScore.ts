/**
 * Score functions for the Phase 1B Predicted Setlist + Share Card.
 *
 * Two related-but-distinct rules, both reusing `isSongMatched`
 * from `src/lib/songMatch.ts`:
 *
 *   1. `calcPredictScore` — POSITION-RANK rule used by the live
 *      Predicted tab. An actual N-th song "counts" only if the
 *      user predicted it within their top-N. Out-of-rank matches
 *      get displayed dimmed (returned in `pendingSongs`); they
 *      auto-promote to "counts" the moment the actual count
 *      catches up to their predicted rank. Teaches discipline:
 *      a 30-song prediction with the right songs at the wrong
 *      ranks scores worse than a tight 10-song prediction.
 *
 *   2. `calcShareCardScore` — ORDER-INDEPENDENT rule used by the
 *      post-show Share Card. Every match counts equally,
 *      regardless of predicted rank. The card celebrates hits;
 *      the live tab teaches rank discipline. Different goals,
 *      different rules.
 *
 * **Do not unify these two functions.** Both APIs leak distinct
 * shapes downstream (`pendingSongs` for the live tab, plain
 * `{matched, total}` for the share card). A unified function
 * would force every caller to consume the position-rank shape
 * even when they need order-independent counts. Per task spec:
 * `wiki/output/task-week2-predicted-setlist-and-share-card.md`
 * §"Match rule for share card (order-independent — distinct from
 * live tab)".
 */

import { isSongMatched, type SongMatchInputItem } from "@/lib/songMatch";

/**
 * Lean input shape the score functions actually need — just the
 * songId, in array-order=predicted-rank.
 *
 * **Distinct from `PredictionEntry`** in `predictionsStorage.ts`,
 * which is the full localStorage payload (`{songId, song:
 * WishSongDisplay}`). The two have different responsibilities:
 * the storage entry carries the display data needed to render the
 * UI without a round-trip; the match-input only needs the id.
 * Naming them differently prevents a caller from accidentally
 * passing a partial object and losing the song-display payload
 * mid-flow.
 */
export interface PredictionMatchInput {
  songId: number;
}

export interface PredictScore {
  /** Count of in-rank matches — `actualSong[N]` predicted in user's top-N. */
  matched: number;
  /** Total actual songs played so far (the denominator). */
  total: number;
  /** Round-half-up integer percentage. 0 when total === 0. */
  percentage: number;
  /**
   * SongIds the user predicted that played, but whose predicted
   * rank exceeds the current actual count. Display dimmed in
   * the Predicted tab; auto-promotes to in-rank as actual count
   * grows.
   */
  pendingSongs: number[];
}

/**
 * Position-rank score for the live Predicted tab.
 *
 * For each actual song, find its match in the user's prediction
 * (via `isSongMatched`, which handles direct id + variant via
 * `baseVersionId` + medley constituents). If found at index < total,
 * count it; otherwise stash the songId in `pendingSongs` for the
 * "out-of-rank but played" dimmed display.
 */
export function calcPredictScore(
  predicted: PredictionMatchInput[],
  actualItems: SongMatchInputItem[],
): PredictScore {
  const total = actualItems.length;
  let matched = 0;
  // Set-backed so a single prediction matching multiple actual rows
  // (medley with the same constituent twice; same-song-twice in
  // the actual setlist) only contributes ONE entry to the dimmed
  // out-of-rank display — the consumer (`<PredictedSetlist>`) maps
  // pendingSongs to row state by songId, so duplicates would cause
  // cosmetic noise without adding information. CR #281 caught this.
  const pendingSet = new Set<number>();

  for (const actual of actualItems) {
    // Find the predicted-rank index where this actual song matches.
    // -1 means the user didn't predict this song at all.
    const matchIndex = predicted.findIndex((p) =>
      isSongMatched(p.songId, [actual]),
    );
    if (matchIndex === -1) continue;
    if (matchIndex < total) {
      matched++;
    } else {
      pendingSet.add(predicted[matchIndex].songId);
    }
  }

  return {
    matched,
    total,
    percentage: total > 0 ? Math.round((matched / total) * 100) : 0,
    pendingSongs: Array.from(pendingSet),
  };
}

export interface ShareCardScore {
  matched: number;
  total: number;
  percentage: number;
}

/**
 * Order-independent score for the post-show Share Card.
 *
 * Iterates the actual setlist, asking "did the user predict THIS
 * song at any rank?" — every hit counts. Distinct from
 * `calcPredictScore` which gates by predicted-rank vs current
 * actual count. See file-level docstring for the design rationale.
 *
 * Deduped on the actual side via Set keyed on actual-item identity
 * so a single prediction matching a medley with multiple constituent
 * tracks still counts once per actual SetlistItem (matching task
 * spec verification §22 for "same song twice in actual setlist").
 */
export function calcShareCardScore(
  predicted: PredictionMatchInput[],
  actualItems: Array<SongMatchInputItem & { id: number | string }>,
): ShareCardScore {
  const matchedActualIds = new Set<number | string>();
  for (const actual of actualItems) {
    if (predicted.some((p) => isSongMatched(p.songId, [actual]))) {
      matchedActualIds.add(actual.id);
    }
  }
  const matched = matchedActualIds.size;
  const total = actualItems.length;
  return {
    matched,
    total,
    percentage: total > 0 ? Math.round((matched / total) * 100) : 0,
  };
}
