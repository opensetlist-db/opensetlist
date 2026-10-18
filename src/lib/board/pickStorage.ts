/**
 * localStorage copy of the viewer's own fan board picks (n15-03).
 *
 * One key per event: `board-{eventId}` (Day.1 and Day.2 are separate
 * events, so separate ballots). Value shape:
 *
 *   { picks: [{ id, groupId, songId, title, available }] }
 *
 *   - `id` is the server `BoardPick.id`, kept so a remove can name the
 *     row without a lookup.
 *   - `title` is the display title at add time, so "my picks" renders
 *     on load without a request.
 *   - `available` is false only when the server said the song was
 *     soft-deleted (a `/board/mine` restore); a locally added pick is
 *     always available at add time.
 *
 * Unlike the wishlist's local copy this is NOT the source of truth: the
 * server enforces the cap and owns the rows. The local copy is a cache
 * of the viewer's ballot; when it is empty the block restores from
 * `/board/mine`.
 *
 * SSR-safe: reads return `[]` without `window`; every storage access is
 * wrapped (private mode / quota / blocked storage).
 */

export interface StoredBoardPick {
  id: string;
  groupId: string;
  songId: string;
  title: string;
  available: boolean;
}

interface StoredShape {
  picks: StoredBoardPick[];
}

function key(eventId: string): string {
  return `board-${eventId}`;
}

const DECIMAL_ID = /^[1-9][0-9]{0,18}$/;

function isStoredPick(value: unknown): value is StoredBoardPick {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    v.id.length > 0 &&
    typeof v.groupId === "string" &&
    DECIMAL_ID.test(v.groupId) &&
    typeof v.songId === "string" &&
    DECIMAL_ID.test(v.songId) &&
    typeof v.title === "string" &&
    typeof v.available === "boolean"
  );
}

export function readBoardPicks(eventId: string): StoredBoardPick[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key(eventId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return [];
    }
    const picks = (parsed as Record<string, unknown>).picks;
    // A tampered or half-written entry drops only the bad rows, not the
    // whole ballot — the good ones still carry valid server ids.
    return Array.isArray(picks) ? picks.filter(isStoredPick) : [];
  } catch {
    return [];
  }
}

export function writeBoardPicks(
  eventId: string,
  picks: readonly StoredBoardPick[],
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      key(eventId),
      JSON.stringify({ picks: [...picks] } satisfies StoredShape),
    );
  } catch {
    // Storage unavailable — the server still has the rows; the next
    // load restores them through `/board/mine`.
  }
}
