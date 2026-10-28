# TESTING.md — OpenSetlist tests

> What the config files can't tell you: which command runs which suite,
> which suites write to the shared dev database, and the house rules for
> new tests. For globs, environments and timeouts, read the configs
> themselves — `package.json` (scripts), `vitest.config.ts`,
> `vitest.integration.config.ts`, `playwright.config.ts`.

---

## Suites and commands

| Suite | Command | Config | Lives in | Database |
|---|---|---|---|---|
| Unit | `npm test` | `vitest.config.ts` | `src/**/*.test.{ts,tsx}` (mostly `src/__tests__/unit/`) | none — Prisma is mocked |
| Integration | `npm run test:integration` | `vitest.integration.config.ts` | `src/__tests__/integration/` | **shared dev Supabase** |
| E2E | `npm run test:e2e` | `playwright.config.ts` | `tests/e2e/` | dev DB through the app |
| Event-detail TTFB | `scripts/ttfb-event-detail.sh <base-url> [label]` | — | `scripts/` | dev DB through the app (reads) |
| Load (manual) | see `tests/load/README.md` | — | `tests/load/` | some scripts write to dev |

CI (`.github/workflows/ci.yml`) runs only lint, the TESTING.md row
check, `tsc --noEmit`, the unit suite and a report-only dead-code pass. Integration and E2E run
locally, by hand.

The unit suite runs with `TZ=America/Los_Angeles` (set in
`vitest.config.ts`), on every machine and in CI. A stored UTC date
formatted without `timeZone: "UTC"` therefore renders a day early and
fails, instead of passing on UTC hosts (Vercel, CI) and drifting only on
a developer's machine. Write date tests against that zone, never by
reading the host's. `tz-pin.test.ts` fails if the pin stops taking effect.

`npm run lint` is ESLint plus `npm run lint:css` (stylelint over
`src/**/*.module.css`, `stylelint.config.mjs`: hex colour literals fail
in the 11 palette-only modules listed in its override; other modules
warn, and `src/app/globals.css` remains exempt for palette definitions).
`npm run lint:dead` (knip, `knip.config.ts`) lists files nothing
imports and exports nothing uses; CI does not fail on it
(`continue-on-error`).

Filtering a long unit run once instead of rerunning it to find the
failing file (the echo keeps vitest's exit code visible through the
pipe):

```bash
npx vitest run 2>&1 | grep -E "FAIL|×|Test Files|Tests "; echo "exit=${PIPESTATUS[0]}"
```

Before review, lint every file the branch changed, with warnings
failing. Warnings do not fail CI, so a file left out of a partial lint
reaches the PR with its warning (a `hex-colour-literals`, say) as a mere
CI annotation. The diff limits the check to this branch's files, so the
repo's pre-existing warnings do not block it; replace `dev` with the
PR's base (`feature/redesign` for redesign tickets). The guard skips an
empty list (a bare `npx eslint` lints the whole repo), and
`--no-warn-ignored` keeps a changed file under an ignore pattern from
counting as a warning:

```bash
files=$(git diff --name-only --diff-filter=d origin/dev...HEAD -- '*.ts' '*.tsx' '*.mjs'); [ -z "$files" ] || npx eslint --max-warnings=0 --no-warn-ignored $files
```

### Unit — no database

`npx vitest run src/__tests__/unit/event-og-preview.test.ts` exercises the
event-card preview service with actual bundled fonts/Satori/ImageResponse PNGs,
three modes/locales, measured title and venue limits, missing fonts/glyphs,
timezone-stable dates, manifests/tampering and display-title review evidence.
It also runs a few real CLI processes for malformed arguments, bad packets,
render failure and exact offline replay. It uses temporary local directories,
never a DB or bucket. See [the operator runbook](docs/event-og-preview.md) for
the separate actual-dev-data 18-image review matrix and legacy comparisons.

`event-og-publication.test.ts` in the unit suite checks frozen share HTML,
metadata/escaping and a few actual CLI validation/dev-guard processes without
a DB. See [the publication runbook](docs/event-og-publication.md).

`event-og-production.test.ts` checks the owner-dispatched hosted operation
boundary without production credentials: exact Fes2 scope, explicit approval,
deployed commit/artifact identity, environment separation and actual local CLI
refusal. It does not execute the production workflow or prove live CDN/X.

`npm test` never opens a connection: the files that import
`@/lib/prisma` either `vi.mock` it or `vi.spyOn` the methods they call
(importing the client builds a pool but connects only on a query). Keep
it that way — a unit test that needs real rows belongs in the
integration suite.

### Integration — the shared dev database

There is no separate test database. The integration setup
(`src/__tests__/integration/setup.ts`) loads `.env.local` and `.env` and
throws unless both `DATABASE_URL` and `DATABASE_URL_UNPOOLED` point at
the dev Supabase project, so a prod URL in the shell cannot slip
through. Files run one at a time (`fileParallelism: false`).

The dev DB also backs the Vercel Preview and other sessions' work, so
know what each suite leaves behind:

| Integration file | Writes? | What it creates, and its cleanup |
|---|---|---|
| `board-picks.test.ts` | **writes** | artist, song, series, event, setlist item, `BoardPick` rows; `afterAll` deletes them |
| `board-wishes.test.ts` | **writes** | artists, songs, series, event, `SongWish` rows; `afterAll` deletes them |
| `member-order.test.ts` | **writes** | artist, event, stage identity, performers; `afterAll` deletes them |
| `official-order.test.ts` | **writes** | `officialorder-itest-` artists, identities, relations, event, explicit voice, song and historical item in a rolled-back transaction; fixed-prefix purge before/after handles interrupted fixtures |
| `n14-live-path.test.ts` | **writes** | event, setlist items, reactions, wishes, confirms; also joins the dev Supabase Realtime channel (anon key) and broadcasts; `afterAll` deletes the rows |
| `n14-warm.test.ts` | **writes** | event; calls the admin `POST /api/admin/setlist-items` handler; `afterAll` deletes both |
| `setlist-deleted-404.test.ts` | **writes** | event; soft-deletes it through the admin `DELETE /api/admin/events/[id]` handler, restores it, then `afterAll` hard-deletes it |
| `image-asset-schema.test.ts` | **writes** | series and event through the admin handlers, an album, `ImageAsset` rows keyed `itest/<tag>/…`; runs `SET LOCAL ROLE anon/authenticated` inside rolled-back transactions; `afterAll` deletes them |
| `logo-resolution.test.ts` | **writes** | three series + two events keyed `logo-itest-<ts>-*`, `ImageAsset` rows keyed `itest/logo-itest-<ts>/…`, plus one admin `PUT /api/admin/event-series/[id]` and one `PUT /api/admin/events/[id]` on its own fixtures; creates its own coloured artist `logo-itest-<ts>-artist`; `afterAll` deletes them and asserts none are left |
| `event-og-publication.test.ts` | **writes** | real dev DB + MemoryImageStorage; synthetic events with fixed `og02itest-` slugs and `og02itest/event-cards/` asset keys; purges its prior remnants, cleans publication/rendition/annotation/ImageAsset/event rows in `afterAll`; tests atomic locales, stale facts, exact packets, failed uploads/transactions, lost COMMIT replies and concurrent retries; no R2 writes |
| `event-og-correction.test.ts` | **writes** | real PNG publications + MemoryImageStorage, fixed `og03itest-` slugs and namespace; purges/cleans its own correction history, publications, assets and events; tests immutable old bytes/metadata, chain validation, graph races, CAS/version conflicts, rollback and ambiguous COMMIT; no R2 writes |
| `event-og-suspension.test.ts` | **writes** | real dev DB + PNG/MemoryImageStorage and independent fake HTTP origin/cache; fixed `og04itest-` slugs/namespace; purges/cleans own decisions, attempts, writer fences, publications and assets; scope, neutral projection, partial retries, conflicts, COMMIT/audit failures and duplicate-publisher race; no R2 writes |
| `image-upload-service.test.ts` | **writes** | series and event through the admin handlers, an album, `ImageAsset` rows whose `publicUrl` starts `https://images.test.invalid/upload-itest-<ts>/`; storage is in-memory (no R2); `afterAll` deletes them and asserts none left |
| `album-cover.test.ts` | **writes** | one album with slug `cover-itest-<ts>`, `ImageAsset` rows whose `publicUrl` starts `https://images.test.invalid/cover-itest-<ts>/`; re-imports that one slug through the CSV importer; storage is in-memory (no R2); `afterAll` deletes them and asserts none left |
| `series-logo-route.test.ts` | **writes** | parent/child series (+ a soft-deleted one) and one event, all named `series-logo-itest-<ts> …`, through the admin handlers; `ImageAsset` rows whose `publicUrl` starts `https://images.test.invalid/series-logo-itest-<ts>/`; storage is in-memory (no R2); `afterAll` deletes them and asserts none left |
| `event-logo-route.test.ts` | **writes** | parent/child series and events (one soft-deleted) named `event-logo-itest-<ts> …` through the admin handlers, with a fake poster URL; `ImageAsset` rows whose `publicUrl` starts `https://images.test.invalid/event-logo-itest-<ts>/`; storage is in-memory (no R2); `afterAll` deletes them and asserts none left |
| `global-search.test.ts` | **writes** | songs (one variant, one soft-deleted), artists, an album and events whose slug starts `srchitest<ts>`, plus their translations and one `SongArtist`; search reads only; `afterAll` deletes them and asserts none are left |
| `home-events.test.ts` | **writes** | one song and events dated 2099 whose slug starts `home-itest<ts>`, with setlist items (+ `SetlistItemSong`) on some; home queries read with a 2099 reference instant so real events stay out of the windows; `afterAll` deletes them and asserts none are left |
| `album-list-pagination.test.ts` | **writes** | read-only paging of the whole album catalog and every artist chip against a raw-SQL ordering; then 5 artists (2 deleted sub-units) and 29 albums dated 2099 or undated whose slug starts `c07itest<ts>`, with `AlbumArtist` links; `beforeAll` purges earlier `c07itest` leftovers, `afterAll` deletes them and asserts none are left |
| `r2-smoke.test.ts` | **skipped** unless `R2_SMOKE=1` | no DB; with the `R2_*` env set and `R2_KEY_PREFIX=test`, writes ONE object `test/smoke/<uuid>.png` to the real bucket and deletes nothing — log the printed key |
| `prisma-pool-txleak.test.ts` | read-only | `SELECT` only |

Every `*.test.ts` here needs a row, and every row a file:
`npm run check:testing-md` (a CI step right after Lint) fails otherwise. The
same holds for the E2E table below.

A suite killed mid-run (Ctrl-C, a hook timeout) skips its `afterAll`
and leaves its fixture rows in dev. A new integration test must create
its own fixtures and delete them in `afterAll`; never assert on, or
mutate, rows another feature depends on.

A suite that asserts an exact list or count must also remove an earlier
run's leftovers before it starts, or one interrupted run fails every
later one. Start every fixture slug with a fixed prefix of the file's
own, and at the start of `beforeAll` hard-delete everything matching
that prefix (a per-run token after it is fine; the purge must not
depend on it). Reference: `purge(PREFIX)` in
`src/__tests__/integration/home-events.test.ts` (on `feature/redesign`
until it merges).

**Inspecting the dev DB by hand** (row counts, grants, RLS, before/after
checks for a test or migration): use `node scripts/db-ro.mjs "<sql>"
["<sql>" …]` (or `--file q.sql`, `--json`) instead of an ad-hoc `pg`
script. It is dev-only (same URL guard as the integration setup, from
`scripts/dev-db-guard.mjs`) and read-only (each statement runs inside
`BEGIN READ ONLY … ROLLBACK`, writes and session `SET` are refused before
connecting). It runs from any directory or task worktree and prints
timestamps as UTC.

**Adding QA fixtures** (new Album / EventSeries / Event rows, optional
AlbumArtist links to existing artists, series / event logo modes with
their own ImageAsset rows, for states the seed data lacks):
`node scripts/db-fixture-add.mjs --prefix "[QA] <Tag>" --spec <json>
--dry-run` first — guarded insert, spec format in its header; never an
ad-hoc insert script. Its stdout goes to `scripts/page-qa.mjs --fixture`
unchanged, and it prints the `db-fixture-rm` command for the same rows.

**Removing QA fixtures** (EventSeries / Event / Album / ImageAsset rows
made through the admin UI, which only soft-deletes): `node
scripts/db-fixture-rm.mjs --dry-run …` — guarded hard delete, usage in
its header; never an ad-hoc delete script.

### E2E — through the app

`playwright.config.ts` starts `npm run dev` on `localhost:3000` unless
`TEST_BASE_URL` is set (then it tests that deployment and starts
nothing). The specs load `.env` and `.env.local` through
`tests/e2e/helpers/env.ts`, and each spec **skips** when the sample IDs
it needs are missing — a green run with skips proves little, so check
the skip count.

| Spec | Writes? | Needs |
|---|---|---|
| `album.spec.ts` | GET only | `E2E_ALBUM_ID`, `E2E_SINGLE_ID`, `E2E_LIVE_ALBUM_ID` |
| `album-cross-links.spec.ts` | GET only | `E2E_MULTI_ALBUM_SONG_ID`, `E2E_DISCOGRAPHY_ARTIST_ID`, `E2E_BD_SERIES_ID` |
| `bonus-scrape.spec.ts` | GET only | `E2E_BONUS_ALBUM_ID` |
| `event-bd-section.spec.ts` | GET only | `E2E_BD_EVENT_ID`, `E2E_PLAIN_EVENT_ID` |
| `home.spec.ts` | GET only | none — asserts roles, landmarks and URLs, so any dev catalog state passes |
| `search.spec.ts` | GET only | a catalog where `a` matches >20 songs (any seeded dev DB) |
| `event-og-publication.spec.ts` | **writes**, explicitly skipped unless `EVENT_CARD_R2_E2E=1` | dev DB + `opensetlist-images-dev` bucket + `R2_KEY_PREFIX=test`; writes nine retained PNGs, logs exact keys, purges/cleans only `og02e2e-` fixtures; actual nine normal/Twitterbot HTML+PNG responses, CLI retry, canonical auto-navigation and JS-free mobile/keyboard fallback; requires matching production `TEST_BASE_URL` / `NEXT_PUBLIC_BASE_URL` |
| `event-og-correction.spec.ts` | **writes**, explicitly skipped unless `EVENT_CARD_R2_E2E=1` | same dev DB/bucket/test guards; fixed `og03e2e-` fixture cleaned with its history; retains twelve PNGs with exact keys; three-locale old OG/PNG preservation, no automatic navigation, accessible mobile/keyboard/JS-free notice and explicit latest link, latest/unrelated-mode normal navigation; matching production base URLs required |
| `event-og-suspension.spec.ts` | **writes and exact-key revocation**, skipped unless `EVENT_CARD_R2_E2E=1` | dev DB/bucket/test and uncached r2.dev only; creates nine synthetic PNGs, revokes exactly three prediction keys, retains six; own `og04e2e-` fixture/history/fences cleaned; partial CLI then same-ID retry, old image404, three neutral notices/mobile/keyboard/no-JS, unaffected modes; custom-domain CDN purge remains a separate unverified live requirement |
| `event-og-rollout.spec.ts` | **writes and exact-key revocation**, skipped unless `EVENT_CARD_R2_E2E=1` | matching local production build or deployed Preview + dev DB/bucket/test;12 new synthetic PNGs,6 prediction keys explicitly revoked,6 other-mode keys retained; fixed `og05e2e-` fixture/history/fences cleaned; all-locale normal/Twitterbot identities, actual PNG hashes/dimensions, navigation/fallback, real venue correction, both corrected source and replacement suspension, deleted/restored and invalid tuples; GET ECONNRESET alone retries once, no HTTP/write retries; no live cached-domain/X proof |
| `event-og-regression.spec.ts` | GET only; skipped unless `EVENT_CARD_REGRESSION_E2E=1` | real catalog2/109 and actual predicted/final phases; isolated browser localStorage, API writes intercepted and blocked before server; six downloaded personal PNGs with content/score/hash and three fan-board clipboard URLs/group navigation; no saved ballot or SNS posts |
| `seo-canonical.spec.ts` | GET only | events in the sitemap |
| `setlist-unknown-song.spec.ts` | **writes** | `E2E_UNKNOWN_SONG_EVENT_ID`, `E2E_MULTI_ALBUM_SONG_ID`, `ADMIN_PASSWORD` |

`setlist-unknown-song.spec.ts` logs in as admin, POSTs a songless
setlist item to the event, PUTs a song onto it, and in `finally`
DELETEs it — a **soft** delete, so an `isDeleted` row stays on that
event for every run. Point `E2E_UNKNOWN_SONG_EVENT_ID` at a throwaway
dev event, never one the Preview or another task relies on.

### Event-detail TTFB — same measurement as CI

`scripts/ttfb-event-detail.sh` is the measurement the
`perf — event detail TTFB` workflow (`event-detail-perf.yml`) runs on
both sides of a PR: a warm-up pass, then 2 passes over ko/ja/en ×
`PERF_EVENT_IDS` (default: dev events 1 and 2, as `{id}/{slug}`),
averaging curl's `time_starttransfer` over HTTP-200 samples only. It
prints the mean on stdout and each sample on stderr, and exits 1 when
more than half the samples are non-200.

To reproduce a CI number, measure a production build against the dev
DB. Blank the Sentry variables so the build uploads nothing:

```bash
SENTRY_AUTH_TOKEN= SENTRY_DSN= NEXT_PUBLIC_SENTRY_DSN= npm run build
npm run start
scripts/ttfb-event-detail.sh http://localhost:3000 LOCAL
```

Absolute numbers differ from the runner's (different network path to
Supabase Seoul); compare a branch against its base on the same machine,
as the workflow does.

### Redesign captures and shell QA

For color-literal to custom-property refactors, use
[`scripts/palette-verify.mjs`](scripts/palette-verify.mjs): static AST/value audit,
paired image/computed canary before expanding a chosen case list, and existing
QA report comparison. [The runbook](docs/palette-verification.md) defines the
evidence scope, config formats, limitations and matrix expansion conditions.
Run its no-DB deterministic tests with
`node --test scripts/capture/*.test.mjs scripts/palette/*.test.mjs` (installed
Playwright Chromium and WebKit required). `redesign-capture.mjs --visual-ready` opts into
bounded image/font decode and paint readiness; the default performance capture
mode retains its historical wait and measurements.

Both run against a production build like the TTFB script above
(`npx next start -p 3110`), and their output stays out of the repo.

`scripts/redesign-capture.mjs` captures screenshots and per-page metrics
for the redesign page set. `--compare <captures.json>` diffs the new run
against a baseline manifest (the ticket 02 one is in the wiki vault,
`output/redesign/handoffs/02/captures/captures.json`) and prints the
regressions: new horizontal scroll, CLS, console errors, `lang`, status.

`scripts/redesign-shell-qa.mjs` checks the shared shell (header bands,
overflow, menu keyboard behaviour, focus ring, locale switch, reduced
motion) across locales × widths and exits 1 on any FAIL. Page tickets run
it after any shared-style change (redesign spec story 51): chromium in
full, `--browser webkit --quick` for Safari. `--summary` prints only the
FAIL lines (timeouts included) and the tally; every check, PASS and N/A
too, stays in `<out>/<browser>-qa.json`. Without `--out`, `<out>` is
`test-results/shell-qa/<browser>` (`<browser>-quick` with `--quick`) under
the checkout root, printed as the first line; a rerun overwrites it.

A production hydration mismatch shows up only as "Minified React error
#418/#423/#425", with no component or text. `redesign-capture.mjs` then
prints a hint line naming `scripts/hydration-diff.mjs <url> --timezone
Asia/Seoul`. That script diffs the SSR HTML against the hydrated DOM in
each `--timezone` (repeatable, default UTC) and prints the page errors
plus the text found on only one side, with an ancestor path. Compare two
zones to tell a timezone-dependent render from post-hydration client
updates.

Admin pages (cover/logo editors) use `scripts/serve-build.sh <port>`
(build + `next start`, Sentry blanked, refuses a foreign port holder,
`--stop` kills only its own verified PID) and `scripts/admin-qa.mjs
--scenario <name>`, which logs in, creates and always deletes a dev-DB
fixture, and runs overflow/keyboard/label/motion/referrer checks; a page
adds a scenario under `scripts/admin-qa/scenarios/` (copy `album-cover`).

Public pages (artist detail, album detail, …) use `scripts/page-qa.mjs
--scenario <name>` against the same kind of build: it runs the locale ×
width layout matrix (overflow, `<html lang>`, raw i18n keys, runtime
errors), reduced motion with a positive control and canonical/404 checks
through the request API, with a per-action `--timeout` and a whole-run
`--timeout-min`, and writes a `.log` and `.json` per run. Default scenarios
do not write to the DB; fixture rows normally come in through
`--fixture <json>`. The `song-picker` scenario has an explicit opt-in
write fixture (`eventId: "109"`, unique `runPrefix: "c10qa-<timestamp>"`):
`--only-fixture` exercises real board saves/restores through the app on
localhost with guarded dev URLs. Claim the shared dev DB slot first. It
creates only isolated guest choices, removes them in `finally` (reconciling
lost POST responses through that guest's `/board/mine`), and verifies zero
rows remain. Preserve the run prefix and check it with `db-ro` after the
run, especially if interrupted. A page ticket
adds a scenario under `scripts/page-qa/scenarios/` (copy `artist-detail`)
instead of its own QA script: chromium in full, `--browser webkit --quick`
for Safari. `layoutMatrix({ basics, capture })` adds one h1, 24px
targets and heading markup (no heading in a phrasing-only parent such
as a span, `<summary>` headings direct and at most one; unit-tested in
`page-qa-markup.test.ts`) per cell and a capture taken before any focus
step; `h.afterNav(page, { url, ready, action })` waits out a client
navigation (Link, `?tab=`, `goBack`) until `ready` is in the new `<main>`;
`h.contrast` (exact CSS-module suffix `__<name>`, translucent backgrounds
composited), `h.focusRing`, `h.scrollRegion` (fresh-load ArrowRight) and
`reducedMotion({ rest, optional })` cover the rest of a page ticket's
checklist — `home` uses them all. Responses ≥400 count as errors except
the local `_vercel/speed-insights` 404; a check whose subject is absent
on the build or data prints SKIP, which never fails a run.

`page-qa.mjs`, `admin-qa.mjs` and `redesign-capture.mjs` read
`messages/` and `.env` from the git checkout holding the current
directory, and their scenarios from beside the script. A copy extracted
from another branch (e.g. into a redesign worktree's gitignored
`.claude/tmp/`, with its `page-qa/` or `admin-qa/` folder, plus
`dev-db-guard.mjs` for admin-qa) therefore runs against the worktree it
is started from.

---

## Windows task tools

Use `powershell -NoProfile -File scripts/task-runtime.ps1 serve-build
-Runtime GitBash -Port 3191` to select Git Bash explicitly, or select
`-Runtime WSL -Distro <name>` with Linux Node installed. Windows removal
uses the same entry point with `worktree-rm -Path <absolute-path>
-ReleasedHead <full-handoff-head> -MergeRef origin/dev` (first add `-DryRun`).
It always runs natively and refuses dirty, active, unmerged, or unsafe paths.
See [Windows runtime and cleanup](docs/windows-task-runtime.md) for archive
requirements, process ownership, sweep behavior, JSON results and exit codes.
Run the independent Windows Git/junction/lock/process fixtures with
`powershell -NoProfile -NonInteractive -File scripts/windows/runtime.test.ps1`.

## What to test

**"If this breaks, the site is broken."** Test first what a fan
loading a setlist page or an operator entering one on show night would
hit: display-name and translation fallbacks, setlist rendering and its
admin write path, the realtime live path, canonical URLs and redirects.

Not worth a test:

```
❌ Prisma model definitions (Prisma tests its own ORM)
❌ Next.js routing (framework responsibility)
❌ Tailwind CSS styling
❌ Third-party API responses (translation providers, scrapers) — mock these
❌ 100% code coverage — not the goal
```

## data-testid convention

When an E2E spec has to pick out an element, select by `data-testid`,
not by class names or visible text (text changes per locale). The
current specs mostly assert on URLs, status codes and markup such as
`<link rel="canonical">`, so few elements carry one yet; add it where
a new spec needs it:

```tsx
<div data-testid="setlist-item">...</div>
<button data-testid="translate-button">...</button>
```
