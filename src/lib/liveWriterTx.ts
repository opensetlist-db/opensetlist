import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { INSTANCE_ID } from "@/lib/instanceId";
import { scheduleWarm, type WarmFault } from "@/lib/liveWarm";
import {
  classifyPreExecutionFailure,
  describeError,
  type PreExecutionFailure,
} from "@/lib/dbErrors";

/**
 * The transaction wrapper for the live setlist writers (the routes that
 * call `bumpSetlistRevisionAndBroadcast` while a show is running):
 * explicit limits, timing, and an honest answer when the database is
 * too busy to even start the save.
 *
 * Limits. `maxWait` 2 s (pool acquisition) and `timeout` 8 s (the whole
 * interactive transaction) are passed explicitly instead of relying on
 * the client defaults: `transactionOptions.timeout` is raised to 30 s
 * globally for the off-peak CSV import (`src/lib/prisma.ts`), and a live
 * save that hangs for 30 s has long since been given up on by the
 * operator — who then saves again while the first attempt may still
 * commit. Failing well inside the operator's patience keeps "the save
 * failed" and "the save happened" distinguishable. A normal save is a
 * handful of statements and finishes in tens of ms; 8 s is only ever
 * reached when something is wrong. `maxWait` stays below the pool's 5 s
 * connect timeout so a contended save fails into the 503 below first.
 *
 * Timing, logged once per transaction:
 *   `[liveWriter] route=<tag> acquireMs=<n> execMs=<n> rev=<n|-> ok=<bool> at=<ms> instance=<id>`
 *   - acquireMs: `$transaction` call → the callback being entered. Prisma
 *     enters the callback after it obtained a pool connection and ran
 *     BEGIN, so this is pool acquisition (+ one BEGIN round trip). It is
 *     measured at callback entry rather than at the return of the
 *     writers' first statement (`lockEvent`) on purpose: a save that
 *     waits on a concurrent same-event save's row lock is executing, not
 *     acquiring, and that wait belongs in execMs.
 *   - execMs: callback entry → commit (or failure); 0 when the callback
 *     was never entered.
 *   - rev: the revision this save produced, read from the transaction's
 *     result by the caller's `revOf`, or `-` when nothing bumped
 *     (validation failure, no-op, rollback). The route hands it over
 *     explicitly rather than `bumpSetlistRevisionAndBroadcast` recording
 *     it as a side effect: `liveBroadcast.ts` stays free of server-only
 *     imports (pg, async_hooks), so its topic/event constants remain
 *     importable from anywhere.
 *   - at: `Date.now()` epoch ms when `$transaction` settled (resolved =
 *     committed, or rejected). Explicit because Vercel's history-mode
 *     logs stamp every line of a request with the request's START time,
 *     which for a save that waited on a lock or the pool is not when it
 *     committed; the overlap drills order commits against warm jobs
 *     (`[liveWarm] … at=`) by this field.
 * Failures additionally log
 *   `[liveWriter] failed route=<tag> kind=<pre-execution kind|other> err=<class>:<msg> instance=<id>`.
 *
 * No automatic retry, here or in the routes. A failure after the
 * transaction started is ambiguous from the client's side of the wire —
 * a lost COMMIT acknowledgement looks exactly like a failed COMMIT — and
 * re-running an insert-shaped save (create, insert-after, a confirm)
 * after a commit that actually landed would duplicate it. Only the
 * caller (the operator, the fan) can decide to save again; the 503 for
 * pre-execution failures tells them it is safe to.
 */

export const LIVE_WRITER_MAX_WAIT_MS = 2_000;
export const LIVE_WRITER_TIMEOUT_MS = 8_000;
export const LIVE_WRITER_RETRY_AFTER_SECONDS = 2;

/** Korean-only: admin routes are operator surfaces (see CLAUDE.md). */
export const ADMIN_DB_BUSY_MESSAGE =
  "데이터베이스 연결이 혼잡합니다. 잠시 후 다시 저장해 주세요.";

/**
 * The save never started: no connection could be obtained (pool slot,
 * pooler cap, or Prisma's `maxWait`), and the transaction callback never
 * ran. Retrying cannot duplicate anything.
 */
export class LiveWriterBusyError extends Error {
  constructor(
    readonly kind: PreExecutionFailure,
    readonly route: string,
    cause: unknown,
  ) {
    super(
      `live writer ${route}: database busy before the transaction started (${kind})`,
      { cause },
    );
    this.name = "LiveWriterBusyError";
  }
}

// Errors thrown after a writer's callback was entered. A connection-level
// error cannot really arise there (the transaction owns its connection),
// but if one ever did, the work may have run — so it must never be
// mistaken for a pre-execution failure by `liveWriterBusyResponse`.
const executedFailures = new WeakSet<object>();

/**
 * Run one live writer's save. `route` is the log tag (stable, e.g.
 * `admin-create`); `eventId` is the event the save locks and bumps;
 * `revOf` reads the produced revision out of the transaction's result
 * (omit when the result is the revision itself or carries none).
 *
 * After a COMMITTED save that produced a revision, the flagged writer
 * warming job is registered here (`scheduleWarm`, a no-op unless
 * `LIVE_WARM_ENTRIES=1`) — in this one place so every live writer gets
 * it and none can forget it. It is reached only on the success path: a
 * transaction that threw (rolled back, never started, or failed to
 * commit) leaves through the `catch` below and never warms, and a save
 * that changed nothing (`rev` null) has no new revision to warm. The
 * CSV import route does not use this wrapper and so never warms (an
 * off-peak bulk replace, not a live save).
 *
 * `opts.warmFault`: a drill fault for THIS save's warm job, parsed and
 * validated by the calling ADMIN route (`requestWarmFault`, after its
 * auth check and before this transaction) and handed through by value
 * to `scheduleWarm`. This wrapper never reads request headers itself:
 * the public writers use it too, and they must have no way to select a
 * fault. Omitted (every public writer, every unarmed admin save) = null
 * = the job uses the env fault, if any.
 */
export async function liveWriterTransaction<T>(
  route: string,
  eventId: bigint,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  revOf: (result: T) => bigint | null | undefined = (r) =>
    typeof r === "bigint" ? r : null,
  opts?: { warmFault?: WarmFault | null },
): Promise<T> {
  const t = {
    called: Date.now(),
    entered: null as number | null,
    settled: null as number | null,
  };
  let rev: bigint | null = null;
  let ok = false;
  let result: T;
  try {
    result = await prisma.$transaction(
      (tx) => {
        t.entered = Date.now();
        return fn(tx);
      },
      { maxWait: LIVE_WRITER_MAX_WAIT_MS, timeout: LIVE_WRITER_TIMEOUT_MS },
    );
    t.settled = Date.now();
    ok = true;
    rev = revOf(result) ?? null;
  } catch (err) {
    t.settled ??= Date.now();
    const kind =
      t.entered === null ? classifyPreExecutionFailure(err) : null;
    if (t.entered !== null && err !== null && typeof err === "object") {
      executedFailures.add(err);
    }
    console.log(
      `[liveWriter] failed route=${route} kind=${kind ?? "other"} ` +
        `err=${describeError(err)} instance=${INSTANCE_ID}`,
    );
    if (kind) throw new LiveWriterBusyError(kind, route, err);
    throw err;
  } finally {
    // `settled` is always set by now (success path or catch); the
    // fallback only satisfies the type.
    const end = t.settled ?? Date.now();
    const acquireMs = (t.entered ?? end) - t.called;
    const execMs = t.entered === null ? 0 : end - t.entered;
    console.log(
      `[liveWriter] route=${route} acquireMs=${acquireMs} execMs=${execMs} ` +
        `rev=${rev ?? "-"} ok=${ok} at=${end} instance=${INSTANCE_ID}`,
    );
  }
  // Only reached when the transaction resolved (the catch rethrows).
  // After the `[liveWriter]` line, so the harness's commit timestamp
  // precedes the job's `[liveWarm] start`. `scheduleWarm` never throws.
  if (rev !== null) scheduleWarm(eventId, rev, opts?.warmFault ?? null);
  return result;
}

/**
 * Whether `err` means "the database could not be reached for this
 * request, nothing ran": a `LiveWriterBusyError` from
 * `liveWriterTransaction`, or a raw pool-acquire timeout / pooler-cap
 * rejection from a plain (non-transactional) statement — such as a
 * writer's pre-transaction lookup — which by construction never reached
 * the database. Prisma's P2028 is only trusted through
 * `liveWriterTransaction`, which knows whether the callback ran.
 */
function isPreExecutionBusy(err: unknown): boolean {
  if (err instanceof LiveWriterBusyError) return true;
  if (err !== null && typeof err === "object" && executedFailures.has(err)) {
    return false;
  }
  const kind = classifyPreExecutionFailure(err);
  return kind === "pool_acquire_timeout" || kind === "pooler_cap";
}

/**
 * 503 + `Retry-After: 2` for a pre-execution failure, or null for any
 * other error (the route keeps its existing handling).
 *
 *   admin  → `{ error: <Korean operator message>, code: "db_busy" }` —
 *            the admin UI alerts `error` as is.
 *   public → `{ ok: false, error: "db_busy" }` — a stable code only, no
 *            text: public responses stay i18n-neutral and the client
 *            maps the code to its own localized message.
 */
export function liveWriterBusyResponse(
  err: unknown,
  audience: "admin" | "public",
): NextResponse | null {
  if (!isPreExecutionBusy(err)) return null;
  const init = {
    status: 503,
    headers: {
      "Retry-After": String(LIVE_WRITER_RETRY_AFTER_SECONDS),
      "Cache-Control": "no-store",
    },
  };
  return audience === "admin"
    ? NextResponse.json({ error: ADMIN_DB_BUSY_MESSAGE, code: "db_busy" }, init)
    : NextResponse.json({ ok: false, error: "db_busy" }, init);
}

/**
 * Run the body of an admin live-writer handler so a pre-execution
 * database failure anywhere in it (its pre-transaction lookup or the
 * transaction itself) answers 503 instead of an unhandled 500. Every
 * other error propagates unchanged.
 *
 * Called from inside the exported handler, AFTER its
 * `verifyAdminAPI()` guard — the handlers stay plain
 * `export async function` declarations whose first statement is the
 * auth check, which `admin-api-auth-coverage.test.ts` enforces.
 */
export async function withAdminLiveWriterBusy<R extends Response>(
  run: () => Promise<R>,
): Promise<R | NextResponse> {
  try {
    return await run();
  } catch (err) {
    const busy = liveWriterBusyResponse(err, "admin");
    if (busy) return busy;
    throw err;
  }
}
