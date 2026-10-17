// Realtime channel recovery constants for `useRealtimeEventChannel`,
// plus the `document.hidden` store also used by `useImpressionPolling`.
//
// The recovery model is OWNERSHIP, not a hold-off. realtime-js 2.105
// (via @supabase/phoenix) already recovers a dropped socket on its own:
// an unclean close reconnects the socket on a fixed 1 / 2 / 5 / 10 s
// (then every 10 s) schedule, and every errored channel rejoins as soon
// as the socket is open again (then on 1 / 2 / 5 / 10 s rejoin backoff).
// `CHANNEL_ERROR` / `TIMED_OUT` are reported along the way and are NOT
// terminal. Removing the channel on the first error — what this hook
// used to do — cancels exactly that rejoin, which is why a forced
// reconnect took a 30 s hold-off plus a fresh join to recover (p95
// 12.8 s in the 2026-10-10 reconnect drill) instead of the ~1–3 s
// realtime-js needs.
//
// So the hook keeps the channel object through errors, polls at the
// fallback cadence while it is disconnected, and only re-creates the
// channel itself when realtime-js has demonstrably not managed to
// rejoin for a long time. The numbers below bound that last resort.

/**
 * No `SUBSCRIBED` within this long after a channel's first error (or
 * after a re-creation) = "sustained failure": the hook stops trusting
 * realtime-js's own rejoin and re-creates the channel.
 *
 * Why 60 s: it must comfortably exceed what realtime-js needs for a
 * recoverable outage. Its socket retries land at 1, 3, 8, 18, 28, 38,
 * 48, 58 s after a drop (10 s ceiling), an errored channel rejoins on
 * socket open, and a join that gets no reply waits the 10 s push
 * timeout before the next rejoin (1 / 2 / 5 s). A ~30 s network outage
 * therefore recovers by ≈ 30 + 10 (next socket retry) + 10 (one lost
 * join) + 1 s ≈ 51 s on its own. 60 s is 4× the 10 s + 5 s backoff
 * ceilings and leaves that case alone. Waiting long is cheap: the page
 * polls every 5 s ± 1 s meanwhile, so the cost is push latency, not
 * correctness — while re-creating early is expensive (a fresh join per
 * tab against Realtime's admission, the n12 lesson).
 */
export const REJOIN_GRACE_MS = 60_000;

/**
 * Randomized backoff added after the grace window before each
 * re-creation: attempt n waits `U(base_n, 3·base_n)` with
 * `base_n = min(5 s · 2^(n−1), 20 s)` → 5–15 s, 10–30 s, 20–60 s.
 * A Realtime outage hits every viewer at the same instant, so their
 * grace windows end together; the random 10 s+ spread is what keeps 500
 * tabs from re-joining in the same second.
 */
export const RECREATE_BACKOFF_BASE_MS = 5_000;
export const RECREATE_BACKOFF_MAX_BASE_MS = 20_000;

/**
 * Re-creations per budget window. Exhausting the budget does NOT mean
 * "polling forever": the last channel is kept, realtime-js keeps
 * rejoining it on its own, and a later `SUBSCRIBED` still returns the
 * page to the healthy path. It only stops the hook from adding joins.
 */
export const MAX_RECREATE_ATTEMPTS = 3;

/**
 * Continuous `SUBSCRIBED` for this long refunds the re-creation budget.
 * The old budget was spent once per page lifetime, so a viewer who
 * dropped three times early in a 3-hour show had no automatic recovery
 * left for the rest of it; five healthy minutes is long enough that a
 * flapping network cannot reset the budget between its own flaps.
 */
export const HEALTHY_BUDGET_RESET_MS = 5 * 60_000;

/**
 * Backoff before re-creation attempt `attempt` (1-based), on top of
 * `REJOIN_GRACE_MS`. `random` is injectable for tests.
 */
export function recreateBackoffMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const base = Math.min(
    RECREATE_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1),
    RECREATE_BACKOFF_MAX_BASE_MS,
  );
  return Math.round(base * (1 + 2 * random()));
}

// SSR-safe "is the tab currently hidden" check. Used by the Realtime
// hook to early-return at the top of the CHANNEL_ERROR / TIMED_OUT
// handler, so a status callback that fires after a visibility-driven
// teardown (or between the hide event and React committing it) can't
// send a captureMessage or flip the page into polling for a tab the
// user can't see — "visibility-driven teardown is silent" must hold
// across every reachable path. SSR-safe via the `typeof document`
// check (this module is imported by `"use client"` hooks but the bundle
// is also parsed server-side during Next.js build).
export function isDocumentHidden(): boolean {
  return typeof document !== "undefined" && document.hidden;
}

// `useSyncExternalStore` triple for subscribing to `document.hidden`.
// React's blessed pattern for tying component state to external
// (non-React) reactive sources — replaces the original useState +
// visibility-listener useEffect pair, which the push-review hook
// flagged as a hydration hazard (lazy `useState` initializer reading
// `document` server-side returns false; client may differ) and a
// set-state-in-effect violation (mount-time sync via setState inside
// a useEffect body trips `react-hooks/set-state-in-effect`).
//
// `subscribeToDocumentHidden` attaches/detaches the listener; React's
// store implementation calls it on mount/unmount automatically.
// `getDocumentHiddenSnapshot` is called during render to read the
// current value. `getDocumentHiddenServerSnapshot` is the SSR-safe
// constant `false` — guarantees identical initial state across
// server and client to avoid hydration mismatches even though the
// client-side `document.hidden` reading may differ post-hydration
// (React then updates the state via the store on the next tick).
//
// Returned by `useSyncExternalStore` as a boolean usable directly
// as the `paused` / `hidden` derivation in the live hooks.
export function subscribeToDocumentHidden(callback: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", callback);
  return () => document.removeEventListener("visibilitychange", callback);
}

export function getDocumentHiddenSnapshot(): boolean {
  // Delegates to `isDocumentHidden` so the implementation lives in
  // exactly one place. `useSyncExternalStore` calls this on every
  // render to read the current value; the wrapper is virtually free.
  return isDocumentHidden();
}

export function getDocumentHiddenServerSnapshot(): boolean {
  return false;
}
