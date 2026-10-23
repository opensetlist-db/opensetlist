# Verifying color-only CSS changes

Choose the scope before editing. A literal-to-custom-property change normally
needs a complete static audit plus a few representative paired captures. It
does not automatically need every locale × page × width combination. These
tools read pages and files; they do not create or change database fixtures.

## Decide the evidence at the start

Record the before/after commits and production build URLs, exact CSS file
inventory, approved variable/value table, expected substitution count, browser,
paths/states/widths and the heaviest image page. Pin data and build versions on
both sides. Save all output outside tracked files, for example `.claude/tmp/`.

For a color-only refactor:

1. Audit all changed modules and the global variable definitions with `static`.
2. Run the paired canary on the heaviest screen, usually the album list. Check
   its image/font diagnostics and original PNGs, even when the result is zero.
3. With a passing canary, use `--expand` for the small agreed representative
   list: one shared shell, a page using gradient/alpha, and an affected state.
   Include another browser only when affected CSS or prior evidence calls for it.
4. Compare relevant existing QA reports with `qa`, then run the repository's
   checks appropriate to the changed files. Counts of skipped checks are evidence
   limits; identical existing failures are still failures in the underlying QA.

Expand to a full matrix when selectors/layout, font loading, inheritance or
conditional tokens change; static proof cannot cover a context; a canary or
representative sample differs; or the task explicitly requires it. Resolve an
unexpected difference before expanding. Do not restart a historical large run
whose owner has stopped it.

## Static value and structure audit

Use two source trees (the before tree may be a read-only checkout). The JSON
config is explicit and reusable:

```json
{
  "files": ["src/components/Card.module.css"],
  "globals": "src/app/globals.css",
  "variables": {"--ink-card": "#112233", "--surface-glass": "#ffffff80"},
  "addedVariables": ["--surface-glass"],
  "expectedSubstitutions": 12
}
```

`variables` includes both reused and new tokens; `addedVariables` lists only new
top-level `:root` declarations. Use slash-separated paths. The optional expected
count catches incomplete inventories; record it for an actual refactor.

```bash
node scripts/palette-verify.mjs --mode static --before <before-tree> --after <after-tree> --config <config.json> --out <evidence-dir>
```

The audit compares PostCSS rule/at-rule structure, selectors, declaration order,
property names, importance and value tokens. Only an approved literal color
token may become `var(--approved-name)` with the same RGBA. It traverses gradients
and existing `var()` fallback branches, preserving their structure. Strings and
URLs are opaque. It checks every approved token's actual global value and rejects
unapproved additions, scoped overrides and `@property` registrations for approved
tokens. It also checks changed CSS outside the explicit list and approved-token
shadowing across both trees' `src/**/*.css` inventory. Existing references to a
newly added variable are rejected: defining it could activate an unchanged
fallback or alias elsewhere and silently change another element's color.

This is intentionally conservative: supported literals are valid hex
(3/4/6/8 digits) and color functions understood by the installed Culori parser.
Named colors, token aliases, new fallbacks, conditional token definitions, and
escaped identifiers in values/declarations require a different proof. Other
transformations require a different proof too. Whitespace within values is
preserved; comments and surrounding formatting are excluded from semantic
structure comparison. Review those in the source diff. External stylesheets,
inline styles and runtime JS token overrides are outside the source inventory;
inspect them and exercise affected states in the browser. PostCSS and the value
parser are loaded from the declared Stylelint dependency; no install is needed.

## Paired capture, canary first

Supply a small JSON array. Pick the heaviest case explicitly as `--canary`:

```json
[
  {"key":"albums-ko390","path":"/ko/albums","locale":"ko","viewport":{"width":390,"height":844}},
  {"key":"home-ja1440","path":"/ja","locale":"ja","viewport":{"width":1440,"height":900}}
]
```

```bash
node scripts/palette-verify.mjs --mode paired --before http://localhost:3181 --after http://localhost:3182 --cases <cases.json> --canary albums-ko390 --out <evidence-dir>
# After reviewing the canary, run the selected list (the canary is checked again):
node scripts/palette-verify.mjs --mode paired --before http://localhost:3181 --after http://localhost:3182 --cases <cases.json> --canary albums-ko390 --expand --out <new-evidence-dir>
```

Without `--expand` only the canary runs; other cases are explicitly `deferred`.
With it, a failed canary leaves remaining cases `pending`. Each side is captured
in a fresh context with the same browser, DPR 1, reduced motion, UTC and viewport.
Use `--browser webkit` when needed. `--timeout` is seconds (default 30); each side
has a 2× timeout hard cap. `--run-timeout` is minutes (default 10).

The run promotes native lazy images and sweeps the page to trigger intersection
loading, restores scroll, waits for image decode and fonts, and waits for paint.
Broken images/fonts fail readiness and are recorded; two matching placeholders
cannot count as successful image evidence. Timeout and SIGINT/SIGTERM preserve
the incremental `paired.json` with the active side and pending keys. Abrupt OS
termination cannot finalize a file; the last checkpoint still says `running` and
must be treated as incomplete. Use a new output directory for each run.

Original PNGs are compared as raw RGBA in strips, including dimension changes.
Gzipped computed snapshots retain raw class identities, text and image metadata,
plus targeted color/background/border/gradient/shadow/filter properties for each
element and its `::before`/`::after`. Only the known six-character Turbopack build
hash between `-module__` and `__local` is normalized during identity comparison.
Module and local names (including underscores) remain meaningful; unknown class
formats compare literally. Actual measured values are never normalized. An
identity mismatch fails alignment; equality does not prove unmeasured CSS or
unvisited interaction states. Background images, canvas, video and cross-origin
iframes need specific readiness/verification when the task changes them.

For the established capture matrix, opt into the same readiness helper:

```bash
node scripts/redesign-capture.mjs --base http://localhost:3181 --out <dir> --visual-ready --visual-timeout 15 --filter ko-albums --png
```

Default capture mode retains its historical fixed wait and performance metrics.
Visual mode changes resource loading, scroll and byte/CLS observations, so do
not compare those metrics against a default-mode baseline. Navigation TTFB is
still sampled before readiness; later `--repeat` rounds remain TTFB-only.

## Existing QA reports and deterministic tests

```bash
node scripts/palette-verify.mjs --mode qa --before <before.json> --after <after.json> --out <evidence-dir>
node --test scripts/capture/*.test.mjs scripts/palette/*.test.mjs
```

QA inputs are arrays or `{results:[...]}` from the existing shell/page harnesses.
The comparison checks row order/names/status and exact contrast details with only
known module hashes normalized. It does not turn existing failures/skips into
passes, or compare every non-contrast diagnostic. Full differences and raw values
are written to files; console output is a short PASS/FAIL and report path.

Tests use local HTML, intercepted fonts/images and tiny PNGs, with no database.
They include delayed load/decode, failed resources, deadlines, single-pixel/color/
selector mutations and canary/partial-manifest controls. Playwright Chromium must
already be installed. On hosts with a separate browser cache, set the process's
`PLAYWRIGHT_BROWSERS_PATH` to it. All CLI modes exit 0 on equality/success, 1 on a
comparison/readiness failure and 2 on invalid input or an unrecoverable CLI error.
