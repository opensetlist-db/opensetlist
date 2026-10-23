# Shared token consumer review

Run this inventory when a shared palette changes. It lists before and after
consumers with the component or CSS selector, property, tentative role and
unresolved references. It does **not** approve the palette, prove contrast or
claim complete impact analysis. It never imports or evaluates application
source, Next config, plugins or the token module.

```sh
node scripts/token-impact.mjs --before origin/dev --after HEAD --out .claude/tmp/token-impact
node scripts/token-impact.mjs --before-tree /path/to/before --after-tree /path/to/after --out /path/to/report
```

Both commands write `impact.json` (schemaVersion 1, complete false) and
`impact.md`. Inputs are two full source trees, or two Git commit refs; the
analyzer computes the definition delta. The ref pair is an exact comparison,
not an implicit merge-base comparison. Use `git merge-base` to choose a
different baseline if needed. `--repo DIR` selects the Git repository. Repeat
`--token-file relative/path.ts` for another token module; supplying any replaces
the default `src/styles/tokens.ts`. The pure `analyzeImpact(before, after,
options)` module also accepts dictionaries of relative source paths to text.

Tree/ref readers include JS/TS/JSX/TSX and CSS, excluding dependencies, Git,
builds, generated sources, local worktrees and test files. Tree reads skip
symlinks/junctions; Git reads regular blobs, never submodules or symlinks.
Source inputs are read-only. Report output is the only filesystem mutation.
Do not point `--out` at source files or a shared output directory.

## Reading and signing off the report

1. Open **Shared token impact → Consumer roles (report only)** in the PR's
   Actions checks. Read the job summary, then download **shared-token-impact**
   for the full JSON and Markdown. The workflow uses read-only permissions,
   trusted base-branch analyzer/dependencies and no lifecycle scripts, secrets,
   database, application build, PR comments or deployment. Its first tooling
   PR reports a bootstrap notice because its base does not have the analyzer.
   No analysis is claimed for that run; local evidence belongs in its PR.
2. For **each changed token**, review **both sides**. A removed consumer or
   token may still be relevant to migration. “No static consumers” requires
   an explicit exclusion rationale, not automatic approval.
3. For **each consumer**, record in the PR: source location, actual role,
   validated or excluded, evidence (test/capture/measurement or rationale),
   reviewer, and remaining uncertainty. Include unresolved candidate sets,
   parser diagnostics, dynamic paths and consumers outside the supplied tree.
   An optional PR table is `Token | Consumer | Actual role | Validation or
   exclusion evidence | Reviewer | Remaining uncertainty`.
4. Validate the affected state, locale, viewport and interaction. A
   `background` property might be a surface, an accent or a decorative dot;
   the analyzer does not infer that meaning or ban background use. The LIVE
   fixture deliberately keeps a foreground token on a dot through both
   direct namespace access and `CONFIG[status] → cfg.color`. Those uses must
   remain visible beside foreground consumers until a reviewer disposes them.
5. Use [palette verification](palette-verification.md) for CSS equivalence,
   computed rendering and paired captures. That tool owns browser readiness
   and visual evidence; this inventory supplies the source review checklist.

## Coverage and limits

TypeScript 5's AST/checker resolves named import aliases, namespace members,
relative re-exports, `@/ → src/`, local aliases and object properties. Nested
exported const objects/arrays are flattened by key; scalar source expressions
are compared without evaluation. Non-color exports in a configured token
module also appear deliberately, so a helper value is not silently dropped.
Changing whitespace inside a scalar expression can produce a conservative
delta; changing only comments outside it does not. Exported functions are
outside the token definition inventory. Unsupported object members and parse
errors produce diagnostics.

Unchanged token expressions are not definition deltas even if a referenced
upstream value changes, for example `live: BASE.red` when `BASE.red` changes
in another module. Inspect those upstream dependencies manually. Relative
imports include TypeScript `.js`-to-`.ts` extension substitution; unresolved
relative or `@/` source imports produce diagnostics. Cross-file CSS definition
ordering is normalized by path; declaration order within each file is preserved.

Candidate propagation through object maps, dynamic selections, templates and
calls is marked **unresolved**. It can over-report, and does not prove call
return values, control flow, runtime mutation or element semantics. Arbitrary
custom module aliases, external/generated code, function-return tokens,
computed token keys/spreads, Tailwind utility generation and programmatically
constructed CSS names require manual search. A parse diagnostic or an absent
consumer is never proof of safety.

CSS is parsed with the already installed Stylelint PostCSS/value parsers.
All custom property declarations are compared, preserving selectors,
at-rule context and declaration order. `var()` uses (including fallback
branches), CSS aliases and script strings are listed. URL contents are opaque.
Scopes/cascade/inheritance, escaped identifiers and runtime custom-property
providers are not resolved. Alias chains remain candidates even if the
selectors cannot coexist; cycles terminate. A JS template constructing a
`var()` name and CSS escape spellings produce manual-review diagnostics.
CSS used outside declarations (for example unusual at-rule parameters) needs
manual review. This is an inventory, not a CSS semantics engine.

## Tests

`npm test` already discovers `src/__tests__/unit/token-impact.test.ts` in the
existing unit CI. A focused run is:

```sh
npx vitest run src/__tests__/unit/token-impact.test.ts
```

Fixtures under `scripts/token-impact/fixtures/` reproduce the LIVE
foreground/dot omission. Tests prove the stale dot is present before checking
that its corrected token removes only that consumer; cover import aliases,
namespace members, re-exports, indirect/dynamic paths, shadowing, CSS aliases
and fallback, additions/removals, no consumers, parse diagnostics, safe text
rendering, read-only tree/ref inputs and CLI output. No DB or browser is needed.
