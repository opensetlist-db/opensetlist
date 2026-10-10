import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { INSTANCE_ID } from "@/lib/instanceId";
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
 *   `[liveWriter] route=<tag> acquireMs=<n> execMs=<n> rev=<n|-> ok=<bool> instance=<id>`
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
 * `admin-create`); `revOf` reads the produced revision out of the
 * transaction's result for the log line (omit when the result is the
 * revision itself or carries none).
 */
export async function liveWriterTransaction<T>(
  route: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  revOf: (result: T) => bigint | null | undefined = (r) =>
    typeof r === "bigint" ? r : null,
): Promise<T> {
  const t = { called: Date.now(), entered: null as number | null };
  let rev: bigint | null = null;
  let ok = false;
  try {
    const result = await prisma.$transaction(
      (tx) => {
        t.entered = Date.now();
        return fn(tx);
      },
      { maxWait: LIVE_WRITER_MAX_WAIT_MS, timeout: LIVE_WRITER_TIMEOUT_MS },
    );
    ok = true;
    rev = revOf(result) ?? null;
    return result;
  } catch (err) {
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
    const end = Date.now();
    const acquireMs = (t.entered ?? end) - t.called;
    const execMs = t.entered === null ? 0 : end - t.entered;
    console.log(
      `[liveWriter] route=${route} acquireMs=${acquireMs} execMs=${execMs} ` +
        `rev=${rev ?? "-"} ok=${ok} instance=${INSTANCE_ID}`,
    );
  }
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
