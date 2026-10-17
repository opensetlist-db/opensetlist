import { defineConfig } from "vitest/config";
import path from "path";

// Integration tests against the DEV Supabase database (n14 live path:
// row locks, revision bumps, realtime.send, REPEATABLE READ snapshots).
// Run with `npm run test:integration`; they need `.env` / `.env.local`
// pointing at the dev project and are excluded from the default unit
// run (`vitest.config.ts`). Each suite creates and removes its own
// throwaway rows.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/__tests__/integration/**/*.test.ts"],
    setupFiles: ["./src/__tests__/integration/setup.ts"],
    // Network round-trips to the Seoul pooler; the suites use explicit
    // barriers, these are only safety nets.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // One file at a time: the suites share the dev database and the
    // per-process Prisma pool.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
