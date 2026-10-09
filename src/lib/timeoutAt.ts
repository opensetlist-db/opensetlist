/**
 * Largest delay `setTimeout` honours: browsers (and Node) store it as
 * a signed 32-bit int, so anything above 2^31 − 1 ms (~24.8 days)
 * overflows and the callback fires IMMEDIATELY instead of late.
 *
 * That bit the pre-show lock timers: with a per-event
 * `engagementOpensAt` (n07) the Wishlist / Predicted Setlist can open
 * more than 24.8 days before the show (the Fes opens ~D-35), and
 * `setTimeout(lock, startMs - now)` locked both surfaces on mount — the
 * wishlist vanished and the prediction editor went read-only.
 */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * Run `callback` once the wall clock reaches `targetMs` (epoch ms),
 * however far away that is: long waits are split into ≤ MAX_TIMEOUT_MS
 * hops that re-check the clock on each wake-up. Returns a cancel
 * function for effect cleanup.
 *
 * If `targetMs` is already in the past the callback runs on the next
 * macrotask (never synchronously), so callers can still call it from a
 * `useEffect` body without a set-state-in-effect warning.
 */
export function setTimeoutAt(targetMs: number, callback: () => void): () => void {
  let id: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    const remaining = Math.max(0, targetMs - Date.now());
    if (remaining > MAX_TIMEOUT_MS) {
      id = setTimeout(arm, MAX_TIMEOUT_MS);
    } else {
      id = setTimeout(callback, remaining);
    }
  };
  arm();
  return () => clearTimeout(id);
}
