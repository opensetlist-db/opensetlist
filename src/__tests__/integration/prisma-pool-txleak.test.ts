import { describe, it, expect, vi, afterAll, beforeEach } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { prisma, poolStats } from "@/lib/prisma";
import { OPEN_TX_RELEASE_LOG_PREFIX } from "@/lib/pgPool";

// A `$transaction` that gives up on `maxWait` must not leave an open
// transaction behind on the pooled connection it eventually gets.
//
// The leak (Prisma client 7.7/7.8 with @prisma/adapter-pg): when the
// start timer fires first, the transaction manager detaches and later
// calls the adapter's `rollback()` on the transaction that arrives late.
// For pg that method only releases the client — the ROLLBACK statement
// is normally sent by the manager itself just before it — so the client
// goes back to the pool after `BEGIN` (+ `SET TRANSACTION ISOLATION
// LEVEL`) with the transaction still open. Every later "auto-commit"
// query on that client then runs inside the leftover transaction (and
// commits or rolls back only when some later transaction on the client
// does), and the next REPEATABLE READ snapshot build fails with
// `SET TRANSACTION ISOLATION LEVEL must be called before any query`.
//
// `src/lib/pgPool.ts` installs a pool-level guard that rolls such a
// client back before it can be handed out again. This suite drives the
// real give-up path against the dev database and checks the connection
// that comes back is clean. It shares nothing with the n14 suite except
// the dev database; it creates no rows.

// The guard logs one line each time it fires; step 6 checks it never
// fires for a normally closed transaction.
const warn = vi.spyOn(console, "warn");

// The spy is installed at module load and restored once at the end, so
// without this a second test in this file would see the first test's
// guard lines in its own `guardLines.length` assertion.
beforeEach(() => {
  warn.mockClear();
});

afterAll(async () => {
  warn.mockRestore();
  await prisma.$disconnect();
});

function barrier() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

// Wait for a pool condition. pg-pool exposes no event for "the late
// connection was released", so this polls the pool's own counters (a
// condition, not a fixed sleep), bounded well inside the test timeout.
async function until(cond: () => boolean, what: string, ms = 10_000) {
  const started = Date.now();
  while (!cond()) {
    if (Date.now() - started > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("pool hygiene after a maxWait give-up", () => {
  it("the late connection comes back with no open transaction", async () => {
    // 1. Occupy both of the instance's pool slots (max 2) with open
    //    transactions.
    const release = barrier();
    const held = [barrier(), barrier()];
    const holders = held.map((h) =>
      prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1`;
          h.open();
          await release.opened;
        },
        { maxWait: 5_000, timeout: 30_000 },
      ),
    );
    await Promise.all(held.map((h) => h.opened));

    // 2. A third transaction — default isolation, like a live writer —
    //    gives up after 500 ms. Its pool request stays queued (the pool's
    //    own connect timeout is 5 s) and is served as soon as a holder
    //    lets go.
    const late = prisma.$transaction(async (tx) => tx.$queryRaw`SELECT 1`, {
      maxWait: 500,
      timeout: 5_000,
    });
    await expect(late).rejects.toThrow(/Unable to start a transaction in the given time/);
    expect(poolStats().waiting).toBe(1);

    // 3. Release the holders. The queued request gets a connection, runs
    //    BEGIN, and Prisma discards it.
    release.open();
    await Promise.all(holders);
    await until(() => {
      const s = poolStats();
      return s.waiting === 0 && s.total > 0 && s.idle === s.total;
    }, "the discarded transaction's connection to return to the pool");

    // 4. Auto-commit probes. pg-pool hands out its most recently released
    //    client first, which is the discarded one. Inside a leftover
    //    transaction two separate auto-commit statements share one
    //    transaction id (each one would otherwise get its own).
    const [first] = await prisma.$queryRaw<{ xid: string }[]>`
      SELECT pg_current_xact_id()::text AS xid`;
    const [second] = await prisma.$queryRaw<{ xid: string }[]>`
      SELECT pg_current_xact_id()::text AS xid`;
    console.log(`[txleak] probe xid1=${first.xid} xid2=${second.xid}`);
    expect(second.xid).not.toBe(first.xid);

    // 5. The snapshot builder's shape: a REPEATABLE READ transaction
    //    right after auto-commit traffic. On a poisoned connection its
    //    BEGIN only warns ("already a transaction in progress") and its
    //    `SET TRANSACTION ISOLATION LEVEL` fails ("must be called before
    //    any query") because the leftover READ COMMITTED transaction has
    //    already taken a snapshot. (Postgres only raises that error when
    //    the level actually changes, which is why the discarded
    //    transaction above uses the default level.)
    const iso = await prisma.$transaction(
      async (tx) =>
        tx.$queryRaw<{ iso: string }[]>`
          SELECT current_setting('transaction_isolation') AS iso`,
      {
        maxWait: 5_000,
        timeout: 5_000,
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      },
    );
    expect(iso[0].iso).toBe("repeatable read");

    // 6. The guard fired at most once — for the discarded transaction —
    //    and never for the holders, which Prisma closed normally. On
    //    Prisma client <= 7.8 it fires exactly once (it is what cleans the
    //    connection); from 7.9 Prisma sends the ROLLBACK itself on this
    //    path and the guard stays silent. Either way steps 4-5 are the
    //    real check, and they cannot pass vacuously: `waiting === 1` in
    //    step 2 shows the abandoned request was still queued, and step 3
    //    waits until it was served and handed back.
    const guardLines = warn.mock.calls.filter((c) =>
      String(c[0]).startsWith(OPEN_TX_RELEASE_LOG_PREFIX),
    );
    expect(guardLines.length).toBeLessThanOrEqual(1);
  });
});
