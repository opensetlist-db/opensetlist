import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Per-lambda pool cap pinned to the actual peak concurrent DB-touching
// query count on user-facing pages. Originally calibrated to 3 against
// the event detail page (`/[locale]/events/[id]` — render-time
// Promise.all fans out to 3 connections: getReactionCounts + 2 internal
// to getEventImpressions's own findMany/count Promise.all). Without
// `max` set, pg defaults to 10, which combined with Supabase free-tier's
// 200-client ceiling on PgBouncer means EMAXCONN fires at just 20
// concurrent warm Vercel lambdas — observed at the Day-1 launch ramp
// (2026-05-01, T+5 and T+11 minutes). See wiki/launch-day-retros.md#F14.
//
// Raised 3 → 5 (2026-05-21) after Sentry flagged a false-positive N+1
// on `GET /api/setlist`. The route's render-time Promise.all
// (`src/app/api/setlist/route.ts`) fans out to **4** concurrent
// connections — setlistItem.findMany + setlistItemReaction.groupBy +
// fetchEventWishlistTop3's first groupBy + event.findFirst — which
// under max: 3 left the cheapest query (Event.findFirst on a primary
// key) queueing ~1.08 s waiting for a connection slot (Sentry trace
// 9dc342f6b276465c8ebbb1964ac8ae70 measured a 1084 ms span for a
// SELECT-3-columns PK lookup). The polled endpoint runs every few
// seconds during live shows; that 1 s tax compounded across every
// audience client. max: 5 gives one slot of headroom over the
// observed peak so a future +1 fan-out doesn't silently re-introduce
// the queue wait. Concurrent-warm-lambda ceiling drops from ~66 to
// ~40 (still well above current traffic and the projected Phase 2
// audience peak; revisit if we see EMAXCONN again).
//
// Admin dashboard fans to 8 count() queries via Promise.all
// (`src/app/admin/page.tsx`); under max: 5 the surplus queue and add
// ~50 ms to render. Acceptable — admin is operator-only and never
// runs during a live show audience window.
//
// idleTimeoutMillis: connections released after 20s idle so warm
// lambdas don't hold slots during quiet stretches.
// connectionTimeoutMillis: fail fast if the pool is contended,
// rather than holding the request open indefinitely.
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
  max: 5,
  idleTimeoutMillis: 20_000,
  connectionTimeoutMillis: 10_000,
});

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient;
};

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
// `maxWait` per-call on its own off-peak interactive transaction. 30 s
// only ever matters for a transaction that would otherwise run past 5 s —
// every hot-path transaction finishes well under that, so this is a no-op
// for them.
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ adapter, transactionOptions: { timeout: 30_000 } });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}