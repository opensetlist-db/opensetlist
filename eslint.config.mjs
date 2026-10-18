import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import useClientExports from "./eslint-rules/use-client-exports.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Project rules (eslint-rules/). `use-client-exports`: a "use client"
  // module exports components and hooks only — shared values/helpers go
  // in a plain module (they can resolve to undefined from a server
  // component).
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { local: { rules: { "use-client-exports": useClientExports } } },
    rules: { "local/use-client-exports": "error" },
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
