/*
 * Helper for the song detail page's performance row trailing cells.
 *
 * Pulls the encore + position + note fields out of a SetlistItem
 * record (NOT SetlistItemSong — the junction only carries `order`
 * for medley sub-positioning; the user-visible row chips all live on
 * the parent SetlistItem). Centralized so a future schema rename or
 * field-shape change is a single edit, and so the per-row JSX in the
 * song page stays declarative.
 *
 * `position` from the schema is already 1-based (per the existing
 * event-page redesign convention); pass it through unchanged.
 */

export type SongPerformanceCells = {
  isEncore: boolean;
  position: number;
  note: string | null;
};

export function getSongPerformanceCells(setlistItem: {
  isEncore: boolean;
  position: number;
  note: string | null;
}): SongPerformanceCells {
  return {
    isEncore: setlistItem.isEncore,
    position: setlistItem.position,
    note: setlistItem.note,
  };
}
