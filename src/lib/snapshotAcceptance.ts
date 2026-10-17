// Which `/api/setlist` snapshot responses the live page may show.
//
// Since n14 the snapshot is a consistent read (one REPEATABLE READ
// transaction) that carries `rev` (Event.setlistRevision, bumped by
// every setlist-affecting save) and `capturedAt` (the transaction's
// `now()`). Responses can still arrive out of order: two requests in
// flight across a reconnect, a Data Cache entry served by an instance
// that has not seen the tag purge yet, the SSR render racing the first
// client fetch. Without an ordering rule a late, older response would
// roll the page back — a song disappears, then reappears 20 s later.
//
// The rule: show a response iff
//     rev > applied.rev  ||  (rev === applied.rev && capturedAt >= applied.capturedAt)
// i.e. a newer revision always wins; within a revision (reaction counts
// and wishes change without a bump) the later read wins. Ties apply —
// re-applying identical data is harmless, and dropping it would leave
// a same-instant reaction-count change unshown.
//
// State is scoped by a `generation`: switching event or locale starts a
// new generation and late responses from the old one are discarded
// without touching anything.
//
// `serverRev` is the DURABLE watermark: the highest revision the SERVER
// has shown this client — the SSR seed, every response body's `rev`,
// and a `fresh=<dbRev>` verification header whose database read saw a
// revision above the served one. It is what every maintenance request
// (initial, periodic, catch-up, resume, boundary) sends as `?minRev=`,
// and a response older than it is a real, server-proven gap (n13's
// retry path; may surface the "delayed" indicator).
//
// Hints are kept apart from it on purpose. The live channel is a PUBLIC
// Realtime broadcast (private channels failed the admission probe), so
// anyone holding the anon key can publish `{ rev: 2^53 - 1 }` to an
// event's topic. If a hint could enter the durable watermark, one forged
// message would poison every later request of every viewer: each one
// would ask for a revision that never comes, each answer would read as
// a gap, and the indicator would claim the page is broken. So a hint is
// CHECK-ONCE (spec decisions log, "Codex discussion on R2"):
//
//   - `noteHint(rev)` validates a broadcast payload's revision and keeps
//     the max of the current BATCH (every payload since the last
//     dispatch). Nothing else changes.
//   - `captureHint()` is called when a request is DISPATCHED. It hands
//     the batch's max to that request (the request's "ticket") and
//     starts a new, empty batch. Payloads arriving while that request is
//     in flight therefore form the next batch, and since nothing but
//     `captureHint` ever empties the batch, an older request completing
//     can never consume a newer batch — the guard is structural.
//   - The request sends `minRev = max(serverRev, H)`; `evaluate` gets
//     the ticket back and classifies how the response resolved it
//     (`HintResolution`). The ticket itself lives with the scheduler
//     (liveScheduler.ts), which owns the one bounded recheck and drops
//     the ticket after it. Only server-observed values ever raise
//     `serverRev`.
//
// Pure: no timers, no fetch, no clock.

import type { SnapshotVerify } from "@/lib/snapshotVerify";

/** Applied watermark. `null` = unknown (no rev-carrying snapshot yet). */
export interface AppliedSnapshotState {
  rev: number | null;
  /** Epoch ms of the applied snapshot's `capturedAt`. */
  capturedAt: number | null;
}

export interface SnapshotVersion {
  rev: number;
  /** Epoch ms; null = the response carried no usable `capturedAt`. */
  capturedAt: number | null;
}

/** A revision is a non-negative safe integer (BigInt column, JSON number). */
export function isValidRev(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
  );
}

/** ISO string → epoch ms, or null when absent / unparseable. */
export function parseCapturedAt(value: unknown): number | null {
  if (typeof value !== "string" || value === "") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The ordering rule. `incoming.capturedAt === null` (a rev-carrying
 * response without a usable timestamp) is treated as "now", i.e. it
 * wins a same-revision tie.
 */
export function shouldApply(
  incoming: SnapshotVersion,
  applied: AppliedSnapshotState,
): boolean {
  if (applied.rev === null) return true;
  if (incoming.rev > applied.rev) return true;
  if (incoming.rev < applied.rev) return false;
  if (incoming.capturedAt === null || applied.capturedAt === null) return true;
  return incoming.capturedAt >= applied.capturedAt;
}

/**
 * How a response resolved the hint ticket its request carried (`H`).
 * Checked in this order — the first that holds wins:
 *
 *   - `none`: the request carried no ticket.
 *   - `satisfied`: body `rev ≥ H`, whatever the header says. Consume.
 *   - `disproved`: header `fresh=<dbRev>` with `dbRev < H` — a database
 *     read that began after the request did found no such revision. The
 *     hint was wrong (forged, or simply ahead of anything committed).
 *     Consume; healthy; no retry; no indicator effect.
 *   - `superseded`: the server itself has now shown a revision ≥ H (a
 *     `fresh` dbRev ≥ H above the served rev, or an earlier response),
 *     but this body is older. That is a server-proven gap — `serverGap`
 *     is true and the n13 retry path chases `serverRev`, which already
 *     covers H. Consume the ticket.
 *   - `inconclusive`: anything else — `memo`, `deferred`, a missing or
 *     malformed header (an R1 server after a rollback), `none` or
 *     `satisfied` contradicting the body, or a compat body without
 *     `rev`. Not a refutation and not a failure: the scheduler runs ONE
 *     quiet recheck, then drops the ticket.
 */
export type HintResolution =
  | "none"
  | "satisfied"
  | "disproved"
  | "superseded"
  | "inconclusive";

export type AcceptanceVerdict =
  | { kind: "stale-generation" }
  | {
      kind: "evaluated";
      apply: boolean;
      /**
       * The parsed version, or null for a v0.18.x-shaped response with
       * no `rev` (compat — see `evaluate`).
       */
      version: SnapshotVersion | null;
      /**
       * The response is older than a revision the server itself has
       * shown this client (including a `fresh` dbRev reported with this
       * very response). Counts as a soft failure (n13 retry path; may
       * surface "delayed").
       */
      serverGap: boolean;
      /**
       * A `fresh=<dbRev>` header raised `serverRev` above the served
       * body's revision (the server's own read saw a newer head than the
       * snapshot it served). Always implies `serverGap`.
       */
      serverRevRaised: boolean;
      /** What happened to the carried hint ticket (see `HintResolution`). */
      hint: HintResolution;
    };

export interface SnapshotSeed {
  rev?: number | null;
  capturedAt?: string | null;
}

/**
 * Mutable acceptance state for one live data source (one hook
 * instance). All mutation goes through `reset` / `adopt` / `noteHint` /
 * `captureHint` / `evaluate`; read the rest through the getters.
 */
export class SnapshotAcceptance {
  private _generation = 0;
  private _applied: AppliedSnapshotState = { rev: null, capturedAt: null };
  private _serverRev: number | null = null;
  // Max valid hint of the current (not yet dispatched) batch.
  private _pendingHint: number | null = null;

  constructor(seed?: SnapshotSeed) {
    this.reset(seed);
  }

  get generation(): number {
    return this._generation;
  }

  get applied(): AppliedSnapshotState {
    return this._applied;
  }

  /** Durable, server-observed watermark; null when unknown. */
  get serverRev(): number | null {
    return this._serverRev;
  }

  /**
   * What a maintenance request asks for: the server-observed watermark
   * only. Kept under its old name — hints never raise it.
   */
  get wantedRev(): number | null {
    return this._serverRev;
  }

  /** The current, not yet dispatched hint batch (diagnostics / tests). */
  get pendingHint(): number | null {
    return this._pendingHint;
  }

  /** `?minRev=` for a request without a ticket, or null to omit it. */
  minRevToSend(): number | null {
    return this._serverRev;
  }

  /**
   * `?minRev=` for a request carrying ticket `hint`:
   * `max(serverRev, hint)`. A null / invalid ticket falls back to
   * `minRevToSend()`.
   */
  minRevFor(hint: number | null): number | null {
    if (!isValidRev(hint)) return this._serverRev;
    return this._serverRev === null ? hint : Math.max(this._serverRev, hint);
  }

  /**
   * Adopt a version that ANOTHER live source of this page has already
   * applied and shown (used by `useSetlistPolling` when it is enabled;
   * the realtime hook's own disconnected polling needs no hand-over —
   * it shares this instance). Raises the watermark — never lowers it — and
   * counts the revision as server-observed, without starting a new
   * generation (no in-flight response is invalidated). Invalid input
   * is ignored.
   */
  adopt(seed?: SnapshotSeed): void {
    if (!isValidRev(seed?.rev)) return;
    const version: SnapshotVersion = {
      rev: seed!.rev!,
      capturedAt: parseCapturedAt(seed?.capturedAt),
    };
    this._serverRev =
      this._serverRev === null ? version.rev : Math.max(this._serverRev, version.rev);
    const applied = this._applied;
    const newer =
      applied.rev === null ||
      version.rev > applied.rev ||
      (version.rev === applied.rev &&
        version.capturedAt !== null &&
        (applied.capturedAt === null || version.capturedAt > applied.capturedAt));
    if (newer) {
      this._applied = {
        rev: version.rev,
        capturedAt:
          version.capturedAt ??
          (version.rev === applied.rev ? applied.capturedAt : null),
      };
    }
  }

  /**
   * Start a new generation (event or locale changed, or first mount)
   * seeded from SSR. SSR's revision counts as server-observed: the
   * first client fetch must not roll the server-rendered page back.
   * Invalid seeds are ignored (treated as unknown). The pending hint
   * batch belongs to the old event and is dropped.
   */
  reset(seed?: SnapshotSeed): number {
    this._generation += 1;
    const rev = isValidRev(seed?.rev) ? seed!.rev! : null;
    const capturedAt = rev === null ? null : parseCapturedAt(seed?.capturedAt);
    this._applied = { rev, capturedAt };
    this._serverRev = rev;
    this._pendingHint = null;
    return this._generation;
  }

  /**
   * A broadcast announced revision `rev` (untrusted). Returns whether it
   * is news worth a notification fetch:
   *
   *   - invalid (not a non-negative safe integer) → ignored, false;
   *   - `rev ≤ serverRev` → the server has already shown this revision
   *     (or a newer one), nothing to check → false. `serverRev` is never
   *     below `applied.rev` (every applied version is server-observed),
   *     so this includes the "already applied" duplicates — the echo of
   *     a save this page has already fetched, a replay after a rejoin;
   *   - otherwise it joins the current batch (max) → true.
   *
   * Never touches `serverRev`.
   */
  noteHint(rev: unknown): boolean {
    if (!isValidRev(rev)) return false;
    if (this._serverRev !== null && rev <= this._serverRev) return false;
    this._pendingHint =
      this._pendingHint === null ? rev : Math.max(this._pendingHint, rev);
    return true;
  }

  /**
   * Hand the current batch's max to the request being dispatched and
   * start a new batch. Null when the batch is empty, or when the server
   * has meanwhile shown a revision at or past it (nothing left to check).
   */
  captureHint(): number | null {
    const hint = this._pendingHint;
    this._pendingHint = null;
    if (hint === null) return null;
    if (this._serverRev !== null && hint <= this._serverRev) return null;
    return hint;
  }

  /**
   * Decide what to do with a parsed response body from generation
   * `generation`, and record it.
   *
   * `verify` is the response's parsed `x-snapshot-verify` header
   * (absent → `missing`). `carriedHint` is the ticket the request
   * carried (null = none). Neither can make a response apply or not —
   * that is the `(rev, capturedAt)` rule alone — they only decide the
   * gap classification and the hint resolution.
   *
   * Compat (v0.18.x responses without `rev`, during a rollout): the
   * spec treats them as `rev = applied.rev ?? 0, capturedAt = now`,
   * which always applies. We apply them and leave the watermark
   * untouched instead of writing `now` into it — `now` is the CLIENT
   * clock, and storing it next to server `capturedAt` values would let
   * a fast client clock reject the next real same-revision snapshot.
   * A ticket carried by such a request is inconclusive (nothing to
   * compare it with).
   */
  evaluate(
    generation: number,
    body: { rev?: unknown; capturedAt?: unknown },
    verify: SnapshotVerify = { kind: "missing" },
    carriedHint: number | null = null,
  ): AcceptanceVerdict {
    if (generation !== this._generation) return { kind: "stale-generation" };
    const hint = isValidRev(carriedHint) ? carriedHint : null;

    if (!isValidRev(body.rev)) {
      return {
        kind: "evaluated",
        apply: true,
        version: null,
        serverGap: false,
        serverRevRaised: false,
        hint: hint === null ? "none" : "inconclusive",
      };
    }

    const version: SnapshotVersion = {
      rev: body.rev,
      capturedAt: parseCapturedAt(body.capturedAt),
    };
    const apply = shouldApply(version, this._applied);

    // Every revision the server returns is server-observed, applied or
    // not (a rejected response is by definition not newer, so this
    // never raises the bar above what was applied — it is a max).
    let serverRev =
      this._serverRev === null ? version.rev : Math.max(this._serverRev, version.rev);
    // A fresh revision read is server-observed too. Only when it is
    // ABOVE the served body does it say anything new: the server's own
    // read saw a head the snapshot it served does not contain, so the
    // existing server-gap path must chase it. (A `memo` revision is not
    // used here: it may be a coalesced read that predates the save.)
    let serverRevRaised = false;
    if (
      verify.kind === "fresh" &&
      isValidRev(verify.dbRev) &&
      verify.dbRev > version.rev &&
      verify.dbRev > serverRev
    ) {
      serverRev = verify.dbRev;
      serverRevRaised = true;
    }
    this._serverRev = serverRev;
    const serverGap = version.rev < serverRev;

    if (apply) {
      this._applied = {
        rev: version.rev,
        capturedAt:
          version.capturedAt ??
          (version.rev === this._applied.rev ? this._applied.capturedAt : null),
      };
    }

    let resolution: HintResolution;
    if (hint === null) resolution = "none";
    else if (version.rev >= hint) resolution = "satisfied";
    else if (verify.kind === "fresh" && verify.dbRev < hint) resolution = "disproved";
    else if (serverRev >= hint) resolution = "superseded";
    else resolution = "inconclusive";

    return {
      kind: "evaluated",
      apply,
      version,
      serverGap,
      serverRevRaised,
      hint: resolution,
    };
  }
}

/**
 * `/api/setlist` URL for one snapshot request. `minRev` is appended only
 * when it is a valid revision; `&hint=1` (marks a notification fetch —
 * the server only logs it, and an older server ignores it) only together
 * with a `minRev`.
 */
export function setlistSnapshotUrl(
  eventId: string,
  locale: string,
  minRev: number | null,
  notify = false,
): string {
  const base = `/api/setlist?eventId=${encodeURIComponent(eventId)}&locale=${encodeURIComponent(locale)}`;
  if (!isValidRev(minRev)) return base;
  return notify ? `${base}&minRev=${minRev}&hint=1` : `${base}&minRev=${minRev}`;
}
