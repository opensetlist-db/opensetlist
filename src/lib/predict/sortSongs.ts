/**
 * Sort modes of the song picker (`<SongPickerContent>`), shared by the
 * Predicted Setlist picker and the fan board's group pickers.
 *
 *   - `name`    — the catalog's own order, untouched. The server already
 *                 returns `originalTitle ASC` (Postgres collation), and
 *                 re-sorting in JS with `localeCompare` would disagree
 *                 with it on kana / Latin mixes — so "by name" means
 *                 "as delivered". On a festival the merged catalog is
 *                 group by group, each group title-ordered, which the
 *                 picker's section headers mirror.
 *   - `release` — newest `releaseDate` first; songs without a date go
 *                 last (an unknown date is not "oldest"); equal dates
 *                 keep the catalog order, i.e. by title. `Array.sort`
 *                 is stable (ES2019+), so a 0 comparison is the title
 *                 tie-break.
 *
 * `releaseDate` is `YYYY-MM-DD`, so lexical comparison is date order.
 * Pure and non-mutating: the input may be a memoized / cached array.
 */
export type PickerSort = "name" | "release";

export function sortPickerSongs<T extends { releaseDate: string | null }>(
  songs: readonly T[],
  sort: PickerSort,
): T[] {
  if (sort === "name") return [...songs];
  return [...songs].sort((a, b) => {
    if (a.releaseDate === b.releaseDate) return 0;
    if (a.releaseDate === null) return 1;
    if (b.releaseDate === null) return -1;
    return a.releaseDate < b.releaseDate ? 1 : -1;
  });
}
