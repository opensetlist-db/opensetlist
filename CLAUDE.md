# CLAUDE.md — OpenSetlist (opensetlist.com)

> Single source of truth for architectural and design decisions that apply across all phases.
> Phase-specific plans, progress, and strategies are in session memory (see bottom).

---

## Project Overview

**OpenSetlist** is a crowdsourced setlist database for East Asian live music — K-POP, J-POP, C-POP, anime, game, and beyond.
Similar to setlist.fm but focused on East Asian content — Korean, Japanese, English, Chinese users.

- **Site:** opensetlist.com
- **Phase 1 seed content:** Hasunosora (anime/game music IP, Korean audience) — chosen as a scope-complete starting corpus, not a genre cap on the product.
- **Unique value:** Unit/member-level setlist detail that setlist.fm lacks entirely
- **Model:** Crowdsourced data + community discussion boards

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 14 (App Router) | SSR for SEO |
| Language | TypeScript | Strict mode |
| i18n | next-intl | /[locale]/ routing |
| Auth | NextAuth.js | Phase 1B |
| ORM | Prisma 7 | prisma.config.ts pattern |
| Database | PostgreSQL (Supabase Seoul) | Free tier → Pro at Phase 2 |
| Search | pg_tsvector → Meilisearch Cloud → self-hosted | Phased progression |
| Cache | Redis (Upstash Seoul) | Phase 2 |
| Images | Cloudflare R2 | Phase 2 — no self-hosted images in MVP |
| Hosting | Vercel (frontend) | Free tier |
| CDN | Cloudflare | Free |

---

## Prisma 7 Configuration

- `prisma.config.ts` — DB connection lives here, not in schema.prisma
- `src/lib/prisma.ts` — singleton client with PrismaPg adapter
- Key: use session pooler (port 5432) for migrations, transaction pooler (port 6543) for runtime
- See `memory/prisma_config.md` for full code patterns and commands

---

## Schema Design — Final v9 + Community v4

Full schema: `prisma/schema.prisma`

### ID Strategy
```
BigInt @default(autoincrement()) — tables that appear in public URLs:
  Artist, Song, Event, EventSeries, SetlistItem
  → URLs: /artists/42, /songs/789, /events/123

String @default(uuid()) — all other tables:
  Group, StageIdentity, RealPerson, Album
  User (sequential IDs must never be guessable)
  All junction tables, translation tables, community tables
```

### Soft Delete Strategy
```
isDeleted Boolean @default(false)
deletedAt DateTime?

Applied to: Artist, Song, Event, EventSeries, SetlistItem, User
NOT applied to: Junction tables, Translation tables
  (those are hard-deleted when parent is soft-deleted)
```

### Enum Strategy
All fixed-value string fields use Prisma enums (PostgreSQL enum types):
```
GroupType          franchise | label | agency | series
GroupCategory      anime | kpop | jpop | cpop | game
ArtistType         solo | group | unit
StageIdentityType  character | persona
EventSeriesType    concert_tour | standalone | festival | fan_meeting
EventType          concert | festival | fan_meeting | showcase | virtual_live
EventStatus        scheduled | ongoing | completed | cancelled
SetlistItemStageType  full_group | unit | solo | special
SetlistItemStatus  rumoured | live | confirmed
SetlistItemPerformanceType  live_performance | virtual_live | video_playback
SetlistItemType    song | mc | video | interval
SongArtistRole     primary | featured | cover
AlbumType          single | album | ep | live_album | soundtrack
CommentType        post | comment
```

### GIN Indexes
All Comment roll-up array fields use GIN indexes for efficient ANY() queries:
```prisma
@@index([rollupSongIds], type: Gin)
@@index([rollupEventIds], type: Gin)
@@index([rollupEventSeriesIds], type: Gin)
@@index([rollupArtistIds], type: Gin)
@@index([rollupGroupIds], type: Gin)
@@index([rollupCategories], type: Gin)
```

See `memory/schema_design.md` for full table overview, or read `prisma/schema.prisma` directly.

### Key Design Decisions

**Sub-units as Artists** — Cerise Bouquet, DOLLCHESTRA, Mira-Cra Park! are `Artist` entries with `parentArtistId → 蓮ノ空`. Sub-unit membership implicit via `StageIdentityArtist`.

**Song variants** — "Dream Believers (SAKURA Ver.)" has `baseVersionId → "Dream Believers"` and `variantLabel: "SAKURA Ver."`.

**Medleys** — `SetlistItemSong` junction with `order`. No direct `songId` on `SetlistItem`.

**Collaborations** — `SongArtist` junction with `role`. "Link to the FUTURE" → three rows.

**Guest performers** — Guests (e.g. Miyake Miu before joining as member) get a StageIdentity row from day one. Their guest appearance is a normal `SetlistItemMember` row. No special guest handling needed.

**Multi-artist events** — 이차원 페스 gets `EventSeries` with `artistId: null`, `organizerName: "Bandai Namco / Lantis"`.

**Multi-day shows** — one `Event` row per day, all sharing the same `EventSeries`. No leg/container event in between.

**VA changes** — `RealPersonStageIdentity` `startDate`/`endDate`. `SetlistItemMember.realPersonId` always explicit, never inferred from dates.

---

## URL Strategy

```
Canonical:    /[locale]/songs/789
Display:      /[locale]/songs/789/hanamusubi
Redirect:     Any slug variant → canonical numeric ID

Examples:
  /ko/songs/789/하나무스비
  /ko/artists/42/cerise-bouquet
  /ko/events/123/4th-live-kobe-day-2
  /ko/series/7/4th-live-dream-bloom
```

Numeric ID is canonical — slug is decorative only, for SEO and readability.

---

## i18n Rules

```
/[locale]/... routing — locale prefix required on all pages
Locales: ko (launch), ja (Phase 2), en (Phase 3), zh-CN (Phase 3)
```

Hard rules:
- Never hardcode text in **public-facing surfaces** — always use i18n keys
- Store dates/times in UTC, convert on display
- Use Noto Sans self-hosted (supports all 4 languages) — never load from Google Fonts (China firewall)
- `lang` attribute on `<html>` must match locale

### Admin UI exemption — operator-only routes are Korean-only

Routes under `src/app/admin/**`, `src/app/api/admin/**`, and any other
operator-only surface are **exempt from the "never hardcode text" rule**
and intentionally written in Korean only. The operator is the sole user;
they speak Korean; threading `useTranslations` through every form label,
table header, alert, and placeholder is pure overhead with no payoff.
This is a deliberate, project-wide decision — not technical debt — and
applies to:

- `<th>` headers in admin tables (`이름`, `타입`, `슬러그`, etc.)
- form labels, placeholders, and helper text in admin forms
- `alert(...)` / confirm dialog strings shown only to admins
- 409 / 4xx error message bodies returned by `/api/admin/**` routes

Reviewers (CodeRabbit, the local push-review hook) should NOT flag
hardcoded Korean strings in these paths as i18n violations. New admin
features should follow the same convention — match the existing
labels' style and language.

The user-facing surfaces (everything under `src/app/[locale]/**`,
`src/components/**` rendered there, public API responses) remain
strictly i18n-keyed; the rule only relaxes inside the admin scope.

---

## Date & Time — UTC is the only correct default

All `Event.date`, `Event.startTime`, and every timestamp column we persist
is **stored in UTC**. Every comparison, bucket, and filter that runs on the
server MUST also be computed in UTC — the server's local timezone is an
accident of where the process happens to run (Vercel edge/region,
developer laptop, CI) and using it produces results that silently drift
by hours depending on region. **Never use server-local day boundaries for
anything that classifies stored dates.**

### Required patterns

```ts
// ✅ Correct — day boundary in UTC, matches how the data is stored
function startOfTodayUTC() {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
}

// ❌ Wrong — silently depends on the server's TZ
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0); // uses LOCAL midnight, not UTC
  return d;
}
```

- `setHours`, `getHours`, `getFullYear`, `getMonth`, `getDate` — all **local-time**. Do not call them for comparisons with stored dates.
- Use `Date.UTC(...)` for constructing boundaries, and `getUTC*` getters when you need to inspect parts of a stored date.
- `new Date()` (current moment) is fine to compare against a stored UTC `Date` — both sides are absolute instants.
- Only convert to the user's locale/timezone at the **display layer** (`formatDate`, `toLocaleString`, etc.) — never inside a filter, `where` clause, or bucketing helper.

### Display-layer conversion

User-visible dates should be formatted with the viewer's locale via
`formatDate(date, locale)` in `src/lib/utils.ts`. That helper is the
single conversion point from UTC-stored → locale-rendered. Do not
reinvent it inline.

---

## Code Comments

Detailed multi-line comments are **encouraged** when they explain WHY:
rationale, design decisions, edge cases, workarounds, subtle invariants,
non-obvious constraints. The Claude Code default of "one short line max"
is **overridden for this project** — write the comments you'd want when
re-reading the code in 6 months.

What's worth commenting:
- Non-obvious design decisions and the reasoning behind them
- Edge cases the code handles, and why they matter
- Workarounds, with a pointer to the underlying issue
- Subtle invariants, ordering requirements, or hidden coupling

Still skip:
- Restating what well-named code already says (`// increment i`)
- References to the current task / PR / fix — those rot fast and
  belong in the PR description, not the source

Code reviewers (CodeRabbit and the local review hooks) should NOT flag
multi-line comment blocks as a style violation in this project.

---

## Folder Structure

See `memory/schema_design.md` for the intended directory tree.

---

## Domain & Brand

- **Domain:** opensetlist.com (Namecheap, WHOIS privacy ON)
- **Email:** help@opensetlist.com
- **"Open"** signals: free to access, open to contributions, community-built
- **Genre-neutral:** works for K-POP/J-POP expansion without rebrand

---

## Development Workflow

```
Repo: github.com/opensetlist-db/opensetlist (public)

Branches:
  main     — production (opensetlist.com). Direct commits FORBIDDEN.
  dev      — staging. Auto-deploys to Vercel Preview with dev DB.
  feature/* — one branch per feature, merged into dev via PR.
  hotfix/* — emergency fixes, merged into main + dev.

Release flow:
  feature/* → PR → dev → test on Preview → PR → main → git tag v*.*.* → production deploy

Environments:
  Production (main):  Prod Supabase (DATABASE_URL, DATABASE_URL_UNPOOLED)
  Preview (dev):      Dev Supabase (same env var names, different values in Vercel)
  Local:              Dev Supabase (.env + .env.local)

GitHub Actions:
  migrate-dev.yml    — prisma db push on dev DB (push to dev)
  migrate-prod.yml   — prisma db push on prod DB (on tag v*)
  backup.yml         — daily pg_dump of prod DB

Version tags: vMAJOR.MINOR.PATCH (e.g. v1.0.0)
```

Hard rules:
- NEVER commit directly to main — always PR from dev or hotfix/*
- NEVER use production DB locally — .env must point to dev DB
- NEVER merge a PR yourself — always open the PR, then ask the owner to merge. This applies to every PR including dev → main release PRs and feature → dev PRs
- Run `git add ...` and `git commit -m "..."` as **two separate Bash tool calls**, not chained with `&&`. The owner runs a `PreToolUse` hook (`~/.claude/hooks/review-staged.js`) that calls `git diff --cached` to review the staged change against this CLAUDE.md before each commit. Chained `add && commit` leaves the index empty at hook time, the hook logs `exit:empty-diff`, and the review never runs. Splitting the calls puts staging done before the commit Bash invocation so the hook actually reviews. Committing without a manual approval pause is fine — the hook is the safety net; if it finds issues it blocks the commit, otherwise the commit proceeds and the owner sees the result.
- Run `git push` as **its own Bash tool call** when any HEAD-mutating git command precedes it in the same chain (`commit`, `rebase`, `merge`, `reset`, `cherry-pick`, `revert`, `pull`, `am`). The push-review hook (`~/.claude/hooks/review-prepush.js`) computes the branch-vs-base diff from HEAD before the chain runs, so a chained `commit && push` would review pre-commit HEAD and miss the new commits — the hook auto-blocks these chains. Non-mutating chains like `git fetch && git push` or `git push && echo done` are fine.
- Always create a version tag for production releases
- Always include release notes when creating a tag (use `git tag -a` with annotation)

### Local review hooks

Two `PreToolUse` hooks (owner-level, in `~/.claude/hooks/`) review changes before they leave the machine:

- **Commit-time** — `review-staged.js`, Haiku 4.5, against `git diff --cached`. Fast hard-rule + bug/security check on the staged change. Bypass: include `[skip-review]` in the commit command.
- **Push-time** — `review-prepush.js`, Sonnet 4.6, against the full branch-vs-base diff (base picked from `.coderabbit.yaml` `auto_review.base_branches`). Mirrors `.coderabbit.yaml` focus areas so CodeRabbit-class findings (cross-file, N+1, layering) surface before push, not after the ~10-min PR-time wait. Chunks diffs >400KB per-file and reviews in parallel; skips entirely above 1.5MB and defers to CodeRabbit. Bypass: `SKIP_PUSH_REVIEW=1 git push` or `git push --no-verify`.

Both block on findings and on timeout; both degrade gracefully on infra failures (network/API down). Treat blocked output the same as a CodeRabbit comment — fix or argue, don't bypass on autopilot.

---

## Release Notes

See [README.md](./README.md#release-notes) for the full release history.

---

## Environment Variables

See `memory/prisma_config.md` for full env var reference.

---

## Additional Documentation (Session Memory)

Phase-specific roadmaps, monetization, strategies, and legal/ops details are stored in
session memory files. Claude Code loads these automatically. For manual reference:

- Prisma 7 config, env vars & commands → `memory/prisma_config.md`
- Schema table overview & folder structure → `memory/schema_design.md`
- Phase 1 roadmap & seed data → `memory/roadmap_phase1.md`
- Phase 2–3 roadmap → `memory/roadmap_phase2_3.md`
- Monetization & budget → `memory/monetization.md`
- Strategies (search, translation, comments, images, China) → `memory/strategies.md`
- Legal & operations → `memory/legal_ops.md`
- Current progress → `memory/project_progress.md`

Memory paths are relative to the Claude Code project memory directory.
