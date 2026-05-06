/**
 * Stage B foundation for the Phase 1B Predicted Setlist (Stage C).
 *
 * `<SetlistTabs>` reads `hasPredictions(eventId)` to decide whether
 * the Predicted tab is visible at all. The full read/write contract
 * for the per-event prediction payload (`predict-{eventId}`) ships
 * with Stage C — this file only exposes the existence check the tab
 * scaffold needs.
 *
 * SSR-safe: returns `false` when `window === undefined` so first
 * server render + first client render produce matching HTML (no
 * tabs). After hydration the mounted-gated re-read may flip to
 * `true` for users who have predictions; until Stage C ships
 * the writer, that flip never happens in practice.
 *
 * The check is intentionally permissive — any non-empty parse of
 * the localStorage value counts as "has predictions". Stage C will
 * tighten the shape contract when it adds the writer; for the
 * tab-visibility purpose, "the key exists and contains valid JSON"
 * is the right granularity.
 */

const KEY_PREFIX = "predict-";

export function predictKey(eventId: string): string {
  return `${KEY_PREFIX}${eventId}`;
}

export function hasPredictions(eventId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(predictKey(eventId));
    if (!raw) return false;
    // Tab visibility doesn't care about the payload shape — it only
    // cares that the user has predictions stored. Defer the strict
    // shape contract to Stage C's reader. Malformed JSON (DevTools
    // tampering, partial write) falls through to false via the
    // catch below; that's the fail-closed default the task spec
    // requires for the "Edge case" verification.
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}
