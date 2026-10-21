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

CI (`.github/workflows/ci.yml`) runs only lint, `tsc --noEmit`, the
unit suite and a report-only dead-code pass. Integration and E2E run
locally, by hand.

`npm run lint` is ESLint plus `npm run lint:css` (stylelint over
`src/**/*.module.css`, `stylelint.config.mjs`: hex colour literals
warn). `npm run lint:dead` (knip, `knip.config.ts`) lists files nothing
imports and exports nothing uses; CI does not fail on it
(`continue-on-error`).

Filtering a long unit run once instead of rerunning it to find the
failing file (the echo keeps vitest's exit code visible through the
pipe):

```bash
npx vitest run 2>&1 | grep -E "FAIL|×|Test Files|Tests "; echo "exit=${PIPESTATUS[0]}"
```

### Unit — no database

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
| `n14-live-path.test.ts` | **writes** | event, setlist items, reactions, wishes, confirms; also joins the dev Supabase Realtime channel (anon key) and broadcasts; `afterAll` deletes the rows |
| `n14-warm.test.ts` | **writes** | event; calls the admin `POST /api/admin/setlist-items` handler; `afterAll` deletes both |
| `setlist-deleted-404.test.ts` | **writes** | event; soft-deletes it through the admin `DELETE /api/admin/events/[id]` handler, restores it, then `afterAll` hard-deletes it |
| `image-asset-schema.test.ts` | **writes** | series and event through the admin handlers, an album, `ImageAsset` rows keyed `itest/<tag>/…`; runs `SET LOCAL ROLE anon/authenticated` inside rolled-back transactions; `afterAll` deletes them |
| `prisma-pool-txleak.test.ts` | read-only | `SELECT` only |

A suite killed mid-run (Ctrl-C, a hook timeout) skips its `afterAll`
and leaves its fixture rows in dev. A new integration test must create
its own fixtures and delete them in `afterAll`; never assert on, or
mutate, rows another feature depends on.

**Inspecting the dev DB by hand** (row counts, grants, RLS, before/after
checks for a test or migration): use `node scripts/db-ro.mjs "<sql>"
["<sql>" …]` (or `--file q.sql`, `--json`) instead of an ad-hoc `pg`
script. It is dev-only (same URL guard as the integration setup, from
`scripts/dev-db-guard.mjs`) and read-only (each statement runs inside
`BEGIN READ ONLY … ROLLBACK`, writes and session `SET` are refused before
connecting). It runs from any directory or task worktree and prints
timestamps as UTC.

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
full, `--browser webkit --quick` for Safari.

Admin pages (cover/logo editors) use `scripts/serve-build.sh <port>`
(build + `next start`, Sentry blanked, refuses a foreign port holder,
`--stop` kills only its own verified PID) and `scripts/admin-qa.mjs
--scenario <name>`, which logs in, creates and always deletes a dev-DB
fixture, and runs overflow/keyboard/label/motion/referrer checks; a page
adds a scenario under `scripts/admin-qa/scenarios/` (copy `album-cover`).

---

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
