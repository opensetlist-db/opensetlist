# CLAUDE.md — OpenSetlist (opensetlist.com)

> Single source of truth for architectural and design decisions that apply across all phases.
> Phase-specific plans, progress, and strategies are in session memory (see bottom).

---

## Project Overview

**OpenSetlist** is a crowdsourced setlist database for anime, game, and Asian music live events.
Similar to setlist.fm but focused on East Asian content — Korean, Japanese, English, Chinese users.

- **Site:** opensetlist.com
- **Phase 1 target:** Korean users, anime/game music IPs
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
- Never hardcode text — always use i18n keys
- Store dates/times in UTC, convert on display
- Use Noto Sans self-hosted (supports all 4 languages) — never load from Google Fonts (China firewall)
- `lang` attribute on `<html>` must match locale

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

## Folder Structure

See `memory/schema_design.md` for the intended directory tree.

---

## Domain & Brand

- **Domain:** opensetlist.com (Namecheap, WHOIS privacy ON)
- **Email:** hello.opensetlist@gmail.com
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
- Always create a version tag for production releases
- Always include release notes when creating a tag (use `git tag -a` with annotation)

---

## Release Notes

### v0.3.0 (2026-04-15)
- 3-language UI support (Korean / Japanese / English) with LanguageSwitcher
- Privacy policy and terms of service pages (ko/ja/en)
- Footer component with privacy, terms, contact links
- Admin setlist builder: reorder (move up/down), insert-after, insert-at-beginning
- Admin setlist builder: artist names displayed in item rows
- Input validation on insert-after and swap API routes

### v0.2.0 (2026-04-14)
- English event translations
- Google Analytics 4 integration
- Personal info cleanup from public docs
- CodeRabbit automated review config

### v0.1.0 (2026-04-14)
- Initial production release
- Core read-only pages: Artist, Song, Event, EventSeries
- Admin UI with CSV import and setlist builder
- OG cards, SEO, sitemap
- Hasunosora seed data (224 songs)

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
