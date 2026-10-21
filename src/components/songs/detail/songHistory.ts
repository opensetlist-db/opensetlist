import type { ResolvedEventStatus } from "@/lib/eventStatus";

/*
 * Series grouping for the Song detail history tab. Pure, so the ordering
 * rules are unit-testable without rendering the page. The rules are the
 * pre-redesign page's, unchanged:
 *   - one row per appearance (SetlistItemSong), keyed by setlistItemId,
 *     so a song played twice in one event keeps both rows;
 *   - inside a group, newest event date first;
 *   - a group holding an ongoing event is pinned first, the rest by
 *     their newest event; events without a series form the "other"
 *     group, always last;
 *   - `seriesCount` counts distinct series among the fetched rows (the
 *     history is capped at the 50 latest appearances, the total count
 *     is not).
 */

export interface SongHistoryRow {
  /** setlistItemId — unique per appearance. */
  id: string;
  seriesId: string | null;
  seriesName: string | null;
  status: ResolvedEventStatus;
  /** UTC calendar date `YYYY-MM-DD` for `<time dateTime>`. */
  dateTime: string;
  formattedDate: string;
  dateMs: number;
  name: string;
  href: string;
  isEncore: boolean;
  position: number;
}

export interface SongHistoryGroup {
  key: string;
  /** null = the "other events" group (label supplied by the panel). */
  label: string | null;
  hasOngoing: boolean;
  rows: SongHistoryRow[];
}

export function groupSongHistory(rows: ReadonlyArray<SongHistoryRow>): {
  groups: SongHistoryGroup[];
  seriesCount: number;
} {
  const buckets = new Map<string, SongHistoryRow[]>();
  const other: SongHistoryRow[] = [];
  for (const row of rows) {
    if (row.seriesId === null) {
      other.push(row);
      continue;
    }
    const bucket = buckets.get(row.seriesId);
    if (bucket) bucket.push(row);
    else buckets.set(row.seriesId, [row]);
  }

  const byDateDesc = (a: SongHistoryRow, b: SongHistoryRow) => b.dateMs - a.dateMs;
  const ranked = [...buckets].map(([key, bucket]) => {
    bucket.sort(byDateDesc);
    const hasOngoing = bucket.some((r) => r.status === "ongoing");
    return {
      group: {
        key,
        label: bucket[0].seriesName,
        hasOngoing,
        rows: bucket,
      } satisfies SongHistoryGroup,
      sortKey: hasOngoing ? Number.MAX_SAFE_INTEGER : bucket[0].dateMs,
    };
  });
  ranked.sort((a, b) => b.sortKey - a.sortKey);
  const groups = ranked.map((r) => r.group);

  if (other.length > 0) {
    other.sort(byDateDesc);
    groups.push({
      key: "other",
      label: null,
      hasOngoing: other.some((r) => r.status === "ongoing"),
      rows: other,
    });
  }

  return { groups, seriesCount: buckets.size };
}
