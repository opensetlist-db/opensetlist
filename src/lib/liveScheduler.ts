// Fetch scheduler for the live event page's `/api/setlist` snapshot.
//
// Used by `useRealtimeEventChannel` (healthy: notifications + a slow
// periodic repair poll; while the channel is disconnected the same
// scheduler switches to the 5 s ± 1 s fallback cadence via
// `setPeriodic`), by the standalone `useSetlistPolling`, and by
// `useImpressionPolling`. It decides WHEN a snapshot request runs and
// WHAT KIND of request it is (the `LiveFetchRequest` descriptor handed
// to `runFetch`); the hook's `runFetch` turns that into a URL, runs it
// (deadline, acceptance, freshness bookkeeping) and reports back how it
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
//     client dirty, and at most ONE more request runs after the current
//     one settles (however many triggers arrived meanwhile; none when
//     the only trigger was a notification the settled request already
//     answered — see "nothing left to check" below). The
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
//     notification / recheck / catch-up / resume / boundary request (or
//     any request that carries a hint ticket) starts per `cooldownMs`.
//     A trigger inside the window is never dropped: it is scheduled at
//     `max(nextEligibleAt, now + jitter)`, or — if a request is in
//     flight — becomes the dirty follow-up, which waits for
//     `max(nextEligibleAt, now)` (no second jitter: the client already
//     sat one out, and the in-flight request's settle time is itself
//     random). So a reconnect that brings `SUBSCRIBED` and `online`
//     together costs one request, not two. On a public broadcast channel
//     the cooldown is also the only per-client bound on hint-driven
//     load: a guest spamming the topic gets at most one request per
//     second out of each viewer (≈ 500 rps cluster-wide at 500 viewers,
//     mostly cache hits).
//
//   - Periodic repair poll. While the hook keeps the scheduler alive
//     (the realtime hook disposes it when the tab hides), a periodic
//     tick fires every `intervalMs ± spreadMs`. It repairs lost
//     notifications and refreshes the slices that have no push of their
//     own (reaction counts, wish TOP-3, status).
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
//     path — notification, recheck, catch-up, resume, boundary,
//     periodic, dirty follow-up — computes its usual due time and then
//     takes `max(due, notBeforeAt + U(0, jitter))`. The jitter on top of
//     the floor matters: every viewer that got a 503 in the same burst
//     would otherwise wake at nearly the same floor edge. The retry
//     itself is the one exception — it is due at `max(now + retryInMs,
//     notBeforeAt)` with no extra jitter, because `retryInMs` already IS
//     the clamped Retry-After (n13: "the server asked for that exact
//     spacing"). The floor only moves forward and simply expires; a
//     success does not need to clear it.
//
// WHAT a request is — derived from state at DISPATCH, never from the
// trigger that happened to arm the timer. The R1 scheduler stored one
// reason per pending slot and let a notification overwrite whatever was
// pending; with hints that reason decides the URL, so the overwrite
// became a correctness bug (a periodic repair could be silently turned
// into a hint fetch that a stale cache entry satisfies, and a tick that
// landed while work was scheduled or in flight was dropped). Instead
// the scheduler keeps three independent obligations and folds them into
// whichever request dispatches next:
//
//   - `genericRequired` (sticky): set by every maintenance trigger —
//     initial, periodic, catch-up, resume / online, boundary. The next
//     request that dispatches takes the GENERIC path (`minRev =
//     serverRev`, no `hint=1`). A notification can neither clear nor
//     downgrade it. Overdue ticks collapse into the one flag. The flag
//     moves onto the request at dispatch; if that request FAILS it comes
//     back (the retry is generic too); it is discharged only when a
//     generic request succeeds. A periodic tick while a generic request
//     is already in flight is covered by it (same purpose, no ordering
//     requirement); every other maintenance trigger during a flight —
//     and a tick during a non-generic flight — marks the client dirty,
//     because its read must start after the trigger.
//
//   - The hint TICKET (`captureHint` + a carried ticket). At dispatch
//     the scheduler asks the page for the current broadcast batch
//     (`captureHint`, see snapshotAcceptance.ts) and attaches it, merged
//     with any ticket a previous request left behind, to the request.
//     A non-generic request with a first-check ticket is a NOTIFICATION
//     fetch (`minRev = max(serverRev, H)` + `hint=1`). A generic request
//     takes the ticket along as `minRev = max(serverRev, H)` WITHOUT
//     `hint=1` — one request satisfies both obligations.
//
//   - One bounded RECHECK per ticket. When `runFetch` reports the
//     ticket `inconclusive` (the server answered with an older snapshot
//     but could not prove the hint wrong — `memo`, `deferred`, or no
//     verification header at all, i.e. an R1 server after a rollback),
//     the ticket is kept in the "recheck" phase and a quiet recheck is
//     scheduled at `now + max(recheckDelayMs, cooldown remaining) +
//     U(0, jitterMs)`, under the floor. 1 s is the server's revision
//     memo window: a recheck inside it would likely hit the same memo.
//     The recheck still sends `minRev = max(serverRev, H)` — without the
//     hint an unhinted request would be satisfied by the same stale
//     cache entry and the update would wait for the periodic repair —
//     but no `hint=1`. It shares and advances the notification cooldown.
//     A second inconclusive answer drops the ticket (`onHintExhausted`)
//     and leaves the periodic repair to it: a forged hint costs each
//     viewer at most two cheap requests, never a stuck page or a
//     "delayed" indicator. A ticket survives an ordinary failure (the
//     retry carries it); a resolved ticket (satisfied / disproved /
//     superseded) is gone. A recheck-phase ticket does not ride on an
//     unrelated request that dispatches before the recheck is due (that
//     would spend the one recheck inside the memo window); it waits for
//     its own timer, which is re-armed after that request settles.
//
//   - A notification with nothing left to check does not fetch. A save
//     typically broadcasts twice in quick succession (an insert-after
//     followed by the PUT that fills it in), so the second broadcast
//     often lands while the first one's fetch is in flight and becomes
//     its dirty follow-up — but that fetch usually comes back with the
//     newer revision already, and `captureHint` then returns null
//     (every pending hint is ≤ the server-observed watermark). Running
//     a plain request anyway does nothing the contract needs: the
//     server has already shown a revision ≥ every hint this client was
//     told about. Measured on dev, that was about a third of all
//     notification-driven requests. So such a dispatch is skipped —
//     but ONLY when nothing else is owed: no maintenance obligation, no
//     retry (a retry stands in for a failed request, including a
//     server-proven gap whose ticket was already resolved), and a
//     carried recheck ticket keeps its own timer. A scheduler without
//     `captureHint` has no ticket evidence at all, so its notifications
//     still run as plain requests.
//
// Everything time-related goes through the injectable `clock` and
// `random` so the unit tests can drive it with fake timers and pinned
// randomness. All values are relative waits — no stored-date
// comparisons — so the UTC rule does not apply here.

/**
 * Why a snapshot request is being asked for (and the label the request
 * runs with — see `LiveFetchRequest.reason`).
 *
 *   - `initial`: the first seed of a page (mount). Immediate. Generic.
 *   - `notification`: a broadcast announced a new revision. Jittered by
 *     `jitterMs`, cooldown.
 *   - `catchup`: `SUBSCRIBED` (initial join or a rejoin after a gap).
 *     Generic.
 *   - `resume`: the tab became visible again, or the browser went back
 *     `online`. Generic.
 *   - `boundary`: an event-status boundary (startTime, completed flip).
 *     Generic. `catchup` / `resume` / `boundary` are jittered by
 *     `catchupJitterMs`, cooldown.
 *   - `periodic`: the repair / fallback poll tick. Generic.
 *   - `retry`: the scheduler's own retry after a failure.
 *   - `recheck`: the scheduler's one quiet recheck of an inconclusive
 *     hint ticket. Jittered by `jitterMs`, cooldown.
 */
export type LiveFetchReason =
  | "initial"
  | "notification"
  | "periodic"
  | "catchup"
  | "resume"
  | "boundary"
  | "retry"
  | "recheck";

/**
 * Triggers that can fire on many viewers at the same instant, and are
 * therefore jittered and share the per-client cooldown (header).
 */
function isSpreadReason(reason: LiveFetchReason): boolean {
  return (
    reason === "notification" ||
    reason === "recheck" ||
    reason === "catchup" ||
    reason === "resume" ||
    reason === "boundary"
  );
}

/** Maintenance triggers: they set the sticky `genericRequired`. */
function isGenericReason(reason: LiveFetchReason): boolean {
  return (
    reason === "initial" ||
    reason === "periodic" ||
    reason === "catchup" ||
    reason === "resume" ||
    reason === "boundary"
  );
}

/**
 * What the request about to run must send. Built by the scheduler at
 * dispatch; `runFetch` turns it into the URL:
 *
 *   | generic | hint | notify | URL                                  |
 *   |---------|------|--------|--------------------------------------|
 *   | true    | null | false  | minRev = serverRev                   |
 *   | true    | H    | false  | minRev = max(serverRev, H)           |
 *   | false   | H    | true   | minRev = max(serverRev, H) & hint=1  |
 *   | false   | H    | false  | minRev = max(serverRev, H) (recheck) |
 *   | false   | null | false  | minRev = serverRev                   |
 */
export interface LiveFetchRequest {
  /**
   * Label for logs / breadcrumbs: `retry` for a retry; a maintenance
   * trigger's own reason when it armed the request; otherwise the
   * pending maintenance reason (generic), `recheck` or `notification`
   * (by the ticket's phase), or the arming trigger.
   */
  reason: LiveFetchReason;
  /** Maintenance path: discharges `genericRequired` on success. */
  generic: boolean;
  /** The carried hint ticket `H`, or null. */
  hint: number | null;
  /** Send `&hint=1` — a notification fetch (first check of `H`). */
  notify: boolean;
}

/**
 * How the request's hint ticket fared (reported by `runFetch`):
 *
 *   - `resolved`: satisfied, disproved, or superseded by a server-proven
 *     revision — the ticket is consumed.
 *   - `inconclusive`: the answer neither satisfied nor refuted it — one
 *     recheck (first time) or drop (after the recheck).
 *   - absent: the request never got to evaluate it (an HTTP / network /
 *     deadline failure) — a failed request keeps the ticket for its
 *     retry; an `ok` without it counts as resolved.
 */
export type LiveHintOutcome = "resolved" | "inconclusive";

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
  | { kind: "ok"; hint?: LiveHintOutcome }
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
      /**
       * Set when the request DID evaluate its ticket but failed anyway
       * (a server-proven gap): the ticket's fate is decided here, not
       * by the failure.
       */
      hint?: LiveHintOutcome;
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
 * At most one spread-trigger request (notification, recheck, catch-up,
 * resume, boundary) per client per second.
 */
export const NOTIFICATION_COOLDOWN_MS = 1_000;
/**
 * Minimum wait before rechecking an inconclusive hint: the server's
 * per-instance revision memo window. A recheck inside it would most
 * likely be answered from the same memo again.
 */
export const RECHECK_MIN_DELAY_MS = 1_000;
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
  /**
   * Runs one request. `request` is the descriptor built at dispatch;
   * `reason` repeats `request.reason` (callers that only need the label,
   * like the impression poller, can ignore the second argument).
   */
  runFetch: (
    reason: LiveFetchReason,
    request: LiveFetchRequest,
  ) => Promise<LiveFetchOutcome>;
  /**
   * Hands over the current hint batch at dispatch (and starts a new
   * one) — `SnapshotAcceptance.captureHint`. Absent = this data source
   * has no hints (polling, impressions), and a notification then always
   * runs as a plain request. Present = a notification whose capture
   * comes back null (and with nothing else owed) is skipped.
   */
  captureHint?: () => number | null;
  /** A ticket was dropped after its recheck was inconclusive too. */
  onHintExhausted?: (hint: number) => void;
  /** Notification / recheck jitter bound (default `NOTIFICATION_JITTER_MS`). */
  jitterMs?: number;
  /**
   * Jitter bound for catch-up / resume / boundary (default
   * `CATCHUP_JITTER_MS`). Also the floor jitter for the triggers that
   * have none of their own (initial, periodic).
   */
  catchupJitterMs?: number;
  cooldownMs?: number;
  /** Recheck minimum delay (default `RECHECK_MIN_DELAY_MS`). */
  recheckDelayMs?: number;
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
  /** Label of the scheduled request (null when nothing is scheduled). */
  scheduledReason: LiveFetchReason | null;
  retryPending: boolean;
  /**
   * A maintenance obligation is outstanding: not yet dispatched, or
   * dispatched and not yet succeeded.
   */
  genericRequired: boolean;
  /** The carried hint ticket waiting for a retry / recheck (or null). */
  carriedHint: number | null;
  /** Phase of the carried ticket (null when none). */
  carriedHintPhase: "notification" | "recheck" | null;
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

/**
 * A hint ticket. `phase` "notification" = not checked yet; "recheck" =
 * checked once, inconclusive, waiting for (or riding on) its recheck,
 * which is due at `dueAt`.
 */
interface HintTicket {
  hint: number;
  phase: "notification" | "recheck";
  dueAt: number;
}

/**
 * Merge two tickets into one. The larger hint dominates and keeps its
 * phase: checking the larger revision checks the smaller one too
 * (satisfied ⇒ satisfied; a fresh refutation of the larger either
 * refutes the smaller or raises `serverRev` past it), and an
 * inconclusive answer for the larger is dropped together with the
 * smaller after the one recheck. Equal hints keep the earlier phase
 * (the one with a check still owed).
 */
function mergeTickets(a: HintTicket | null, b: HintTicket | null): HintTicket | null {
  if (a === null) return b;
  if (b === null) return a;
  if (a.hint !== b.hint) return a.hint > b.hint ? a : b;
  return a.phase === "notification" ? a : b;
}

interface DirtyMark {
  reason: LiveFetchReason;
  immediate: boolean;
}

interface ScheduledEntry {
  handle: unknown;
  dueAt: number;
  reason: LiveFetchReason;
  isRetry: boolean;
}

export function createLiveScheduler(
  options: LiveSchedulerOptions,
): LiveScheduler {
  const {
    runFetch,
    captureHint,
    onHintExhausted,
    jitterMs = NOTIFICATION_JITTER_MS,
    catchupJitterMs = CATCHUP_JITTER_MS,
    cooldownMs = NOTIFICATION_COOLDOWN_MS,
    recheckDelayMs = RECHECK_MIN_DELAY_MS,
    initialNotBeforeAt = null,
    random = Math.random,
    clock = defaultClock,
  } = options;

  // Jitter bound of a trigger; also the jitter added on top of an
  // active server floor. Triggers without a jitter of their own
  // (initial, periodic, a non-spread follow-up) use the catch-up bound
  // there, so nothing wakes exactly on the shared floor edge.
  const jitterFor = (reason: LiveFetchReason): number =>
    reason === "notification" || reason === "recheck" ? jitterMs : catchupJitterMs;

  let periodic: PeriodicConfig | null = options.periodic ?? null;
  let disposed = false;
  let started = false;
  let inFlight = false;
  // Whether the in-flight request took the generic path (a periodic
  // tick during it is covered).
  let inFlightGeneric = false;

  // Obligations (header): folded into whichever request dispatches next.
  let genericRequired = false;
  // Latest maintenance trigger — the label of a generic request armed by
  // a non-maintenance trigger.
  let genericReason: LiveFetchReason = "periodic";
  // A notification trigger has not dispatched yet. Needed for hint-less
  // callers (no `captureHint`): their notification still runs.
  let notificationPending = false;
  // The ticket waiting for a retry or its recheck.
  let carried: HintTicket | null = null;
  // A failed request is owed a retry that has not dispatched yet. The
  // retry normally runs from its own scheduled entry (`isRetryRun`), but
  // an earlier-due trigger may REPLACE that entry ("an explicit trigger
  // supersedes the retry"), and the replacing run then stands in for
  // the retry without being marked as one. The ticket-less-notification
  // skip in `run` must not swallow it, so the debt is tracked here and
  // cleared by whichever request dispatches next.
  let retryOwed = false;

  // Follow-up owed after the in-flight request settles; `immediate`
  // when any trigger that marked it runs unjittered (initial, periodic,
  // retry), else it waits for the cooldown edge.
  let dirty: DirtyMark | null = null;
  // The ONE deferred request — a jittered trigger, a request held back
  // by the floor, a recheck, or the retry after a failure. Keeping the
  // retry in this slot (instead of a timer of its own) is what makes
  // "an earlier trigger replaces it, a later one is covered by it" fall
  // out of `scheduleAt`'s single comparison. WHAT the request does is
  // decided at dispatch (`run`), so replacing or covering an entry never
  // loses an obligation.
  let scheduled: ScheduledEntry | null = null;
  let periodicHandle: unknown = null;
  // Start time of the last cooldown-bound request; the cooldown window
  // is measured from here.
  let lastSpreadStartAt = Number.NEGATIVE_INFINITY;
  // Start of the last request that carried a hint ticket. Separate from
  // `lastSpreadStartAt` (which maintenance triggers also advance) so a
  // catch-up or resume never pushes a due recheck past its own window:
  // the hint cooldown is a ceiling on HINT-carrying requests only.
  let lastTicketStartAt = Number.NEGATIVE_INFINITY;
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
  // arrived, so its read already covers it (and it will pick up this
  // trigger's obligation at dispatch).
  //
  // `isRetry` records that the request stands in for a failed one (it
  // is what `retryPending` reports, and a retry takes a carried ticket
  // along even before its recheck is due).
  const scheduleAt = (dueAt: number, reason: LiveFetchReason, isRetry = false) => {
    if (scheduled && scheduled.dueAt <= dueAt) {
      if (isRetry) scheduled.isRetry = true;
      return;
    }
    clearScheduled();
    const delay = Math.max(0, dueAt - clock.now());
    const entry: ScheduledEntry = { handle: null, dueAt, reason, isRetry };
    entry.handle = clock.setTimeout(() => {
      scheduled = null;
      void run(entry.reason, entry.isRetry);
    }, delay);
    scheduled = entry;
  };

  // Start now if nothing holds the request back, else defer it.
  const startOrSchedule = (dueAt: number, reason: LiveFetchReason) => {
    if (dueAt <= clock.now()) {
      void run(reason, false);
      return;
    }
    scheduleAt(dueAt, reason);
  };

  const armRecheck = (ticket: HintTicket, now: number) => {
    scheduleAt(applyFloor(ticket.dueAt, now, jitterFor("recheck")), "recheck");
  };

  const markDirty = (reason: LiveFetchReason) => {
    const immediate = !isSpreadReason(reason);
    if (dirty === null) {
      dirty = { reason, immediate };
    } else if (immediate && !dirty.immediate) {
      dirty = { reason, immediate: true };
    } else if (!dirty.immediate) {
      dirty = { reason, immediate: false };
    }
  };

  const run = async (entryReason: LiveFetchReason, isRetryRun: boolean): Promise<void> => {
    if (disposed) return;
    clearScheduled();
    const now = clock.now();

    // ── Fold the obligations into this request ──
    const hadNotification = notificationPending;
    notificationPending = false;
    const fresh = captureHint ? captureHint() : null;
    let ticket: HintTicket | null =
      fresh === null
        ? null
        : { hint: fresh, phase: "notification", dueAt: Number.NEGATIVE_INFINITY };
    if (carried !== null) {
      if (ticket !== null && ticket.hint >= carried.hint) {
        // The new batch covers the carried ticket; a check of the new
        // one checks the old one too.
        carried = null;
      } else if (carried.phase === "notification" || isRetryRun || now >= carried.dueAt) {
        ticket = mergeTickets(ticket, carried);
        carried = null;
      }
      // else: a recheck-phase ticket not yet due waits for its own
      // timer (re-armed after this request settles).
    }
    const generic = genericRequired;

    // A recheck timer with nothing left to do (its ticket rode along
    // on an earlier request) does not fetch.
    if (
      entryReason === "recheck" &&
      !isRetryRun &&
      ticket === null &&
      !generic &&
      !hadNotification
    ) {
      if (carried !== null) armRecheck(carried, now);
      return;
    }

    // A notification whose hints the server has already answered does
    // not fetch (header: "a notification with nothing left to check").
    // `ticket === null` with a `captureHint` source means the batch was
    // empty or every hint in it is ≤ `serverRev` — the server has shown
    // a revision at or past everything this client was told about, so a
    // plain request could only re-read what is already applied.
    //
    // This does not lose the REPEATABLE READ case: fetch A's snapshot
    // may predate commit N+1 while broadcast N+1 arrives during A. Then
    // A's response carries at most N, `serverRev` stays below N+1, and
    // `captureHint` returns N+1 at this dispatch — a real ticket, so the
    // follow-up runs as a notification fetch. The skip fires only when
    // the server has already shown a revision ≥ every pending hint.
    //
    // Everything else that may be owed still runs: a maintenance
    // obligation (`generic`), a retry (its own entry, or one this run
    // replaced — `retryOwed`), and a carried recheck ticket, whose
    // timer is re-armed here exactly as the early return above does
    // (this run's dispatch cleared the scheduled slot, which may have
    // been holding it). A scheduler created without `captureHint`
    // (polling, impressions, R1-era callers) has no ticket evidence, so
    // its notification still runs as a plain request.
    if (
      entryReason === "notification" &&
      captureHint !== undefined &&
      !isRetryRun &&
      !retryOwed &&
      ticket === null &&
      !generic
    ) {
      if (carried !== null) armRecheck(carried, now);
      return;
    }

    // No request that carries a hint ticket starts inside the shared
    // cooldown, whatever path dispatched it: an immediate dirty
    // follow-up after a settle, a maintenance tick that happened to be
    // due, a retry armed with a short delay. The cooldown is the
    // per-client ceiling the contract promises the server (≤ 1
    // hint-carrying request per second, so a broadcast flood cannot
    // turn into a fetch flood by riding on uncorrelated triggers).
    // Put the ticket back and come back at the cooldown edge; a plain
    // maintenance request without a ticket is not held.
    if (ticket !== null && now < lastTicketStartAt + cooldownMs) {
      carried = mergeTickets(carried, ticket);
      scheduleAt(
        applyFloor(lastTicketStartAt + cooldownMs, now, jitterMs),
        entryReason,
        isRetryRun,
      );
      return;
    }

    genericRequired = false;
    const label: LiveFetchReason = isRetryRun
      ? "retry"
      : isGenericReason(entryReason)
        ? entryReason
        : generic
          ? genericReason
          : ticket?.phase === "recheck"
            ? "recheck"
            : ticket !== null
              ? "notification"
              : entryReason;
    const request: LiveFetchRequest = {
      reason: label,
      generic,
      hint: ticket?.hint ?? null,
      notify: !generic && ticket !== null && ticket.phase === "notification",
    };

    inFlight = true;
    inFlightGeneric = generic;
    retryOwed = false;
    dirty = null;
    if (isSpreadReason(label) || ticket !== null) lastSpreadStartAt = now;
    if (ticket !== null) lastTicketStartAt = now;

    let outcome: LiveFetchOutcome;
    try {
      outcome = await runFetch(label, request);
    } catch {
      // `runFetch` is expected to classify its own errors. A throw here
      // is a programming error in the caller; treat it as cancelled
      // rather than inventing a retry delay the scheduler doesn't own.
      outcome = { kind: "cancelled" };
    }
    inFlight = false;
    inFlightGeneric = false;
    if (disposed) return;

    // (Cast: TypeScript narrows `dirty` to null from the reset before
    // the await and cannot see `requestFetch` setting it meanwhile.)
    const followUp = dirty as DirtyMark | null;
    dirty = null;

    if (outcome.kind === "cancelled") {
      // The session is ending (or the event changed): the ticket is
      // dropped with it; an undischarged maintenance obligation stays.
      if (generic) genericRequired = true;
      return;
    }

    const settledAt = clock.now();

    // ── The ticket's fate ──
    if (ticket !== null) {
      if (outcome.hint === "inconclusive") {
        if (ticket.phase === "notification") {
          const recheck: HintTicket = {
            hint: ticket.hint,
            phase: "recheck",
            dueAt:
              settledAt +
              Math.max(recheckDelayMs, nextEligibleAt() - settledAt) +
              random() * jitterMs,
          };
          carried = mergeTickets(carried, recheck);
        } else {
          onHintExhausted?.(ticket.hint);
        }
      } else if (outcome.hint === undefined && outcome.kind === "failed") {
        // Never evaluated (HTTP / network / deadline): the retry
        // carries it.
        carried = mergeTickets(carried, ticket);
      }
      // "resolved", or an ok without a verdict: consumed.
    }

    if (outcome.kind === "failed") {
      // A failed generic request keeps the obligation for its retry.
      if (generic) genericRequired = true;
      const floorMs = outcome.notBeforeMs;
      if (typeof floorMs === "number" && Number.isFinite(floorMs)) {
        notBeforeAt = Math.max(notBeforeAt, settledAt + Math.max(0, floorMs));
      }
      // The retry is the follow-up: it starts after every trigger that
      // marked us dirty, carries every obligation that is still open
      // (generic, the ticket, a pending batch), and respects the
      // backoff a struggling server needs. An earlier-due explicit
      // trigger still replaces it, but never below the floor.
      retryOwed = true;
      scheduleAt(
        Math.max(settledAt + Math.max(0, outcome.retryInMs), notBeforeAt),
        "retry",
        true,
      );
      return;
    }

    if (carried !== null) armRecheck(carried, settledAt);
    if (followUp === null) return;

    if (followUp.immediate) {
      startOrSchedule(
        applyFloor(settledAt, settledAt, jitterFor(followUp.reason)),
        followUp.reason,
      );
    } else {
      // No new jitter: this client already sat out one jitter window
      // (or its trigger arrived at a random point of an in-flight
      // request whose settle time is itself random). The cooldown
      // still applies.
      scheduleAt(
        applyFloor(
          Math.max(nextEligibleAt(), settledAt),
          settledAt,
          jitterFor(followUp.reason),
        ),
        followUp.reason,
      );
    }
  };

  const requestFetch = (reason: LiveFetchReason) => {
    if (disposed) return;
    const now = clock.now();

    if (reason === "recheck") {
      // Internal reason; an explicit call just (re)arms the recheck of
      // a carried ticket, if there is one.
      if (!inFlight && carried !== null) armRecheck(carried, now);
      return;
    }

    if (reason === "periodic" && inFlight && inFlightGeneric) {
      // The generic request in flight IS this period's repair.
      return;
    }
    if (isGenericReason(reason)) {
      genericRequired = true;
      genericReason = reason;
    } else if (reason === "notification") {
      notificationPending = true;
    }

    if (inFlight) {
      markDirty(reason);
      return;
    }

    if (reason === "periodic") {
      // A scheduled request (a pending retry included: the backoff
      // holds) will take the generic path when it dispatches.
      if (scheduled) return;
      startOrSchedule(applyFloor(now, now, jitterFor("periodic")), "periodic");
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

    // Not correlated across viewers (the first seed, an explicit
    // retry): start now, which replaces a later-due scheduled request
    // (including a pending retry) — it IS that request — unless the
    // floor holds it back.
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
        dirty: dirty !== null,
        scheduledAt: scheduled?.dueAt ?? null,
        scheduledReason: scheduled?.reason ?? null,
        retryPending: scheduled?.isRetry === true,
        genericRequired: genericRequired || (inFlight && inFlightGeneric),
        carriedHint: carried?.hint ?? null,
        carriedHintPhase: carried?.phase ?? null,
        notBeforeAt: Number.isFinite(notBeforeAt) ? notBeforeAt : null,
        disposed,
      };
    },
  };
}
