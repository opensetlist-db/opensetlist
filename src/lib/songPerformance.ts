/*
 * Helper for the song detail page's performance row trailing cells.
 *
 * Pulls the encore + position fields out of a SetlistItem record
 * (NOT SetlistItemSong — the junction only carries `order` for
 * medley sub-positioning; the user-visible row chips all live on
 * the parent SetlistItem). Centralized so a future schema rename or
 * field-shape change is a single edit, and so the per-row JSX in
 * the song page stays declarative.
 *
 * `note` is intentionally NOT surfaced — the operator's decision
 * (2026-04-29) is to hide it on every public page; it stays
 * editable in admin. The Prisma `omit: { note: true }` on consumer
 * queries enforces the same at the payload layer.
 *
 * `position` from the schema is already 1-based (per the existing
 * event-page redesign convention); pass it through unchanged.
 */

export type SongPerformanceCells = {
  isEncore: boolean;
  position: number;
};

export function getSongPerformanceCells(setlistItem: {
  isEncore: boolean;
  position: number;
}): SongPerformanceCells {
  return {
    isEncore: setlistItem.isEncore,
    position: setlistItem.position,
  };
}
