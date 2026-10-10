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
// `wantedRev` is what the client sends as `?minRev=`. It is the highest
// revision the SERVER has shown this client (SSR or any response) plus,
// from R2 on, the highest revision announced by a broadcast hint. The
// two sources are kept apart on purpose: a response older than a
// server-observed revision is a real, server-proven gap (counts toward
// n13's retry path and may surface the "delayed" indicator); a response
// older than a hint only proves that SOMEONE claimed a newer revision —
// on a public channel that claim is unauthenticated, so it must never
// drive the indicator on its own (spec decisions log, 2026-10-10).
// R1 has no hints: postgres_changes notifications carry no revision,
// they only mark the scheduler dirty.
//
// Pure: no timers, no fetch, `now` is passed in.

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
       * shown this client. Counts as a soft failure (n13 retry path;
       * may surface "delayed").
       */
      serverGap: boolean;
      /**
       * The response is older than a hinted (notification) revision
       * only. Never drives the indicator. Always false in R1.
       */
      hintGap: boolean;
    };

export interface SnapshotSeed {
  rev?: number | null;
  capturedAt?: string | null;
}

/**
 * Mutable acceptance state for one live data source (one hook
 * instance). All mutation goes through `reset` / `noteHintRev` /
 * `evaluate`; read the rest through the getters.
 */
export class SnapshotAcceptance {
  private _generation = 0;
  private _applied: AppliedSnapshotState = { rev: null, capturedAt: null };
  private _serverRev: number | null = null;
  private _hintRev: number | null = null;

  constructor(seed?: SnapshotSeed) {
    this.reset(seed);
  }

  get generation(): number {
    return this._generation;
  }

  get applied(): AppliedSnapshotState {
    return this._applied;
  }

  /** Highest revision we have reason to expect; null when unknown. */
  get wantedRev(): number | null {
    if (this._serverRev === null) return this._hintRev;
    if (this._hintRev === null) return this._serverRev;
    return Math.max(this._serverRev, this._hintRev);
  }

  /** `?minRev=` value to send, or null to omit the parameter. */
  minRevToSend(): number | null {
    return this.wantedRev;
  }

  /**
   * `?minRev=` for a NOTIFICATION-triggered request: one past the
   * applied revision (or `wantedRev`, whichever is higher).
   *
   * Why: in R1 a notification (postgres_changes) carries no revision,
   * but it does mean "a save just committed". The save purges the
   * snapshot cache right after its commit, and the push + jitter can
   * beat that purge to the client — with `minRev = appliedRev` the
   * server would happily serve the still-cached old snapshot, and the
   * page would wait for the next periodic poll (≤ 24 s). Asking for
   * `appliedRev + 1` makes the server's repair path check the real DB
   * revision and rebuild only if the DB is ahead; a wrong guess costs
   * one coalesced 1-row read and never a rebuild.
   *
   * Single-use: the value is NOT stored. It never raises `wantedRev`,
   * so a response that still comes back at `appliedRev` is a normal,
   * healthy response — not a server gap, not a hint gap, no retry, no
   * "delayed" indicator. Null when nothing is applied yet (no basis
   * for a guess; fall back to `wantedRev`).
   */
  notificationMinRev(): number | null {
    const applied = this._applied.rev;
    if (applied === null) return this.wantedRev;
    const next = applied + 1;
    if (!isValidRev(next)) return this.wantedRev;
    return Math.max(this.wantedRev ?? 0, next);
  }


  /**
   * Start a new generation (event or locale changed, or first mount)
   * seeded from SSR. SSR's revision counts as server-observed: the
   * first client fetch must not roll the server-rendered page back.
   * Invalid seeds are ignored (treated as unknown).
   */
  reset(seed?: SnapshotSeed): number {
    this._generation += 1;
    const rev = isValidRev(seed?.rev) ? seed!.rev! : null;
    const capturedAt = rev === null ? null : parseCapturedAt(seed?.capturedAt);
    this._applied = { rev, capturedAt };
    this._serverRev = rev;
    this._hintRev = null;
    return this._generation;
  }

  /**
   * R2 hook: a broadcast announced revision `rev`. Unvalidated input
   * is dropped. Raises `wantedRev`, so the next request carries it as
   * `minRev` and the server's repair path can rebuild a stale cache.
   */
  noteHintRev(rev: unknown): void {
    if (!isValidRev(rev)) return;
    this._hintRev = this._hintRev === null ? rev : Math.max(this._hintRev, rev);
  }

  /**
   * Decide what to do with a parsed response body from generation
   * `generation`, and record it.
   *
   * Compat (v0.18.x responses without `rev`, during a rollout): the
   * spec treats them as `rev = applied.rev ?? 0, capturedAt = now`,
   * which always applies. We apply them and leave the watermark
   * untouched instead of writing `now` into it — `now` is the CLIENT
   * clock, and storing it next to server `capturedAt` values would let
   * a fast client clock reject the next real same-revision snapshot.
   */
  evaluate(
    generation: number,
    body: { rev?: unknown; capturedAt?: unknown },
  ): AcceptanceVerdict {
    if (generation !== this._generation) return { kind: "stale-generation" };

    if (!isValidRev(body.rev)) {
      return {
        kind: "evaluated",
        apply: true,
        version: null,
        serverGap: false,
        hintGap: false,
      };
    }

    const version: SnapshotVersion = {
      rev: body.rev,
      capturedAt: parseCapturedAt(body.capturedAt),
    };
    const serverGap = this._serverRev !== null && version.rev < this._serverRev;
    const hintGap =
      !serverGap && this._hintRev !== null && version.rev < this._hintRev;
    const apply = shouldApply(version, this._applied);

    // Every revision the server returns is server-observed, applied or
    // not (a rejected response is by definition not newer, so this
    // never raises the bar above what was applied — it is a max).
    this._serverRev =
      this._serverRev === null ? version.rev : Math.max(this._serverRev, version.rev);
    if (apply) {
      this._applied = {
        rev: version.rev,
        capturedAt:
          version.capturedAt ??
          (version.rev === this._applied.rev ? this._applied.capturedAt : null),
      };
    }
    // A hint is satisfied once a response at or past it lands.
    if (this._hintRev !== null && version.rev >= this._hintRev) {
      this._hintRev = null;
    }

    return { kind: "evaluated", apply, version, serverGap, hintGap };
  }
}

/** `/api/setlist` URL for one snapshot request. */
export function setlistSnapshotUrl(
  eventId: string,
  locale: string,
  minRev: number | null,
): string {
  const base = `/api/setlist?eventId=${encodeURIComponent(eventId)}&locale=${encodeURIComponent(locale)}`;
  return isValidRev(minRev) ? `${base}&minRev=${minRev}` : base;
}
