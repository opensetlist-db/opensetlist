/**
 * Helpers for the "지난 공연 세트리스트로 예상 시드 채우기" feature.
 *
 * The Predicted Setlist surface stores a flat `PredictionEntry[]` list
 * in localStorage. Past-event setlists, however, live in the relational
 * schema as `SetlistItem` rows with two layers of structure:
 *   - One row per slot (1, 2, ... position), possibly a medley with
 *     multiple `SetlistItemSong` entries.
 *   - Each song may be a *variant* (`baseVersionId !== null`) of a base
 *     song — e.g. "Dream Believers (SAKURA Ver.)" vs the canonical
 *     "Dream Believers".
 *
 * Copying naively (every song from every medley, variants kept as-is)
 * inflates the prediction list and degrades the matching contract:
 *   - A 32-row past show with 5 three-song medleys would seed 42
 *     predictions against a new show that still only has 32 actual
 *     items, pushing the extra 10 below the "matched up to rank N"
 *     divider where they can no longer score.
 *   - A variant id only matches the same variant; a new show that
 *     plays a different variant of the same base would miss, even
 *     though the user "predicted the song" in spirit.
 *
 * The transform here picks the conservative seed: first song of each
 * medley, base song wherever a base exists, dedup by resolved songId.
 * That keeps SetlistItem ↔ PredictionEntry as a 1:1 mapping and lets
 * `isSongMatched`'s base↔variant equivalence absorb any per-show
 * variant differences at score time.
 */

import type { PredictionEntry } from "@/lib/predictionsStorage";

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);

/**
 * Convert a `bigint` to `number` only when the value fits inside the
 * JS safe-integer range. A naïve `Number(bigint)` silently truncates
 * values above 2^53-1, which is corrupting in two distinct ways here:
 *
 *  1. The `seen` Set keys the dedup by the converted number — two
 *     distinct unsafe BigInts would collide and silently merge into
 *     one entry.
 *  2. `PredictionEntry.songId` is typed `number` and surfaces all the
 *     way to localStorage / `isSongMatched`; a truncated id matches
 *     the wrong song or no song at all.
 *
 * Returning `null` for out-of-range values lets the caller treat the
 * row as data damage and skip it (mirroring the project-wide
 * `nullableBigIntId` policy of rejecting silently-rounded JSON
 * numbers at write time). At Phase 1 scale autoincrement ids stay
 * well below 2^53, so this guard is belt-and-suspenders — but the
 * dedup correctness contract is real-time, not theoretical.
 */
export function safeBigIntToNumber(value: bigint): number | null {
  if (value > MAX_SAFE_BIGINT) return null;
  if (value < MIN_SAFE_BIGINT) return null;
  return Number(value);
}

/**
 * Subset of the `Song` row the API selects for this feature. We deliberately
 * keep the shape minimal — `flattenSetlistToPredictions` is the single
 * consumer, and any field it doesn't read should not be carried over the
 * wire.
 */
interface SongCore {
  id: bigint;
  originalTitle: string;
  originalLanguage: string;
  variantLabel: string | null;
  baseVersionId: bigint | null;
  isDeleted: boolean;
  translations: Array<{
    locale: string;
    title: string;
    variantLabel: string | null;
  }>;
}

/** Variant `Song` with its base loaded via the `SongVariants` self-relation. */
interface SongWithBase extends SongCore {
  baseVersion: SongCore | null;
}

/** Shape the API hands us per past `SetlistItem`. */
export interface SetlistItemSlim {
  position: number;
  songs: Array<{
    order: number | null;
    song: SongWithBase;
  }>;
}

/**
 * Flatten + transform + dedup. Steps, applied per SetlistItem in input
 * order (caller guarantees `items` is position-ASC and each item's
 * `songs[]` is order-ASC):
 *
 *  1. Medley → first song only. `songs[0]` is taken; the rest of the
 *     medley is intentionally dropped. Medleys vary the most across
 *     shows — keeping only the opener gives the safest seed.
 *  2. Variant → base. If the picked song has a `baseVersionId` and its
 *     `baseVersion` was eager-loaded and is alive, swap to the base.
 *     A base that's soft-deleted (degenerate but possible) is treated
 *     as data damage — we drop the whole SetlistItem rather than
 *     silently falling back to the variant.
 *  3. `isDeleted` skip. After resolving to the effective song, drop
 *     anything that's been soft-deleted.
 *  4. Dedup by resolved songId. Two variants of the same base resolve
 *     to one entry; the same song repeated across positions stays
 *     once. First-occurrence order is preserved.
 */
export function flattenSetlistToPredictions(
  items: SetlistItemSlim[],
): PredictionEntry[] {
  const out: PredictionEntry[] = [];
  const seen = new Set<number>();
  for (const item of items) {
    const first = item.songs[0];
    if (!first) continue; // empty medley row (data damage) — skip
    const variant = first.song;
    // Variant → base if base is loaded and alive. baseVersion missing
    // when there's a baseVersionId is data damage; we'd rather skip
    // than emit a variant where the user expects the canonical title.
    let effective: SongCore | null;
    if (variant.baseVersionId !== null) {
      effective =
        variant.baseVersion && !variant.baseVersion.isDeleted
          ? variant.baseVersion
          : null;
    } else {
      effective = variant;
    }
    if (!effective) continue;
    if (effective.isDeleted) continue;
    const id = safeBigIntToNumber(effective.id);
    // Unsafe id → skip the whole entry. Dropping it from `seen` /
    // `out` keeps the dedup Set keyed on values where number equality
    // still implies bigint equality.
    if (id === null) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    // `baseVersionId` is metadata only (display + downstream
    // matching), never a Set key here — but if it's unsafe we still
    // null it out rather than emitting a truncated value the client
    // might compare against another truncated id elsewhere.
    const carriedBaseVersionId =
      effective.baseVersionId === null
        ? null
        : safeBigIntToNumber(effective.baseVersionId);
    out.push({
      songId: id,
      song: {
        originalTitle: effective.originalTitle,
        originalLanguage: effective.originalLanguage,
        variantLabel: effective.variantLabel,
        baseVersionId: carriedBaseVersionId,
        translations: effective.translations,
      },
    });
  }
  return out;
}

/**
 * Canonical dedup key for a `PredictionEntry`: the base song's id when
 * the entry is a variant, otherwise the song's own id. This matches
 * the variant↔base equivalence `isSongMatched` uses at score time —
 * "Dream Believers" and "Dream Believers (SAKURA Ver.)" are the same
 * song for matching purposes, so the merge contract should treat them
 * the same way.
 *
 * Without this, a user who manually predicted the SAKURA variant
 * (songId=105, baseVersionId=100) and then seeds from a past show
 * (which transforms variants → base, songId=100) would get both
 * entries appended under "추가하기 (중복 제외)" — visually two rows
 * for the same song. CR #392-#397 caught this on the merge helpers.
 */
function canonicalSongKey(entry: PredictionEntry): number {
  return entry.song.baseVersionId ?? entry.songId;
}

/**
 * Append `incoming` entries to `existing` that aren't already there,
 * matched by `canonicalSongKey` (base id when variant, else songId).
 * Preserves the existing entries' order and pushes new entries to the
 * end in their incoming order.
 *
 * Used by the "추가하기 (중복 제외)" merge mode. The "새로 시작하기"
 * mode just discards `existing` and uses `incoming` directly, so it
 * doesn't need a helper.
 */
export function mergeAppendUnique(
  existing: PredictionEntry[],
  incoming: PredictionEntry[],
): PredictionEntry[] {
  const have = new Set(existing.map(canonicalSongKey));
  const result = existing.slice();
  for (const e of incoming) {
    const key = canonicalSongKey(e);
    if (have.has(key)) continue;
    have.add(key);
    result.push(e);
  }
  return result;
}

/**
 * Count how many `incoming` entries are already present in `existing`,
 * keyed by `canonicalSongKey`. Drives the confirm panel's
 * "중복 D곡 제외" preview number. Pure counting only — no allocation
 * of the merged list.
 */
export function dedupCountForMerge(
  existing: PredictionEntry[],
  incoming: PredictionEntry[],
): number {
  const have = new Set(existing.map(canonicalSongKey));
  let dup = 0;
  for (const e of incoming) {
    if (have.has(canonicalSongKey(e))) dup++;
  }
  return dup;
}
