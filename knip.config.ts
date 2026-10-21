import type { KnipConfig } from "knip";

// Dead-code report (`npm run lint:dead`): files nothing imports, and
// exports/types nothing uses. A component that is imported nowhere still
// typechecks, lints and reads as live, so only a reachability pass from
// the real entry points shows it is dead.
//
// Knip's Next.js, Vitest, Playwright, ESLint and Prisma plugins add their
// own entries (app/ route files, *.test.ts, tests/e2e specs, configs);
// the list below covers what those plugins do not know about.
const config: KnipConfig = {
  entry: [
    "src/instrumentation*.ts",
    "sentry.*.config.ts",
    // Operator-run scripts: each top-level file is invoked directly
    // (node / tsx / npm script), so each is an entry.
    "scripts/*.{mjs,ts}",
    "scripts/admin-qa/scenarios/*.mjs",
    "scripts/translation-bakeoff/run.ts",
  ],
  project: [
    // .css so CSS-module imports are followed (and an unused module
    // shows up as an unused file).
    "src/**/*.{ts,tsx,css}",
    "scripts/**/*.{mjs,ts}",
    "tests/e2e/**/*.ts",
    "eslint-rules/**/*.mjs",
    // The Prisma plugin reads the schema's generator block.
    "prisma/*.prisma",
  ],
  // The plugin reads only the default config file; the integration
  // suite's config is the one that names globalSetup.ts.
  vitest: {
    config: ["vitest.config.ts", "vitest.integration.config.ts"],
  },
  // tests/load/ is left out of `project`: dozens of k6 and node scripts,
  // each its own entry point run by hand, with no importer to check.
};

export default config;
