import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Per-lambda pool cap pinned to the actual peak concurrent DB-touching
// query count on user-facing pages. The heaviest user route is the
// event detail page, whose render-time Promise.all fans out to 3
// connections (1 for getReactionCounts + 2 internal to
// getEventImpressions's own findMany/count Promise.all). All other
// user-facing routes peak at ≤ 2. Without `max` set, pg defaults to
// 10, which combined with Supabase free-tier's 200-client ceiling on
// PgBouncer means EMAXCONN fires at just 20 concurrent warm Vercel
// lambdas — observed at the Day-1 launch ramp (2026-05-01, T+5 and
// T+11 minutes). Pinning to 3 aligns the per-lambda budget to the
// real peak (zero latency penalty on user pages) and raises the
// ceiling to ~66 concurrent lambdas before saturation.
//
// Admin dashboard fans to 8 count() queries via Promise.all
// (`src/app/admin/page.tsx`); under max: 3 the surplus queue and add
// ~80 ms to render. Acceptable — admin is operator-only and never
// runs during a live show audience window.
//
// idleTimeoutMillis: connections released after 20s idle so warm
// lambdas don't hold slots during quiet stretches.
// connectionTimeoutMillis: fail fast if the pool is contended,
// rather than holding the request open indefinitely.
//
// See wiki/launch-day-retros.md#F14 for the full retro context.
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
  max: 3,
  idleTimeoutMillis: 20_000,
  connectionTimeoutMillis: 10_000,
});

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}