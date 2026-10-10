import { Pool } from "pg";
import { attachDatabasePool } from "@vercel/functions/db-connections";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { INSTANCE_ID } from "@/lib/instanceId";

// ---------------------------------------------------------------------
// Pool sizing — why 2 connections, 5 s idle, 5 s connect timeout
//
// The binding constraint is NOT per-instance throughput, it is the
// Supavisor pooler's client-connection cap (200 on Supabase Micro, 400
// on Small), summed over every warm function instance. Vercel Fluid
// spreads a burst over many instances: when a setlist save expires the
// live snapshot's cache tag, ~500 viewers refetch `/api/setlist` within
// the 500 ms jitter window and land on ~140 instances, each of which
// misses its cache and opens connections at the same moment. With the
// previous `max: 5` and 20 s idle, instances × pool blew through 200 and
// the pooler answered `(EMAXCONN) max client connections reached`,
// which surfaced as HTTP 500 on the API and on SSR. The fix is to make
// each instance frugal:
//
// max: 2 — the live snapshot coalesces concurrent misses per instance
//   (`src/lib/liveSnapshot.ts`), and one build is ONE interactive
//   transaction on ONE connection, so a live burst needs one
//   connection per concurrent locale build on that instance, not one
//   per request. 2 leaves room for a second locale or a concurrent
//   writer/repair read while capping the worst case. It does not make
//   the arithmetic a guarantee (140 × 2 still exceeds 200); it makes
//   the typical instance hold one client, and the rest fail fast (see
//   connectionTimeoutMillis) into a 503 + Retry-After instead of an
//   EMAXCONN 500. Vercel's guidance is to avoid `max: 1` under Fluid
//   (it serializes every request on the instance without reducing the
//   total), so 2 is the floor.
//   Consequence: any render that fans out with Promise.all now QUEUES
//   two at a time instead of running in parallel — the event page SSR
//   (reaction counts + impressions findMany/count, 3 queries) and the
//   admin dashboard (`src/app/admin/page.tsx`, 8 count() queries, ~4
//   sequential rounds). Each of those queries is a few ms in-region,
//   so the cost is tens of ms on pages that are not the live hot
//   path; the admin dashboard is operator-only. `/api/setlist` itself
//   no longer fans out: the snapshot reads everything in one
//   transaction on one connection.
//
// idleTimeoutMillis: 5_000 — how long an idle client stays open. Under
//   Fluid, idle timers do not run while an instance is suspended, so an
//   idle client would otherwise stay open (and keep counting against
//   the pooler cap) until the VM is torn down. `attachDatabasePool`
//   (below) hooks the pool's `release` event and keeps the instance
//   alive for idleTimeoutMillis + 100 ms after the last release
//   (`waitUntil`), so the idle timer actually fires and closes the
//   client before suspension. It does not close anything itself — the
//   idle timeout IS the release time, so shorter means pooler clients
//   are returned sooner after a burst (5 s vs. the previous 20 s, so
//   back-to-back bursts no longer stack on still-open clients). Cost: a
//   reconnect (TCP + TLS + pooler auth, tens of ms in-region) after 5 s
//   of quiet on an instance.
//
// connectionTimeoutMillis: 5_000 — how long a query waits for a pool
//   slot (or a new pooler connection) before failing with
//   `timeout exceeded when trying to connect`. With only 2 slots, a
//   request that queues for 10 s (the previous value) is worse for the
//   live path than a fast failure: the snapshot route turns it into a
//   503 with a randomized Retry-After so the retry wave spreads out and
//   most likely lands on a filled cache, and the live writers turn it
//   into a 503 the operator can re-save from. Transactions bound their
//   own wait below this with `maxWait` (live writers 2 s, see
//   `src/lib/liveWriterTx.ts`; snapshot builds 5 s).
//
// The pool is created here rather than by the adapter from a config
// object because (a) `attachDatabasePool` needs the pool instance and
// (b) `poolStats` reads its counters; `PrismaPg` accepts a `pg.Pool`
// directly but does not expose the pool it creates internally.
// ---------------------------------------------------------------------

function createPool(): Pool {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL!,
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
  });
  // Off Vercel this only registers a `release` listener whose handler
  // returns early (it needs VERCEL_URL + VERCEL_REGION), so it is safe
  // in local dev, tests and scripts — verified in
  // node_modules/@vercel/functions/db-connections/index.js.
  attachDatabasePool(pool);
  return pool;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaPool: Pool | undefined;
};

const pool = globalForPrisma.prismaPool ?? createPool();

const adapter = new PrismaPg(pool);

// Tripwire: PrismaPg recognizes an external pool with
// `instanceof pg.Pool` against ITS copy of `pg`. If a bundling change
// ever gave the adapter a different copy, it would silently treat our
// Pool object as a plain config and build its own default pool
// (max 10, no idle hook) — exactly the pooler-cap failure this file
// exists to prevent. Next externalizes `pg` (server-external-packages),
// so today both sides load the same module. The field is private, so
// only complain when it is present and wrong.
const externalPool = (adapter as unknown as { externalPool?: unknown })
  .externalPool;
if (externalPool !== undefined && externalPool !== pool) {
  console.error(
    "[prisma] PrismaPg did not adopt the shared pg.Pool — pool limits are NOT in effect",
  );
}

/** Live pool counters for this instance (pg's own bookkeeping). */
export function poolStats(): { total: number; idle: number; waiting: number } {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

/**
 * One diagnostic line with this instance's pool counters. The load-test
 * log summariser parses the `[prisma] pool ` prefix and these exact key
 * names to estimate pooler clients (sum of `total` per instance at the
 * same moment) — keep the format stable.
 */
export function logPoolStats(tag: string): void {
  const s = poolStats();
  console.log(
    `[prisma] pool total=${s.total} idle=${s.idle} waiting=${s.waiting} ` +
      `instance=${INSTANCE_ID} tag=${tag}`,
  );
}

// `transactionOptions.timeout` raised 5 s → 30 s as a global backstop for
// the setlist re-import (`/api/admin/import`), whose atomic per-event
// replace runs 200+ statements for a full-roster event and crossed the
// 5 s default against the prod pooler. The import also passes the same
// timeout per-call on its interactive `$transaction`, but with the
// PrismaPg driver adapter the per-call option was observed to be ignored
// on the array/batch form (v0.15.3 set it and the engine still reported
// "timeout ... was 5000 ms"); setting it at the client level guarantees
// the ceiling applies regardless of which path honors the per-call value.
// Only `timeout` is raised globally — `maxWait` (pool-acquire wait) stays
// at its 2 s default so live-traffic transactions still fail fast under
// pool contention rather than holding a request open; the import overrides
// `maxWait` per-call on its own off-peak interactive transaction. The live
// writers pass their own, much shorter limits (`src/lib/liveWriterTx.ts`)
// so a save fails before the operator gives up on it, rather than riding
// this 30 s backstop.
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ adapter, transactionOptions: { timeout: 30_000 } });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaPool = pool;
}
