import type { EventEmitter } from "node:events";
import type { Pool, PoolClient } from "pg";

/** Prefix of the line logged each time the guard below fires. */
export const OPEN_TX_RELEASE_LOG_PREFIX =
  "[pgPool] client released inside a transaction";

// ---------------------------------------------------------------------
// Open-transaction guard — a pooled client must never be handed out
// while it is still inside a transaction.
//
// Why this exists. With the PrismaPg driver adapter, Prisma's
// transaction manager sends COMMIT / ROLLBACK itself and then calls the
// adapter's `commit()` / `rollback()`, which for pg ONLY release the
// client to the pool (`@prisma/adapter-pg` PgTransaction.rollback). One
// path skips the SQL: when `$transaction(fn, { maxWait })` gives up
// before the pool produced a connection, the manager later calls
// `rollback()` directly on the transaction that arrives late (Prisma
// client ≤ 7.8, transaction-manager.ts, the `abortController.signal.aborted`
// branch — fixed upstream, see "Upstream status" below). That client has already run `BEGIN` (and `SET TRANSACTION
// ISOLATION LEVEL` if one was asked for) and goes back to the pool with
// the transaction open. From then on:
//   - every "auto-commit" query that lands on it runs inside that
//     leftover transaction, and its effects commit — or are rolled back —
//     only when some later transaction on the same client ends;
//   - the next REPEATABLE READ snapshot build on it fails with
//     `SET TRANSACTION ISOLATION LEVEL must be called before any query`
//     (its BEGIN only warns), which the live route answers with a 503.
// Under live overload `maxWait` give-ups are exactly what happens, so
// this is not a theoretical path.
//
// Upstream status. Prisma fixed this exact path in @prisma/client 7.9.0
// (prisma/prisma#29727): `#discardStartedTransaction` now sends an
// explicit `ROLLBACK` on the late transaction before calling the
// adapter's `rollback()` (adapters without phantom queries, which
// includes pg). We run 7.10.0; on it the reproduction in
// `src/__tests__/integration/prisma-pool-txleak.test.ts` comes back with a
// clean connection while the guard stays silent, i.e. Prisma's own
// ROLLBACK did the cleaning (the test itself accepts 0 or 1 firings so it
// passes on either side of the fix). The guard stays anyway, as
// a backstop for any OTHER way a client could be released inside a
// transaction — a future Prisma or adapter regression, a cleanup path
// whose ROLLBACK fails while the adapter still releases the client
// (7.10's discard path releases in a `finally`), or any future direct
// use of the shared pool. It costs nothing on a normal release
// (status 'I').
//
// How it is detected. Every ReadyForQuery message from the server
// carries the backend's transaction status: 'I' idle, 'T' in a
// transaction, 'E' in a failed transaction. pg's Client does not keep
// that byte, but its `connection` (public, typed in @types/pg) emits
// each parsed message, so one listener per client records it. At
// release time the latest status is therefore known with no extra round
// trip — a `SELECT 1`-style probe per release would tax every query on
// the hot path to catch a rare event.
//
// What it does. pg-pool emits `release` synchronously, BEFORE it parks
// the client as idle or hands it to the next waiter. A `ROLLBACK`
// queued on the client from inside that listener is therefore ahead of
// anything the next borrower sends (a pg Client runs its queries
// strictly in order), so the next borrower always starts on a clean
// connection.
//
// Why ROLLBACK and not destroy. The documented way to destroy a client
// is `client.release(err)`, but the release call here belongs to the
// adapter, not to us, and the `release` event cannot change its
// argument; forcing `client.end()` from inside the event would race
// pg-pool's own `_remove` → `end()` on the same client. A ROLLBACK keeps
// the connection warm, which matters because the guard fires precisely
// when the instance is short of connections (a reconnect would add
// TCP + TLS + pooler auth and one more pooler client at the worst
// moment). The cost — one ROLLBACK round trip borne by the next borrower
// — is paid only on the rare leak, never on a normal release (Prisma has
// already sent COMMIT/ROLLBACK, so the status is 'I').
//
// Limits.
//   - A release with an error is skipped: pg-pool destroys that client
//     anyway (and closing the connection ends the transaction server-side).
//   - The status is the one from the client's LAST ReadyForQuery. A
//     release while a query is still in flight would read a stale value;
//     nothing in our stack (Prisma or pool.query) releases mid-query.
//   - If the ROLLBACK itself fails, the connection is broken; pg-pool's
//     idle error handling removes it, and the failure is logged.
//   - A redundant ROLLBACK (stale 'T' because the client was released
//     again before running anything) only draws a server WARNING.
// ---------------------------------------------------------------------

type TxStatus = string; // 'I' | 'T' | 'E' as sent by the server

// Keyed by client object, so entries go away with the client.
const lastTxStatus = new WeakMap<object, TxStatus>();

type Log = (line: string) => void;

export function installOpenTransactionGuard(
  pool: Pool,
  log: Log = (line) => console.warn(line),
): void {
  let warnedNoConnection = false;

  // `connect` fires once per NEW physical client, before its first
  // checkout. Its startup ReadyForQuery has already arrived (status 'I'),
  // so "no entry yet" means idle.
  pool.on("connect", (client: PoolClient) => {
    const connection = (client as unknown as { connection?: EventEmitter })
      .connection;
    if (!connection || typeof connection.on !== "function") {
      // A pg upgrade that stopped exposing `connection` would silently
      // disable the guard; say so once instead of failing the pool.
      if (!warnedNoConnection) {
        warnedNoConnection = true;
        log(
          "[pgPool] pg Client has no `connection` emitter — open-transaction guard disabled",
        );
      }
      return;
    }
    connection.on("readyForQuery", (msg: { status?: TxStatus }) => {
      if (typeof msg?.status === "string") lastTxStatus.set(client, msg.status);
    });
  });

  pool.on("release", (err: Error | undefined, client: PoolClient) => {
    if (err) return;
    const status = lastTxStatus.get(client);
    if (status !== "T" && status !== "E") return;
    log(`${OPEN_TX_RELEASE_LOG_PREFIX} (status=${status}); rolling back before reuse`);
    client.query("ROLLBACK").catch((e: unknown) => {
      log(
        `[pgPool] guard ROLLBACK failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    });
  });
}
