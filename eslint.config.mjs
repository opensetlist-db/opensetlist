import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import useClientExports from "./eslint-rules/use-client-exports.mjs";
import noTicketIds from "./eslint-rules/no-ticket-ids.mjs";
import consoleFormatString from "./eslint-rules/console-format-string.mjs";
import imgOnErrorRef from "./eslint-rules/img-onerror-ref.mjs";
import nonLiteralRegexp from "./eslint-rules/non-literal-regexp.mjs";
import { adminTranslationDeleteRestriction } from "./eslint-rules/admin-translation-writes.mjs";
import {
  hexColourAssertionRestrictions,
  hexColourLiteralRestrictions,
} from "./eslint-rules/hex-colour-literals.mjs";

// One plugin object for every block that uses it: flat config refuses a
// plugin name bound to two different objects.
const localPlugin = {
  rules: {
    "use-client-exports": useClientExports,
    "no-ticket-ids": noTicketIds,
    "console-format-string": consoleFormatString,
    "img-onerror-ref": imgOnErrorRef,
    "non-literal-regexp": nonLiteralRegexp,
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Project rules (eslint-rules/). `use-client-exports`: a "use client"
  // module exports components and hooks only — shared values/helpers go
  // in a plain module (they can resolve to undefined from a server
  // component). `no-ticket-ids`: comments keep the reason, not the
  // ticket id (`n15-03`) — the id belongs in the PR description.
  // `console-format-string`: a console call's first argument is a
  // constant format, not a `${…}` template — CI Semgrep blocks that form
  // (unsafe-formatstring). Scoped to src/ like the others: scripts/ and
  // tests/load/ hold 130+ such calls in operator-run tooling that ships
  // nothing, and Semgrep reports only findings a PR adds.
  // `img-onerror-ref`: in a "use client" module an `<img onError>` also
  // has a ref that checks the image on mount — a server-rendered image
  // that fails before hydration never fires React's onError.
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { local: localPlugin },
    rules: {
      "local/use-client-exports": "error",
      "local/no-ticket-ids": "error",
      "local/console-format-string": "error",
      "local/img-onerror-ref": "error",
    },
  },
  // `non-literal-regexp`: `new RegExp(x)` takes a literal pattern — CI
  // Semgrep (detect-non-literal-regexp) blocks a pattern built from a
  // value. Repo-wide, unlike the src/ rules above: Semgrep scans the whole
  // checkout, and outside src/ such calls are rare enough that each can
  // be rewritten or carry its own reasoned disable.
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    plugins: { local: localPlugin },
    rules: {
      "local/non-literal-regexp": "error",
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
  // Colours come from src/styles/tokens.ts, not hex literals: the
  // redesign palette swap broke three unit tests that compared against
  // literal hexes. A warning until page redesigns clear the existing
  // literals. Share-card files and the OG palette's own test keep their
  // own colours on purpose. See eslint-rules/hex-colour-literals.mjs.
  // Flat config replaces a rule's options per matching block, so a new
  // `no-restricted-syntax` block over these paths must re-spread these.
  {
    files: ["src/components/**/*.{ts,tsx}"],
    ignores: ["src/components/**/ShareCard*.tsx"],
    rules: {
      "no-restricted-syntax": ["warn", ...hexColourLiteralRestrictions],
    },
  },
  {
    files: ["src/__tests__/**/*.{ts,tsx}"],
    ignores: ["src/__tests__/unit/og-palette-anchor.test.ts"],
    rules: {
      "no-restricted-syntax": ["warn", ...hexColourAssertionRestrictions],
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
