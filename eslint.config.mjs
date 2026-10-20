import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import useClientExports from "./eslint-rules/use-client-exports.mjs";
import noTicketIds from "./eslint-rules/no-ticket-ids.mjs";
import { adminTranslationDeleteRestriction } from "./eslint-rules/admin-translation-writes.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Project rules (eslint-rules/). `use-client-exports`: a "use client"
  // module exports components and hooks only — shared values/helpers go
  // in a plain module (they can resolve to undefined from a server
  // component). `no-ticket-ids`: comments keep the reason, not the
  // ticket id (`n15-03`) — the id belongs in the PR description.
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      local: {
        rules: {
          "use-client-exports": useClientExports,
          "no-ticket-ids": noTicketIds,
        },
      },
    },
    rules: {
      "local/use-client-exports": "error",
      "local/no-ticket-ids": "error",
    },
  },
  // Admin routes save translations per locale (upsert), never by
  // deleting all of an entity's rows and recreating them from the body:
  // a partial save then wipes the locales and columns it did not send.
  // See eslint-rules/admin-translation-writes.mjs.
  {
    files: ["src/app/api/admin/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", adminTranslationDeleteRestriction],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright artifacts (b06) — `test-results` + `playwright-report`
    // both ship pre-bundled vendor JS that trips style + this-alias
    // rules. They're disposable build output, not source. .gitignore
    // already excludes them; eslint needs its own ignore.
    "test-results/**",
    "playwright-report/**",
  ]),
]);

export default eslintConfig;
