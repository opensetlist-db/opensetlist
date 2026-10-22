import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// Run the unit suite in a non-UTC zone so a stored UTC date formatted
// without `timeZone: "UTC"` fails here instead of only on a developer
// machine. Vercel and CI run in UTC, where that bug is invisible. Set
// before any test worker starts: forked workers inherit it at spawn,
// so it is in place before the first Date is created. A UTC-negative
// zone is chosen because a stored UTC midnight then falls on the
// previous local day — the exact drift this guards against.
// tz-pin.test.ts is the positive control that proves it took effect.
process.env.TZ = "America/Los_Angeles";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Dev-DB integration suites run separately (`npm run test:integration`,
    // vitest.integration.config.ts) — they need DB credentials and write rows.
    exclude: [...configDefaults.exclude, "src/__tests__/integration/**"],
    coverage: {
      reporter: ["text", "html"],
      exclude: ["src/generated/**", "src/test/**", "**/*.config.*"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
