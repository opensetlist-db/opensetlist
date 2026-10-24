import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import useClientExports from "./eslint-rules/use-client-exports.mjs";
import noTicketIds from "./eslint-rules/no-ticket-ids.mjs";
import consoleFormatString from "./eslint-rules/console-format-string.mjs";
import imgOnErrorRef from "./eslint-rules/img-onerror-ref.mjs";
import nonLiteralRegexp from "./eslint-rules/non-literal-regexp.mjs";
import noRedundantLogical from "./eslint-rules/no-redundant-logical.mjs";
import dateFormatTimezone from "./eslint-rules/date-format-timezone.mjs";
import { adminTranslationDeleteRestriction } from "./eslint-rules/admin-translation-writes.mjs";
import {
  hexColourAssertionRestrictions,
  hexColourLiteralRestrictions,
} from "./eslint-rules/hex-colour-literals.mjs";
import { entityUrlPathRestrictions } from "./eslint-rules/entity-url-paths.mjs";
import { builtinRules } from "eslint/use-at-your-own-risk";

// One plugin object for every block that uses it: flat config refuses a
// plugin name bound to two different objects.
const localPlugin = {
  rules: {
    // The core `no-restricted-syntax` under a second name. One rule has
    // one severity per file, and in src/components/ the core rule already
    // carries the hex-colour entries as warnings; the entity-URL entries
    // must be errors, so they run as their own rule instead.
    "no-hand-built-entity-urls": builtinRules.get("no-restricted-syntax"),
    "use-client-exports": useClientExports,
    "no-ticket-ids": noTicketIds,
    "console-format-string": consoleFormatString,
    "img-onerror-ref": imgOnErrorRef,
    "non-literal-regexp": nonLiteralRegexp,
    "no-redundant-logical": noRedundantLogical,
    "date-format-timezone": dateFormatTimezone,
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
  // `date-format-timezone`: date-format options that render a calendar
  // day name their `timeZone` — without one a stored UTC date shows the
  // previous day west of UTC, which Vercel and CI (both UTC) never show.
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { local: localPlugin },
    rules: {
      "local/use-client-exports": "error",
      "local/no-ticket-ids": "error",
      "local/console-format-string": "error",
      "local/img-onerror-ref": "error",
      "local/date-format-timezone": "error",
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
  // Browser-QA scenarios and harnesses: a check condition decides
  // whether a page passes, and an `&&`/`||` mix read the wrong way
  // passes vacuously. `no-mixed-operators` makes every mix spell its
  // grouping in parentheses; `no-redundant-logical` catches the
  // absorbed form (`X && Y || X`, always X) even when parenthesised.
  {
    files: [
      "scripts/page-qa/**/*.mjs",
      "scripts/admin-qa/**/*.mjs",
      "scripts/*-qa*.mjs",
    ],
    plugins: { local: localPlugin },
    rules: {
      "no-mixed-operators": ["error", { groups: [["&&", "||"]] }],
      "local/no-redundant-logical": "error",
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
  // Public entity links go through src/lib/seo/entityUrl.ts
  // (`entityPath`, `eventHref`), never a hand-built `/${locale}/songs/${id}`
  // template — CLAUDE.md "URL Strategy". Public pages and components
  // only: admin and API routes build operator/fetch paths, and src/lib/
  // holds the approved builders. See eslint-rules/entity-url-paths.mjs.
  {
    files: ["src/app/\\[locale\\]/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    plugins: { local: localPlugin },
    rules: {
      "local/no-hand-built-entity-urls": ["error", ...entityUrlPathRestrictions],
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
    // Local scratch scripts and generated QA evidence are disposable;
    // .gitignore does not exclude them from ESLint's flat config.
    ".claude/tmp/**",
  ]),
]);

export default eslintConfig;
