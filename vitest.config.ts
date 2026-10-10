import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

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
