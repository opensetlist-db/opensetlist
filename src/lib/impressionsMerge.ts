import type { Impression } from "@/lib/types/impression";

/**
 * Newest-first ordering shared with the server's `ORDER BY createdAt
 * DESC, id DESC` in `/api/impressions`. Returns < 0 when `a` sorts
 * before (is newer than) `b`.
 */
export function compareImpressionsDesc(a: Impression, b: Impression): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

/**
 * Merge the newest page returned by a polling tick into the rows the
 * viewer already has. Since n14 made polling the only path on which a
 * viewer learns about OTHER users' changes (the per-row Realtime
 * subscription is gone), this merge has to reproduce what the old
 * `onUpsert` / `onRemove` callbacks did:
 *
 *   1. Edits. Editing creates a NEW row (new `id`, later `createdAt`)
 *      with the same `rootImpressionId`; the old row is superseded and
 *      drops out of the server page. An id-based merge would show both
 *      versions, so rows are collapsed per chain, keeping the newest
 *      version from either side. "Either side" matters: the first page
 *      is cached for a few seconds server-side, so a poll can still
 *      carry the OLD version of a chain this viewer just edited and
 *      merged from the POST response. Keeping the newest version per
 *      chain means a stale page can never reinstate an older one.
 *
 *   2. Hides / deletes / supersedes by others. Such rows simply stop
 *      appearing in the page. A row the viewer holds is removed when it
 *      is absent from the page AND falls inside the page's window:
 *      between the oldest and the newest polled row by (createdAt, id).
 *      Rows OLDER than the window come from "see older" pagination and
 *      are untouched (the page says nothing about them). Rows NEWER
 *      than the window are kept too: with the server-side cache a poll
 *      can lag a viewer's own fresh submit, and pruning it would make
 *      the viewer's post vanish until the next tick. When the page is
 *      the whole archive (`nextCursor === null`) the window has no
 *      lower bound, so every absent row older than the newest polled
 *      one is pruned.
 *
 * Pure and idempotent, so it is safe inside a state updater that may
 * run twice (React strict mode) and against the `impressionsRef`
 * eager-update pattern in `EventImpressions`.
 */
export function mergePolledImpressions(
  prev: Impression[],
  polled: Impression[],
  nextCursor: string | null,
): Impression[] {
  // An empty page carries no window; defensively leave the list alone
  // rather than wiping it on an empty or errored response.
  if (polled.length === 0) return prev;

  const sortedPolled = [...polled].sort(compareImpressionsDesc);
  const newest = sortedPolled[0];
  const oldest = sortedPolled[sortedPolled.length - 1];
  const polledIds = new Set(polled.map((i) => i.id));

  const insideWindow = (row: Impression) =>
    compareImpressionsDesc(row, newest) >= 0 &&
    (nextCursor === null || compareImpressionsDesc(row, oldest) <= 0);

  const survivors = prev.filter((p) => polledIds.has(p.id) || !insideWindow(p));

  // Collapse per chain, newest version wins regardless of origin.
  const byChain = new Map<string, Impression>();
  for (const row of [...sortedPolled, ...survivors]) {
    const held = byChain.get(row.rootImpressionId);
    if (!held || compareImpressionsDesc(row, held) < 0) {
      byChain.set(row.rootImpressionId, row);
    }
  }

  return [...byChain.values()].sort(compareImpressionsDesc);
}
