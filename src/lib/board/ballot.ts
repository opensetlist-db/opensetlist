import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEventStatus } from "@/lib/eventStatus";
import { seriesPrimaryArtistOf } from "@/lib/board/boardGroups";
import { classifyPreExecutionFailure } from "@/lib/dbErrors";

/**
 * The fan board's ballot write primitives (n15) — the two things every
 * ballot mutation needs before it touches a row:
 *
 *   1. `checkBoardWritable` — the control check, read FRESH from the
 *      database (never the cached control row): the kill switch must
 *      stop writes on the very next request, and the lock is the
 *      event's start time to the second.
 *   2. `withBallotLock` — a transaction holding
 *      `pg_advisory_xact_lock` on (event, anon) for its whole length.
 *
 * Why an advisory lock and not row locks: the cap is "at most N rows per
 * (event, anon, group)", and a first-time anon has no rows to lock — two
 * concurrent first adds would both count 0 and both insert. The advisory
 * key exists before any row does, so every mutation for one ballot
 * serializes on it and the count-then-insert under it is race-free.
 * Ballots of different anons (or of one anon on Day.1 vs Day.2) never
 * contend. The lock is transaction-scoped: it is released by COMMIT or
 * ROLLBACK, so a crashed request can't leave it held.
 *
 * Deliberately small — the board pick routes (n15-03), per-group wishes
 * (n15-08) and the publish bridge (n15-09b) all call these two, each
 * with its own validation inside the callback. It is not a generic
 * ballot framework.
 *
 * Nothing here (or in any caller) may call a cache revalidate helper:
 * every cached read carries the global public-data tag, so a fan write
 * that expired anything would reach the live path. The board aggregate
 * is TTL-only by design.
 */

export type BallotErrorCode =
  | "not_found"
  | "board_disabled"
  | "board_locked";

export interface BoardWriteContext {
  eventId: bigint;
  /** Alive series artist id (single-artist event) or null (festival) —
   *  what `loadBoardGroups` needs to resolve the board's groups. */
  primaryArtistId: bigint | null;
}

export type BoardWritableResult =
  | { ok: true; context: BoardWriteContext }
  | { ok: false; status: 403 | 404; code: BallotErrorCode };

/**
 * Is this event's board accepting ballot writes right now?
 *
 *   - missing / soft-deleted event → 404
 *   - flag off → 403 `board_disabled` (already-open tabs keep posting
 *     after the operator turns the board off; this is what stops them)
 *   - at or after the start time (UTC instant comparison), or a resolved
 *     status other than upcoming (an operator who flipped the stored
 *     status early, a cancelled show) → 403 `board_locked`
 *
 * `now` is injected so the ±1 s boundary is testable.
 */
export async function checkBoardWritable(
  eventId: bigint,
  now: Date = new Date(),
): Promise<BoardWritableResult> {
  const event = await prisma.event.findFirst({
    where: { id: eventId, isDeleted: false },
    select: {
      boardEnabled: true,
      status: true,
      startTime: true,
      eventSeries: {
        select: { artist: { select: { id: true, isDeleted: true } } },
      },
    },
  });
  if (!event) return { ok: false, status: 404, code: "not_found" };
  if (!event.boardEnabled) {
    return { ok: false, status: 403, code: "board_disabled" };
  }
  if (
    now.getTime() >= event.startTime.getTime() ||
    getEventStatus(event, now) !== "upcoming"
  ) {
    return { ok: false, status: 403, code: "board_locked" };
  }
  const primary = seriesPrimaryArtistOf(event.eventSeries);
  return {
    ok: true,
    context: {
      eventId,
      primaryArtistId: primary ? BigInt(primary.id) : null,
    },
  };
}

/**
 * Pool limits for a ballot transaction. `maxWait` matches the pool's
 * 5 s connect timeout (`src/lib/prisma.ts`): a fan add is not a live
 * writer and can afford to queue behind a burst on the same instance
 * (the pool holds 2 connections), but it must still fail into the 503
 * below rather than ride the 30 s global transaction backstop. A ballot
 * transaction is three or four statements; 8 s is only reached when
 * something is wrong.
 */
export const BALLOT_TX_MAX_WAIT_MS = 5_000;
export const BALLOT_TX_TIMEOUT_MS = 8_000;

/**
 * Run `fn` in one transaction that first takes the (event, anon)
 * advisory lock. Everything that reads the ballot to decide (count,
 * existing row, ownership) must happen inside `fn`, after the lock.
 *
 * The key is a 64-bit hash of a namespaced string, so it can't collide
 * with an advisory lock some other feature keys on a bare id. A hash
 * collision between two ballots would only make them serialize, never
 * corrupt either.
 */
export function withBallotLock<T>(
  eventId: bigint,
  anonId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const key = `board-ballot:${eventId.toString()}:${anonId}`;
  return prisma.$transaction(
    async (tx) => {
      // `$executeRaw`, not `$queryRaw`: the function returns `void`,
      // which the query path can't deserialize.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      return fn(tx);
    },
    { maxWait: BALLOT_TX_MAX_WAIT_MS, timeout: BALLOT_TX_TIMEOUT_MS },
  );
}

/** Thrown inside a `withBallotLock` callback to roll back and answer
 *  with a contract status (see `ballotErrorResponse`). */
export class BallotError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    readonly code: string,
  ) {
    super(code);
    this.name = "BallotError";
  }
}

export const BALLOT_NO_STORE = { "Cache-Control": "no-store" } as const;

export function ballotJson(
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = BALLOT_NO_STORE,
): NextResponse {
  return NextResponse.json(body, { status, headers });
}

/**
 * Map a failure out of a ballot write to a response. `BallotError` →
 * its contract status; a pool / pooler failure before the transaction
 * started → 503 + Retry-After (nothing was written, retrying is safe);
 * anything else is rethrown (a genuine 500).
 */
export function ballotErrorResponse(err: unknown): NextResponse {
  if (err instanceof BallotError) {
    return ballotJson(err.status, { error: err.code });
  }
  if (classifyPreExecutionFailure(err)) {
    return ballotJson(
      503,
      { error: "busy" },
      { ...BALLOT_NO_STORE, "Retry-After": "2" },
    );
  }
  throw err;
}
