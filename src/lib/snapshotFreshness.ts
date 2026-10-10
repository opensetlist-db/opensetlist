// Live-page freshness primitives shared by `useRealtimeEventChannel`
// and `useSetlistPolling` — the fetch deadline, the bounded retry
// schedule, and the public "is this browser still in sync" state.
//
// Why this exists: before this module, a failed `/api/setlist` snapshot
// was silent in both hooks (`if (!res.ok) return;` + an empty catch).
// On the realtime path that meant a single 5xx during a quiet MC left
// the page stale until the next push or reconnect happened to come
// along; on the polling path one hung request held the in-flight guard
// forever and every subsequent tick skipped. And the page's "LIVE"
// pill is derived from event status, so nothing told the viewer that
// *their* browser had stopped updating. These primitives make failure
// visible (freshness state) and self-healing (bounded retries).

/**
 * Hard deadline for one snapshot request (headers + body). A request
 * that hasn't produced parsed JSON within this window is aborted and
 * treated as a failure, which (a) frees the polling hook's in-flight
 * guard so the next tick can run and (b) starts the retry schedule on
 * the realtime path. 8 s is well above the endpoint's healthy p95
 * (sub-second) but short enough that a hung connection can't silently
 * freeze the page for a whole song.
 */
export const SNAPSHOT_FETCH_TIMEOUT_MS = 8_000;

/**
 * Retry delays after consecutive failures: 1st failure → 1 s, 2nd →
 * 2 s, … 6th and every later failure → 30 s. Deliberately bounded and
 * slow at the tail: when the DB is the thing that's struggling, every
 * viewer retrying aggressively is the request storm that keeps it
 * down. This is also why a snapshot failure does NOT flip the realtime
 * hook to R3 polling — polling would add load, not relieve it. R3
 * stays reserved for channel-level CHANNEL_ERROR / TIMED_OUT.
 */
export const SNAPSHOT_RETRY_SCHEDULE_MS = [
  1_000, 2_000, 4_000, 8_000, 15_000, 30_000,
] as const;

/** ±20 % — spreads a synchronized failure wave across viewers. */
export const SNAPSHOT_RETRY_JITTER = 0.2;

/**
 * Upper bound on a server-supplied `Retry-After`. The header is
 * honoured so the server can shed load deliberately, but a misconfigured
 * proxy answering "Retry-After: 86400" must not park a live page for a
 * day — 2 min keeps it inside "the viewer would still notice a fix".
 */
export const SNAPSHOT_RETRY_AFTER_CAP_MS = 120_000;

/**
 * Consecutive failures at which the indicator flips from "retrying"
 * (silent — keeps showing the last sync time) to "delayed" (tells the
 * viewer). With the schedule above, a fast-failing outage (5xx,
 * blocked request) reaches the 3rd failure ~3 s after the first, so
 * the viewer sees the delayed state within a few seconds; a hung
 * outage takes longer because each attempt waits out the 8 s deadline.
 * Fast enough to be honest, slow enough that one dropped request
 * doesn't flash a warning.
 */
export const SNAPSHOT_DELAYED_AFTER_FAILURES = 3;

export type FreshnessState = "live" | "retrying" | "delayed";

export interface Freshness {
  /** Client time of the last successful snapshot; null until the first. */
  lastSyncAt: Date | null;
  state: FreshnessState;
}

export const INITIAL_FRESHNESS: Freshness = { lastSyncAt: null, state: "live" };

/** Freshness state for a given consecutive-failure count. */
export function freshnessStateFor(consecutiveFailures: number): FreshnessState {
  if (consecutiveFailures <= 0) return "live";
  if (consecutiveFailures < SNAPSHOT_DELAYED_AFTER_FAILURES) return "retrying";
  return "delayed";
}

/**
 * Parse a `Retry-After` header (delta-seconds or HTTP-date) into ms
 * from `nowMs`. Returns null when absent or unparseable so the caller
 * falls back to the schedule.
 */
export function parseRetryAfterMs(
  header: string | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (header == null) return null;
  const trimmed = header.trim();
  if (trimmed === "") return null;
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return null;
  return Math.max(0, dateMs - nowMs);
}

/**
 * Delay before the next retry, given how many consecutive failures
 * have happened so far (1-based: pass 1 after the first failure).
 *
 * A valid `Retry-After` wins over the schedule and is used without
 * jitter — the server asked for that exact spacing. Otherwise the
 * schedule step gets ±20 % jitter. `random` is injectable for tests.
 */
export function snapshotRetryDelayMs(
  consecutiveFailures: number,
  retryAfterMs: number | null = null,
  random: () => number = Math.random,
): number {
  if (retryAfterMs !== null) {
    return Math.min(Math.max(0, retryAfterMs), SNAPSHOT_RETRY_AFTER_CAP_MS);
  }
  const idx = Math.min(
    Math.max(consecutiveFailures - 1, 0),
    SNAPSHOT_RETRY_SCHEDULE_MS.length - 1,
  );
  const base = SNAPSHOT_RETRY_SCHEDULE_MS[idx];
  const factor = 1 + (random() * 2 - 1) * SNAPSHOT_RETRY_JITTER;
  return Math.round(base * factor);
}

/**
 * Arms the fetch deadline on an existing controller. One controller
 * per request carries both cancellation causes — supersede/cleanup
 * (the hooks' own `abort()`) and this deadline — so no
 * `AbortSignal.any` / `AbortSignal.timeout` support is needed (neither
 * is in every browser we serve, nor in jsdom with fake timers).
 *
 * The caller tells the two apart via `timedOut()`: a timed-out request
 * is a FAILURE (retry, count toward "delayed"); a superseded or
 * cleaned-up one is silent. Checking the flag rather than the thrown
 * error's `name` keeps that distinction independent of how a given
 * runtime surfaces `abort(reason)` from `fetch`.
 *
 * `onTimeout` runs synchronously inside the timer, before the abort
 * propagates — the polling hook uses it to release its in-flight guard
 * immediately, even if the runtime's fetch never settles.
 */
export function armSnapshotDeadline(
  controller: AbortController,
  onTimeout?: () => void,
  timeoutMs: number = SNAPSHOT_FETCH_TIMEOUT_MS,
): { timedOut: () => boolean; clear: () => void } {
  let fired = false;
  const timer = setTimeout(() => {
    fired = true;
    onTimeout?.();
    controller.abort(
      new DOMException("Snapshot fetch deadline exceeded", "TimeoutError"),
    );
  }, timeoutMs);
  return {
    timedOut: () => fired,
    clear: () => clearTimeout(timer),
  };
}
