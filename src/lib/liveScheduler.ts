// Fetch scheduler for the live event page's `/api/setlist` snapshot.
//
// Shared by `useRealtimeEventChannel` (healthy path: notifications +
// a slow periodic repair poll) and `useSetlistPolling` (R3 fallback:
// a 5 s ± 1 s poll). It decides WHEN a snapshot request runs; the hook
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
//   - Jitter on notifications only. A notification reaches every viewer
//     at the same instant, so each client waits `U(0, jitterMs)` before
//     fetching to spread the burst. Other triggers (resume, SUBSCRIBED
//     catch-up, status boundary, retry, periodic) are not synchronized
//     across viewers, or are already spread by their own randomness,
//     and run immediately.
//
//   - Per-client notification cooldown. At most one notification-
//     triggered request starts per `cooldownMs`. A notification inside
//     the window is never dropped: it is scheduled at
//     `max(nextEligibleAt, now + jitter)`, or — if a request is in
//     flight — becomes the dirty follow-up, which waits for
//     `max(nextEligibleAt, now)`.
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

/** Why a snapshot request is being asked for. */
export type LiveFetchReason =
  | "notification"
  | "periodic"
  | "catchup"
  | "resume"
  | "retry"
  | "manual";

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

/** R1 default notification jitter (spec: run #2 measures 250 vs 750). */
export const NOTIFICATION_JITTER_MS = 500;
/** At most one notification-triggered request per client per second. */
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
  jitterMs?: number;
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
    cooldownMs = NOTIFICATION_COOLDOWN_MS,
    periodic = null,
    initialNotBeforeAt = null,
    random = Math.random,
    clock = defaultClock,
  } = options;

  let disposed = false;
  let started = false;
  let inFlight = false;
  // Reason that marked us dirty while in flight; null = clean. A
  // non-notification reason wins over "notification" because it must
  // not wait out the notification cooldown (a SUBSCRIBED catch-up or a
  // status boundary is not part of the synchronized burst the cooldown
  // exists to thin out).
  let dirtyReason: LiveFetchReason | null = null;
  // The ONE deferred request — a jittered notification, a request held
  // back by the floor, or the retry after a failure. Keeping the retry
  // in this slot (instead of a timer of its own) is what makes "an
  // earlier trigger replaces it, a later one is covered by it" fall out
  // of `scheduleAt`'s single comparison.
  let scheduled: { handle: unknown; dueAt: number; reason: LiveFetchReason } | null =
    null;
  let periodicHandle: unknown = null;
  // Start time of the last notification-triggered request; the cooldown
  // window is measured from here.
  let lastNotificationStartAt = Number.NEGATIVE_INFINITY;
  let notBeforeAt =
    initialNotBeforeAt === null || !Number.isFinite(initialNotBeforeAt)
      ? Number.NEGATIVE_INFINITY
      : initialNotBeforeAt;

  const nextEligibleAt = () => lastNotificationStartAt + cooldownMs;

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
  const scheduleAt = (dueAt: number, reason: LiveFetchReason) => {
    if (scheduled && scheduled.dueAt <= dueAt) return;
    clearScheduled();
    const delay = Math.max(0, dueAt - clock.now());
    const handle = clock.setTimeout(() => {
      scheduled = null;
      void run(reason);
    }, delay);
    scheduled = { handle, dueAt, reason };
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
    if (reason === "notification") lastNotificationStartAt = clock.now();

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
      scheduleAt(
        Math.max(now + Math.max(0, outcome.retryInMs), notBeforeAt),
        "retry",
      );
      return;
    }
    if (outcome.kind === "cancelled" || followUp === null) return;

    const now = clock.now();
    if (followUp === "notification") {
      // No new jitter: this client already sat out one jitter window,
      // and the in-flight request's settle time is itself random.
      scheduleAt(
        applyFloor(Math.max(nextEligibleAt(), now), now, jitterMs),
        "notification",
      );
    } else {
      startOrSchedule(applyFloor(now, now, jitterMs), followUp);
    }
  };

  const requestFetch = (reason: LiveFetchReason) => {
    if (disposed) return;
    const now = clock.now();

    if (reason === "periodic") {
      // `scheduled` includes a pending retry: the backoff holds.
      if (inFlight || scheduled) return;
      startOrSchedule(applyFloor(now, now, jitterMs), "periodic");
      return;
    }

    if (inFlight) {
      if (dirtyReason === null || dirtyReason === "notification") {
        dirtyReason = reason;
      }
      return;
    }

    if (reason === "notification") {
      const dueAt = Math.max(now + random() * jitterMs, nextEligibleAt());
      // Always through a timer (even at zero jitter), so a burst of
      // pushes in one task collapses into the one scheduled request.
      scheduleAt(applyFloor(dueAt, now, jitterMs), "notification");
      return;
    }

    // Replaces a later-due scheduled request (including a pending
    // retry) — it IS that request — unless the floor holds it back.
    startOrSchedule(applyFloor(now, now, jitterMs), reason);
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
    dispose() {
      disposed = true;
      clearScheduled();
      if (periodicHandle !== null) {
        clock.clearTimeout(periodicHandle);
        periodicHandle = null;
      }
    },
    getState() {
      return {
        inFlight,
        dirty: dirtyReason !== null,
        scheduledAt: scheduled?.dueAt ?? null,
        retryPending: scheduled?.reason === "retry",
        notBeforeAt: Number.isFinite(notBeforeAt) ? notBeforeAt : null,
        disposed,
      };
    },
  };
}
