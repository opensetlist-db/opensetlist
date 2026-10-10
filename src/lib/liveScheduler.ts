// Fetch scheduler for the live event page's `/api/setlist` snapshot.
//
// Used by `useRealtimeEventChannel` (healthy: notifications + a slow
// periodic repair poll; while the channel is disconnected the same
// scheduler switches to the 5 s ± 1 s fallback cadence via
// `setPeriodic`), by the standalone `useSetlistPolling`, and by
// `useImpressionPolling`. It decides WHEN a snapshot request runs; the hook
// supplies `runFetch`, which decides WHAT a request does (URL, `minRev`,
// deadline, acceptance, freshness bookkeeping) and reports back how it
// went.
//
// Why a scheduler instead of the previous abort-and-refire supersede:
// measured on dev (task n14, 2026-10-10), one admin save produced k+1
// snapshot requests per subscriber because every push aborted the
// in-flight fetch and fired a new one — and an aborted fetch does not
// stop the server work, so the pooler saw every one of them. With
// ~500 viewers that is the burst that saturates the 15-backend pool.
// The rules below bound it to "one request in flight per client, plus
// at most one follow-up", spread over a short random window:
//
//   - Single-flight with a `dirty` flag. A trigger that arrives while a
//     request is in flight never starts a second one; it marks the
//     client dirty, and exactly ONE more request runs after the current
//     one settles (however many triggers arrived meanwhile). The
//     follow-up is needed because the in-flight request may have read
//     the database before the change the trigger is announcing.
//
//   - Jitter on every trigger that can be synchronized across viewers.
//     A notification reaches every viewer at the same instant, so each
//     client waits `U(0, jitterMs)` before fetching to spread the burst.
//     The same holds for less obvious triggers: a Realtime node restart
//     or a venue-wide network blip drops every socket at once, and
//     realtime-js reconnects them on a FIXED schedule (1/2/5/10 s, no
//     jitter), so the `SUBSCRIBED` catch-ups land together; an `online`
//     event fires for a whole venue Wi-Fi at once; every viewer's status
//     boundary timer fires at the same `startTime`. Those triggers
//     ("catchup", "resume", "boundary") wait `U(0, catchupJitterMs)`.
//     The page already shows SSR or last-applied data, so the jitter
//     only delays a refresh, never the first paint. Triggers that are
//     not correlated run immediately: the first seed of a page
//     ("initial" — page loads are spread by the viewers themselves),
//     the retry (spread by n13's ±20 % or by the server's Retry-After),
//     and periodic ticks (spread by their own ± spread and random
//     phase).
//
//   - Per-client cooldown on those spread triggers. At most one
//     notification / catch-up / resume / boundary request starts per
//     `cooldownMs`. A trigger inside the window is never dropped: it is
//     scheduled at `max(nextEligibleAt, now + jitter)`, or — if a
//     request is in flight — becomes the dirty follow-up, which waits
//     for `max(nextEligibleAt, now)` (no second jitter: the client
//     already sat one out, and the in-flight request's settle time is
//     itself random). So a reconnect that brings `SUBSCRIBED` and
//     `online` together costs one request, not two.
//
//   - Periodic repair poll. While the hook keeps the scheduler alive
//     (the realtime hook disposes it when the tab hides), a periodic
//     tick fires every `intervalMs ± spreadMs`. It repairs lost
//     notifications (postgres_changes delivery is not guaranteed — n12
//     measured 0/300 delivery under load) and refreshes the slices that
//     no longer have their own push (reaction counts, wish TOP-3). A
//     tick is a no-op while a request is in flight, scheduled, or a
//     retry is pending: that request already covers this period.
//
//   - Failure path = n13's retry schedule. `runFetch` owns the
//     consecutive-failure count and computes the delay with
//     `snapshotRetryDelayMs` (1/2/4/8/15/30 s ± 20 %, Retry-After);
//     the scheduler only arms the timer it asked for. The retry lives
//     in the same single "scheduled" slot as every other deferred
//     request, so an explicit trigger that is due EARLIER replaces it
//     — the "a newer fetch IS the retry" rule n13 had — and one due
//     later is covered by it (the retry starts after the trigger
//     arrived, so its read sees whatever the trigger announced).
//     Periodic ticks never replace it (they would defeat the backoff).
//
//   - Server-directed floor (`notBeforeAt`). A failed outcome may carry
//     `notBeforeMs`: the server's own `Retry-After` (the snapshot route
//     answers 503 + `Retry-After` when a build fails under overload).
//     That is not advice for one retry — it is the server shedding
//     load, so it must hold against every path that can start a
//     request. Without it, "an explicit trigger supersedes a retry" let
//     a burst of notifications (exactly what an overloaded save
//     produces) fire straight through the Retry-After window. Every
//     path — notification, catch-up, resume, boundary, periodic, dirty
//     follow-up — computes its usual due time and then takes
//     `max(due, notBeforeAt + U(0, jitter))`. The jitter on top of the
//     floor matters: every viewer that got a 503 in the same burst would
//     otherwise wake at nearly the same floor edge. The retry itself is
//     the one exception — it is due at `max(now + retryInMs,
//     notBeforeAt)` with no extra jitter, because `retryInMs` already IS
//     the clamped Retry-After (n13: "the server asked for that exact
//     spacing"). The floor only moves forward and simply expires; a
//     success does not need to clear it.
//
// Everything time-related goes through the injectable `clock` and
// `random` so the unit tests can drive it with fake timers and pinned
// randomness. All values are relative waits — no stored-date
// comparisons — so the UTC rule does not apply here.

/**
 * Why a snapshot request is being asked for.
 *
 *   - `initial`: the first seed of a page (mount). Immediate.
 *   - `notification`: a push said the setlist changed. Jittered by
 *     `jitterMs`, cooldown.
 *   - `catchup`: `SUBSCRIBED` (initial join or a rejoin after a gap).
 *   - `resume`: the tab became visible again, or the browser went back
 *     `online`.
 *   - `boundary`: an event-status boundary (startTime, completed flip).
 *     `catchup` / `resume` / `boundary` are jittered by
 *     `catchupJitterMs`, cooldown.
 *   - `periodic`: the repair / fallback poll tick.
 *   - `retry`: internal — the scheduler's own retry after a failure.
 */
export type LiveFetchReason =
  | "initial"
  | "notification"
  | "periodic"
  | "catchup"
  | "resume"
  | "boundary"
  | "retry";

/**
 * Triggers that can fire on many viewers at the same instant, and are
 * therefore jittered and share the per-client cooldown (header).
 */
function isSpreadReason(reason: LiveFetchReason): boolean {
  return (
    reason === "notification" ||
    reason === "catchup" ||
    reason === "resume" ||
    reason === "boundary"
  );
}

/**
 * Result of one `runFetch` call.
 *
 *   - `ok`: the request completed (applied or not — a response that is
 *     merely not newer than what is shown is still a healthy sync).
 *   - `failed`: count it as a failure; retry after `retryInMs`, which the
 *     caller computed from n13's schedule. `notBeforeMs` (optional) is
 *     the server-directed floor described in the header.
 *   - `cancelled`: the request no longer matters (the hook tore the
 *     channel down, or the event/locale changed). Nothing follows.
 */
export type LiveFetchOutcome =
  | { kind: "ok" }
  | {
      kind: "failed";
      retryInMs: number;
      /**
       * The response's `Retry-After`, already clamped
       * (`clampRetryAfterMs`). No request of any kind starts before
       * `now + notBeforeMs`. Absent / null = no floor (a network error,
       * a deadline, a 5xx without the header).
       */
      notBeforeMs?: number | null;
    }
  | { kind: "cancelled" };

export interface SchedulerClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

/**
 * Notification jitter. Stays 500 ms: a wider window only adds its own
 * p95 to save → visible, and run #2 put the capacity wall elsewhere
 * (pooler clients), so a wider spread is reserved for evidence.
 */
export const NOTIFICATION_JITTER_MS = 500;
/**
 * Jitter for the other correlated triggers (SUBSCRIBED catch-up,
 * visibility resume / `online`, status boundary). Same magnitude as the
 * notification jitter: a mass reconnect is the same 500-viewer burst
 * shape as a save, and 500 ms is well inside what a refresh of
 * already-rendered data can absorb.
 */
export const CATCHUP_JITTER_MS = 500;
/**
 * At most one spread-trigger request (notification, catch-up, resume,
 * boundary) per client per second.
 */
export const NOTIFICATION_COOLDOWN_MS = 1_000;
/** Healthy-path repair poll: 20 s ± 4 s while the page is visible. */
export const HEALTHY_PERIODIC_MS = 20_000;
export const HEALTHY_PERIODIC_SPREAD_MS = 4_000;
/** R3 polling fallback: 5 s ± 1 s with a random initial phase. */
export const FALLBACK_POLL_MS = 5_000;
export const FALLBACK_POLL_SPREAD_MS = 1_000;

export interface PeriodicConfig {
  intervalMs: number;
  spreadMs: number;
  /**
   * When the FIRST tick fires after `start()`:
   *   - `"interval"`: one full `intervalMs ± spreadMs` later. Used by the
   *     realtime hook, whose seed fetch already covers t = 0.
   *   - `"random-phase"`: `U(0, intervalMs)` later. Used by polling, so a
   *     population that fell back at the same moment (a Realtime outage
   *     hits everyone together) does not poll in lock-step forever.
   */
  firstTick: "interval" | "random-phase";
}

export interface LiveSchedulerOptions {
  runFetch: (reason: LiveFetchReason) => Promise<LiveFetchOutcome>;
  /** Notification jitter bound (default `NOTIFICATION_JITTER_MS`). */
  jitterMs?: number;
  /**
   * Jitter bound for catch-up / resume / boundary (default
   * `CATCHUP_JITTER_MS`). Also the floor jitter for the triggers that
   * have none of their own (initial, periodic).
   */
  catchupJitterMs?: number;
  cooldownMs?: number;
  periodic?: PeriodicConfig | null;
  /**
   * A server-directed floor (clock ms) inherited from a previous
   * scheduler of the same page. The realtime hook builds one scheduler
   * per channel session (a visibility resume starts a new one) and
   * hands the old one's `getState().notBeforeAt` over, so re-showing a
   * tab inside a `Retry-After` window does not reset the window.
   */
  initialNotBeforeAt?: number | null;
  random?: () => number;
  clock?: SchedulerClock;
}

export interface LiveSchedulerState {
  inFlight: boolean;
  dirty: boolean;
  /** Due time (clock ms) of a scheduled-but-not-started request. */
  scheduledAt: number | null;
  retryPending: boolean;
  /**
   * Server-directed floor (clock ms) from the last `Retry-After`; null
   * when none was ever set. May lie in the past (an expired floor).
   */
  notBeforeAt: number | null;
  disposed: boolean;
}

export interface LiveScheduler {
  requestFetch(reason: LiveFetchReason): void;
  /** Arms the periodic timer (if configured). Idempotent. */
  start(): void;
  /**
   * Swap the periodic cadence — the realtime hook switches between the
   * healthy repair poll (20 s ± 4 s) and the "polling while
   * disconnected" cadence (5 s ± 1 s) on the SAME scheduler, so the
   * hand-over keeps one single-flight guard, one retry/floor state and
   * one acceptance watermark. Re-arms the timer from now with the new
   * config's `firstTick` rule; in-flight / scheduled / retry work is
   * untouched. `null` stops periodic ticks.
   */
  setPeriodic(config: PeriodicConfig | null): void;
  dispose(): void;
  getState(): LiveSchedulerState;
}

const defaultClock: SchedulerClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export function createLiveScheduler(
  options: LiveSchedulerOptions,
): LiveScheduler {
  const {
    runFetch,
    jitterMs = NOTIFICATION_JITTER_MS,
    catchupJitterMs = CATCHUP_JITTER_MS,
    cooldownMs = NOTIFICATION_COOLDOWN_MS,
    initialNotBeforeAt = null,
    random = Math.random,
    clock = defaultClock,
  } = options;

  // Jitter bound of a trigger; also the jitter added on top of an
  // active server floor. Triggers without a jitter of their own
  // (initial, periodic, a non-spread follow-up) use the catch-up bound
  // there, so nothing wakes exactly on the shared floor edge.
  const jitterFor = (reason: LiveFetchReason): number =>
    reason === "notification" ? jitterMs : catchupJitterMs;

  let periodic: PeriodicConfig | null = options.periodic ?? null;
  let disposed = false;
  let started = false;
  let inFlight = false;
  // Reason that marked us dirty while in flight; null = clean.
  // "notification" wins over the others, for the same reason a covered
  // notification upgrades a scheduled request (see `scheduleAt`): the
  // follow-up should carry the `appliedRev + 1` hint a real push
  // justifies. Every spread reason waits out the same cooldown, so the
  // choice changes nothing else; a catch-up's plain `minRev` is only
  // kept when no push arrived (a mass reconnect must not turn into 500
  // revision reads for nothing).
  let dirtyReason: LiveFetchReason | null = null;
  // The ONE deferred request — a jittered notification, a request held
  // back by the floor, or the retry after a failure. Keeping the retry
  // in this slot (instead of a timer of its own) is what makes "an
  // earlier trigger replaces it, a later one is covered by it" fall out
  // of `scheduleAt`'s single comparison.
  let scheduled: { handle: unknown; dueAt: number; reason: LiveFetchReason; isRetry: boolean } | null =
    null;
  let periodicHandle: unknown = null;
  // Start time of the last spread-trigger request (notification,
  // catch-up, resume, boundary); the cooldown window is measured from
  // here.
  let lastSpreadStartAt = Number.NEGATIVE_INFINITY;
  let notBeforeAt =
    initialNotBeforeAt === null || !Number.isFinite(initialNotBeforeAt)
      ? Number.NEGATIVE_INFINITY
      : initialNotBeforeAt;

  const nextEligibleAt = () => lastSpreadStartAt + cooldownMs;

  const clearScheduled = () => {
    if (scheduled) {
      clock.clearTimeout(scheduled.handle);
      scheduled = null;
    }
  };

  // Lift `dueAt` above an active server floor, adding `U(0, floorJitter)`
  // so the population that shares the floor does not wake together.
  // An expired floor (≤ now) changes nothing.
  const applyFloor = (dueAt: number, now: number, floorJitterMs: number) => {
    if (notBeforeAt <= now) return dueAt;
    return Math.max(dueAt, notBeforeAt + random() * floorJitterMs);
  };

  // Schedule a request at `dueAt` unless one is already scheduled no
  // later than that — the earlier request starts after this trigger
  // arrived, so its read already covers it.
  //
  // A covered NOTIFICATION upgrades the covering request's reason to
  // "notification": the request then carries the single-use
  // `appliedRev + 1` hint (see `notificationMinRev`) that a real push
  // justifies, instead of a catch-up's or retry's plain `minRev`, which
  // a not-yet-purged cache entry could satisfy with the old snapshot.
  //
  // `isRetry` records that the request stands in for a failed one (it
  // is what `retryPending` reports), independently of the reason it
  // runs with — a retry that covers a push runs as "notification".
  const scheduleAt = (dueAt: number, reason: LiveFetchReason, isRetry = false) => {
    if (scheduled && scheduled.dueAt <= dueAt) {
      if (reason === "notification") scheduled.reason = "notification";
      if (isRetry) scheduled.isRetry = true;
      return;
    }
    clearScheduled();
    const delay = Math.max(0, dueAt - clock.now());
    const entry: { handle: unknown; dueAt: number; reason: LiveFetchReason; isRetry: boolean } = {
      handle: null,
      dueAt,
      reason,
      isRetry,
    };
    entry.handle = clock.setTimeout(() => {
      scheduled = null;
      void run(entry.reason);
    }, delay);
    scheduled = entry;
  };

  // Start now if nothing holds the request back, else defer it.
  const startOrSchedule = (dueAt: number, reason: LiveFetchReason) => {
    if (dueAt <= clock.now()) {
      void run(reason);
      return;
    }
    scheduleAt(dueAt, reason);
  };

  const run = async (reason: LiveFetchReason): Promise<void> => {
    if (disposed) return;
    clearScheduled();
    inFlight = true;
    dirtyReason = null;
    if (isSpreadReason(reason)) lastSpreadStartAt = clock.now();

    let outcome: LiveFetchOutcome;
    try {
      outcome = await runFetch(reason);
    } catch {
      // `runFetch` is expected to classify its own errors. A throw here
      // is a programming error in the caller; treat it as cancelled
      // rather than inventing a retry delay the scheduler doesn't own.
      outcome = { kind: "cancelled" };
    }
    inFlight = false;
    if (disposed) return;

    const followUp = dirtyReason;
    dirtyReason = null;

    if (outcome.kind === "failed") {
      const now = clock.now();
      const floorMs = outcome.notBeforeMs;
      if (typeof floorMs === "number" && Number.isFinite(floorMs)) {
        notBeforeAt = Math.max(notBeforeAt, now + Math.max(0, floorMs));
      }
      // The retry is the follow-up: it starts after every trigger that
      // marked us dirty, and it respects the backoff a struggling
      // server needs. An earlier-due explicit trigger still replaces
      // it, but never below the floor.
      //
      // A push that arrived while the failed request was in flight is
      // still a real push: the retry that covers it carries the
      // "notification" reason, so it sends the single-use
      // `appliedRev + 1` hint instead of a plain `minRev` that a
      // not-yet-purged cache entry could satisfy with the old snapshot
      // — otherwise the edit would wait for the next periodic poll.
      // Under overload (503s right after a save) this is the common
      // case, not a corner.
      scheduleAt(
        Math.max(now + Math.max(0, outcome.retryInMs), notBeforeAt),
        followUp === "notification" ? "notification" : "retry",
        true,
      );
      return;
    }
    if (outcome.kind === "cancelled" || followUp === null) return;

    const now = clock.now();
    if (isSpreadReason(followUp)) {
      // No new jitter: this client already sat out one jitter window
      // (or its trigger arrived at a random point of an in-flight
      // request whose settle time is itself random). The cooldown
      // still applies.
      scheduleAt(
        applyFloor(Math.max(nextEligibleAt(), now), now, jitterFor(followUp)),
        followUp,
      );
    } else {
      startOrSchedule(applyFloor(now, now, jitterFor(followUp)), followUp);
    }
  };

  const requestFetch = (reason: LiveFetchReason) => {
    if (disposed) return;
    const now = clock.now();

    if (reason === "periodic") {
      // `scheduled` includes a pending retry: the backoff holds.
      if (inFlight || scheduled) return;
      startOrSchedule(applyFloor(now, now, jitterFor("periodic")), "periodic");
      return;
    }

    if (inFlight) {
      if (dirtyReason === null || reason === "notification") {
        dirtyReason = reason;
      }
      return;
    }

    if (isSpreadReason(reason)) {
      const jitter = jitterFor(reason);
      const dueAt = Math.max(now + random() * jitter, nextEligibleAt());
      // Always through a timer (even at zero jitter), so a burst of
      // triggers in one task collapses into the one scheduled request.
      // An already-scheduled request due no later (a pending retry, an
      // earlier notification) covers this trigger; a later one is
      // replaced by it.
      scheduleAt(applyFloor(dueAt, now, jitter), reason);
      return;
    }

    // Not correlated across viewers (the first seed): start now, which
    // replaces a later-due scheduled request (including a pending
    // retry) — it IS that request — unless the floor holds it back.
    startOrSchedule(applyFloor(now, now, jitterFor(reason)), reason);
  };

  const clearPeriodic = () => {
    if (periodicHandle !== null) {
      clock.clearTimeout(periodicHandle);
      periodicHandle = null;
    }
  };

  const schedulePeriodic = (first: boolean) => {
    if (!periodic || disposed) return;
    const delay =
      first && periodic.firstTick === "random-phase"
        ? random() * periodic.intervalMs
        : periodic.intervalMs + (random() * 2 - 1) * periodic.spreadMs;
    periodicHandle = clock.setTimeout(() => {
      periodicHandle = null;
      schedulePeriodic(false);
      requestFetch("periodic");
    }, Math.max(0, delay));
  };

  return {
    requestFetch,
    start() {
      if (started || disposed) return;
      started = true;
      schedulePeriodic(true);
    },
    setPeriodic(config) {
      if (disposed) return;
      periodic = config;
      clearPeriodic();
      if (started) schedulePeriodic(true);
    },
    dispose() {
      disposed = true;
      clearScheduled();
      clearPeriodic();
    },
    getState() {
      return {
        inFlight,
        dirty: dirtyReason !== null,
        scheduledAt: scheduled?.dueAt ?? null,
        retryPending: scheduled?.isRetry === true,
        notBeforeAt: Number.isFinite(notBeforeAt) ? notBeforeAt : null,
        disposed,
      };
    },
  };
}
