/**
 * Shared, UI-framework-free type for the post-show impressions
 * ("한줄감상") feed. Lives in `src/lib/types/` (the project's
 * convention for cross-layer type modules — see `setlist.ts` next
 * door) so hooks and pure helpers under `src/lib/` can describe
 * impressions without importing from `src/components/`. This breaks
 * the prior `useImpressionPolling` / `useRealtimeImpressions`
 * → `EventImpressions` → hook circular dependency: both hooks now
 * import from here, and `EventImpressions` re-exports for back-compat
 * with existing import sites elsewhere in the codebase.
 *
 * Mirrors the trimmed shape returned by `GET /api/impressions` —
 * only the columns rendered in the feed, NOT the visibility-filter
 * columns (`supersededAt`, `isHidden`, `isDeleted`) which are
 * filtered server-side in the polling response and inside
 * `useRealtimeImpressions` for the realtime path.
 */
export interface Impression {
  id: string;
  rootImpressionId: string;
  eventId: string;
  content: string;
  locale: string;
  createdAt: string;
}
