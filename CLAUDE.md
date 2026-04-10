# CLAUDE.md — OpenSetlist (opensetlist.com)

> Single source of truth for all architectural, design, and development decisions.
> Keep this file updated as decisions are made or revised.
> When starting a new Claude Code session, read this file first.

---

## Project Overview

**OpenSetlist** is a crowdsourced setlist database for anime, game, and Asian music live events.
Similar to setlist.fm but focused on East Asian content — Korean, Japanese, English, Chinese users.

- **Site:** opensetlist.com
- **Phase 1 target:** Korean users, anime/game music IPs
- **Unique value:** Unit/member-level setlist detail that setlist.fm lacks entirely
- **Model:** Crowdsourced data + community discussion boards

---

## Current Status

```
✅ opensetlist.com registered (Namecheap, WHOIS privacy ON)
✅ hello.opensetlist@gmail.com created
✅ Google Search Console verified (DNS TXT record)
✅ Instagram @opensetlist registered
✅ Twitter/X @opensetlistdb registered
✅ GitHub repo: github.com/Chpark/opensetlist (private)
✅ Next.js 14 initialized (TypeScript, Tailwind, App Router, src/ dir)
✅ Prisma 7 configured (prisma.config.ts at root)
✅ Supabase PostgreSQL — all tables created and verified
✅ DB connection verified (/api/health → { status: "ok", db: "connected" })
✅ src/lib/prisma.ts singleton created
✅ Schema v9 finalized (core + community, with enums + GIN indexes + BigInt IDs)

⏳ Vercel — connect Chpark/opensetlist repo, add env vars
⏳ next-intl — i18n setup (/[locale]/ routing, Korean first)
⏳ Admin data entry UI — for Phase 1A seed data
⏳ Core public pages — Song, Event, Artist
⏳ Kakao AdFit application
⏳ EIN retrieval (IRS: 1-800-829-4933, 7am–9am PT Tue–Thu)
```

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
| Search | pg_tsvector → Meilisearch Cloud → self-hosted | See search strategy |
| Cache | Redis (Upstash Seoul) | Phase 2 |
| Images | Cloudflare R2 | Phase 2 — no self-hosted images in MVP |
| Hosting | Vercel (frontend) | Free tier |
| CDN | Cloudflare | Free |

---

## Prisma 7 Configuration

**Critical:** Prisma 7 moves DB connection out of schema.prisma.

### prisma.config.ts (project root)
```typescript
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
```

### .env / .env.local
```env
# Transaction pooler — Vercel serverless runtime (port 6543)
DATABASE_URL="postgresql://postgres.[ref]:[password]@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres"

# Session pooler — Prisma migrations (port 5432, IPv4 compatible)
DATABASE_URL_UNPOOLED="postgresql://postgres.[ref]:[password]@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres"
```

### prisma/schema.prisma
```prisma
datasource db {
  provider = "postgresql"
  // NO url or directUrl here — they live in prisma.config.ts
}
```

### src/lib/prisma.ts
```typescript
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

### Key Commands
```bash
# Use session pooler (port 5432) for migrations — NOT transaction pooler
npx prisma db push        # pushes schema to DB
npx prisma generate       # must run separately after db push (Prisma 7)
npx prisma studio         # visual DB browser
```

---

## Schema Design — Final v9 + Community v4

Full schema: `prisma/schema.prisma` (634 lines)

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
ArtistType         solo | group | unit | band
StageIdentityType  character | persona
EventSeriesType    concert_tour | festival | fan_meeting | one_time
EventType          concert | festival | fan_meeting | showcase
EventStatus        upcoming | ongoing | completed | cancelled
SetlistItemStageType  full_group | unit | solo | special
SetlistItemStatus  rumoured | live | confirmed
SongArtistRole     primary | featured | cover
AlbumType          single | album | ep | live_album | soundtrack
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

### Table Overview

#### Group layer
| Table | Purpose |
|---|---|
| `Group` | Flat tags: franchises, labels, agencies. `hasBoard` admin-controlled. `category` for anime/kpop etc. |
| `GroupTranslation` | Multilingual group names |
| `ArtistGroup` | N:N Artist ↔ Group |

#### Artist layer
| Table | Purpose |
|---|---|
| `Artist` | Performing entity. `parentArtistId` for sub-units. `hasBoard` default true. BigInt ID. |
| `ArtistTranslation` | Multilingual names |

#### Performer layer
| Table | Purpose |
|---|---|
| `StageIdentity` | Fan-facing name. `type`: character (anime) or persona (K-POP). Has `color`. |
| `StageIdentityTranslation` | Multilingual character/member names |
| `StageIdentityArtist` | N:N — Megumi → 蓮ノ空 + Mira-Cra Park! + KahoMegu♡Gelato |
| `RealPerson` | Actual human performer (VA for anime, same as persona for K-POP) |
| `RealPersonTranslation` | Multilingual real names |
| `RealPersonStageIdentity` | Time-aware N:N — VA changes (startDate/endDate), covers (note) |

#### Event layer
| Table | Purpose |
|---|---|
| `EventSeries` | Named series grouping events. `artistId` null for festivals. `parentSeriesId` for nesting. BigInt ID. |
| `EventSeriesTranslation` | Multilingual series names |
| `Event` | One concert date or leg-group container. `status` enum. `parentEventId` for leg grouping. BigInt ID. |
| `EventTranslation` | Multilingual event names |

#### Setlist layer
| Table | Purpose |
|---|---|
| `SetlistItem` | One performance slot. `stageType` + `status` enums. BigInt ID. |
| `SetlistItemSong` | N:N — medley support with `order` field |
| `SetlistItemMember` | Who performed — `stageIdentityId` always set, `realPersonId` optional |

#### Music layer
| Table | Purpose |
|---|---|
| `Song` | `baseVersionId` self-ref for variants. `variantLabel`. No direct artistId. BigInt ID. |
| `SongArtist` | N:N — collaboration support with `role` enum |
| `SongTranslation` | Multilingual song titles |
| `Album` | Type enum, labelName for per-release attribution |
| `AlbumTranslation` | Multilingual album titles |
| `AlbumTrack` | N:N — one song on multiple albums |

#### Community layer
| Table | Purpose |
|---|---|
| `User` | UUID ID. `preferredLocale`. `contributionCount`. Soft delete. |
| `Comment` | 6 roll-up arrays (GIN indexed). Immutable target + ancestry. |
| `CommentTranslation` | Lazy translation cache per targetLocale |
| `CommentLike` | Junction |
| `CommentEdit` | Append-only content edit audit trail |

### Key Design Decisions

**Sub-units as Artists** — Cerise Bouquet, DOLLCHESTRA, Mira-Cra Park! are `Artist` entries with `parentArtistId → 蓮ノ空`. Sub-unit membership implicit via `StageIdentityArtist`.

**Song variants** — "Dream Believers (SAKURA Ver.)" has `baseVersionId → "Dream Believers"` and `variantLabel: "SAKURA Ver."`.

**Medleys** — `SetlistItemSong` junction with `order`. No direct `songId` on `SetlistItem`.

**Collaborations** — `SongArtist` junction with `role`. "Link to the FUTURE" → three rows.

**Multi-artist events** — 이차원 페스 gets `EventSeries` with `artistId: null`, `organizerName: "Bandai Namco / Lantis"`.

**Event leg grouping** — `Event.parentEventId` self-ref. "Kobe Day 1" + "Kobe Day 2" share `parentEventId → "Kobe leg"`. Leg containers have `date: null`.

**VA changes** — `RealPersonStageIdentity` `startDate`/`endDate`. `SetlistItemMember.realPersonId` always explicit, never inferred from dates.

**Comment boards** — SetlistItem, Song, Event, EventSeries, Artist, Group (hasBoard=true). StageIdentity and RealPerson excluded by design (safety + redundancy).

**Comment roll-up** — 6 GIN-indexed arrays computed server-side at write time, immutable after creation. `rollupGroupIds` only includes groups where `hasBoard=true`.

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

## Search Strategy

```
Phase 1A: Supabase pg_tsvector
  → Free, built-in, zero infrastructure
  → Sufficient for Korean/Japanese basic search at early data volume

Phase 2: Meilisearch Cloud
  → Better multilingual quality (Japanese/Korean)
  → Managed service, no ops burden
  → Daily index dump → Cloudflare R2 backup

Phase 3: Self-hosted Meilisearch on Vultr Seoul ($6/mo)
  → Cost optimization when Meilisearch Cloud justifies it
  → Kuromoji (Japanese) + Jieba (Chinese) tokenizers
  → Minimize index fields (exclude notes, descriptions)
```

---

## Translation Strategy

**Lazy (user-requested) translation — NOT automatic.**

```
Default:  Show original comment in source language
UI:       "번역 보기" button visible on non-Korean comments
On click: Call translation API → cache in CommentTranslation → display
Benefit:  ~80% cost reduction vs auto-translating everything
```

**API priorities:**
- ko ↔ ja: Papago (best quality for this pair, verify free tier limits)
- others: DeepL
- ja → zh-CN: Tencent Cloud MT (Phase 3, better quality than DeepL for this pair)
- Fallback: Google Translate

**Language detection:** tinyld library — test accuracy on mixed ko/ja comments before launch.

---

## Comment System

### Boards
```
✅ SetlistItem, Song, Event, EventSeries, Artist, Group (hasBoard=true)
❌ StageIdentity, RealPerson, Album (excluded by design)
```

### Roll-up Ancestry (6 arrays)
Comment posted at any level appears on all ancestor boards:
```
rollupSongIds[]        — medley-aware (multiple songs per SetlistItem)
rollupEventIds[]       — leaf event + all ancestor events (any depth)
rollupEventSeriesIds[] — direct + all ancestor series (any depth)
rollupArtistIds[]      — direct + all parent artists (any depth)
rollupGroupIds[]       — hasBoard=true ONLY (admin-governed)
rollupCategories[]     — ["anime"] | ["kpop"] | ["jpop"]
```

Board query pattern (single table, GIN indexed):
```sql
WHERE 'hasunosora_id' = ANY(rollupArtistIds)
```

### Governance
- `rollupGroupIds` populated only from groups where `hasBoard=true` at write time
- Admin-only toggle for `hasBoard` — prevents unbounded board creation
- Auto-recommend hasBoard=true when comment volume exceeds threshold

### Integrity
- Target fields immutable after creation
- Ancestry fields immutable after creation (admin reindex job for corrections)
- Content editable by owner only → logged in `CommentEdit`
- Soft delete only (`isDeleted=true`, content → "[deleted]")

### Live Event Support
- `Event.status = ongoing` → activates real-time mode
- `SetlistItem.status = live` → currently being performed
- `SetlistItem.status = rumoured` → pre-event fan prediction
- `Comment.mentionedSongId` → optional song tag before SetlistItem exists
- Supabase Realtime subscriptions on SetlistItem + Comment (Phase 3)

---

## Image Policy

**MVP: No self-hosted images.**
```
imageUrl fields store external URLs pointing to official sources
No downloading or re-hosting of copyrighted images
```

**Phase 2:**
- User-contributed images with TOS ("you confirm rights to upload")
- All uploads → Cloudflare R2
- Liability shifts to user

**Phase 3:**
- Reach out to labels/agencies for formal image licenses
- CDJapan affiliate partner may allow product image use

---

## Seed Data Strategy

Focus on 3 IPs operator can personally validate for correctness.

### Target IPs

**Love Live! series** — μ's, Aqours, 니지가사키, Liella!, 하스노소라 (all lives)
- Korean community: DC인사이드 러브라이브 갤러리, Naver 러브라이브 팬 카페
- Tests: sub-units, VA changes, multi-leg tours, song variants, medleys, multi-artist events

**우마무스메** — STARTING GATE, 3rd EVENT, 4th EVENT, MAKE A NEW TRACK!!
- Korean community: DC인사이드 우마무스메 갤러리, 아라뱃 카페
- Tests: large cast of StageIdentities, VA-as-character, festival-style events

**학원아이돌마스터** — 1st LIVE "We're GakoMas!"
- Korean community: DC인사이드 아이돌마스터 갤러리
- Tests: new franchise, Idolmaster Group hierarchy, 이차원 페스 cross-reference

### Target Volume
~125 events, ~2500 setlist items at launch

### Data Sources (reference only — no automated scraping)
- namu.wiki — detailed Korean descriptions for all three IPs
- Fandom wiki (Love Live!, Uma Musume) — English structured data
- VGMdb — album/song data with release dates
- Twitter/X fan threads — setlist confirmation from attendees
- YouTube concert videos + comments

---

## Development Roadmap

### Phase 1A — Data Foundation (4–6 weeks)
**Goal:** Working site with seed data. No monetization, no user accounts, no comments.

#### Week 1–2: Infrastructure
- [ ] Vercel — connect Chpark/opensetlist, add env vars
- [ ] next-intl setup — /[locale]/ routing, Korean only
- [ ] Prisma db push + generate with final schema
- [ ] /api/health endpoint confirmed working

#### Week 2–3: Core Pages (read-only)
- [ ] Artist page — `/ko/artists/[id]/[slug]`
  - Artist name + bio
  - Sub-units list
  - Event history (EventSeries + Event list)
- [ ] Song page — `/ko/songs/[id]/[slug]`
  - Song info + translations
  - Performance history (which events, which position)
  - Variant list (SAKURA Ver. etc.)
- [ ] Event page — `/ko/events/[id]/[slug]`
  - Event info (venue, date, status)
  - Full setlist with unit/member info
  - EventSeries breadcrumb
- [ ] EventSeries page — `/ko/series/[id]/[slug]`
  - Series overview
  - All events list (grouped by leg if parentEventId exists)

#### Week 3–4: Search
- [ ] pg_tsvector full-text search setup
- [ ] Search page — `/ko/search?q=hanamusubi`
  - Results: Songs, Artists, Events

#### Week 4–6: Admin Data Entry
- [ ] Admin login (hardcoded credentials, NOT NextAuth yet)
- [ ] Admin pages: Create/Edit Artist, Song, Event, EventSeries
- [ ] SetlistItem entry form with:
  - Song selector (search/autocomplete)
  - StageIdentity multi-select for performers
  - stageType + unitName + note + status fields
- [ ] Seed all Love Live! Hasunosora lives (start here — operator knows best)
- [ ] Seed 우마무스메 lives
- [ ] Seed 학원아이돌마스터 1st Live

#### Pre-launch
- [ ] Privacy Policy (termly.io or iubenda — CCPA + GDPR + PIPA)
- [ ] Naver Webmaster Tools (HTML file in /public)
- [ ] DC인사이드 갤러리 outreach for all 3 IPs

---

### Phase 1B — Contribution System (2–4 weeks)
**Goal:** Let trusted users contribute data.

- [ ] NextAuth.js — Google + Kakao login
- [ ] User profile page
- [ ] Contribution form — propose new SetlistItem / edit existing
- [ ] Trust system:
  - New user: edits require admin approval
  - Trusted (10+ approved edits): auto-approved
  - Moderator: can approve/reject others
- [ ] Edit history — append-only log of all changes
- [ ] Top contributor badges + leaderboard
- [ ] Basic 2-level comments (no roll-up yet, just target entity)
- [ ] Meilisearch Cloud setup (replace pg_tsvector)
- [ ] Daily Meilisearch dump → Cloudflare R2 backup

---

### Phase 2 — Growth & Monetization (2–3 months)
**Goal:** Revenue + community features.

- [ ] Comment roll-up ancestry system (6 GIN-indexed arrays)
- [ ] "번역 보기" lazy translation button
  - Papago for ko↔ja
  - DeepL for others
  - Cache in CommentTranslation
- [ ] Spam protection (rate limit + profanity filter)
- [ ] Group.hasBoard auto-recommendation (comment volume threshold)
- [ ] Kakao AdFit — apply at adfit.kakao.com (Korean phone ready)
- [ ] Google AdSense — needs EIN + Privacy Policy
- [ ] CDJapan affiliate — cdj.affiliate.net (needs EIN)
- [ ] Amazon Associates US (covers JP + KR) — needs EIN
- [ ] Supabase Pro tier (~$25/mo when free tier strains)
- [ ] User image uploads with TOS → Cloudflare R2
- [ ] Japanese UI + Kuromoji search tokenizer

---

### Phase 3 — Global Expansion (3+ months)
**Goal:** Chinese + English market, live event features.

- [ ] English UI
- [ ] Simplified Chinese UI + Jieba tokenizer
- [ ] HK mirror (Alibaba Cloud HK, ~$15/mo)
- [ ] Baidu sitemap submission
- [ ] Bilibili community outreach
- [ ] Tencent Cloud MT for ja→zh-CN
- [ ] 百度联盟 ads for Chinese traffic
- [ ] Supabase Realtime (live event mode)
- [ ] Self-hosted Meilisearch on Vultr when cloud cost justifies
- [ ] Public API (read-only, rate-limited)

---

## Folder Structure

```
opensetlist/
├── prisma/
│   ├── schema.prisma          ← Final v9 schema (634 lines)
│   └── migrations/
├── prisma.config.ts           ← Prisma 7 config (DB URL here, not schema)
├── src/
│   ├── app/
│   │   ├── [locale]/          ← next-intl routing
│   │   │   ├── page.tsx       ← Home page
│   │   │   ├── artists/
│   │   │   │   └── [id]/
│   │   │   │       └── [[...slug]]/page.tsx
│   │   │   ├── songs/
│   │   │   │   └── [id]/
│   │   │   │       └── [[...slug]]/page.tsx
│   │   │   ├── events/
│   │   │   │   └── [id]/
│   │   │   │       └── [[...slug]]/page.tsx
│   │   │   ├── series/
│   │   │   │   └── [id]/
│   │   │   │       └── [[...slug]]/page.tsx
│   │   │   └── search/
│   │   │       └── page.tsx
│   │   ├── api/
│   │   │   ├── health/route.ts
│   │   │   └── admin/         ← Phase 1A admin endpoints
│   │   └── admin/             ← Admin UI (Phase 1A)
│   ├── generated/
│   │   └── prisma/            ← Prisma client output
│   ├── lib/
│   │   └── prisma.ts          ← Singleton client
│   ├── components/
│   ├── i18n/
│   │   └── messages/
│   │       └── ko.json
│   └── types/
└── .env.local
```

---

## Environment Variables

```env
# Database (Supabase)
DATABASE_URL="postgresql://postgres.[ref]:[pw]@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres"
DATABASE_URL_UNPOOLED="postgresql://postgres.[ref]:[pw]@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres"

# Auth (Phase 1B)
NEXTAUTH_URL="https://opensetlist.com"
NEXTAUTH_SECRET="..."
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
KAKAO_CLIENT_ID="..."
KAKAO_CLIENT_SECRET="..."

# Redis (Phase 2)
UPSTASH_REDIS_URL="..."
UPSTASH_REDIS_TOKEN="..."

# Cloudflare R2 (Phase 2)
R2_ACCOUNT_ID="..."
R2_ACCESS_KEY_ID="..."
R2_SECRET_ACCESS_KEY="..."
R2_BUCKET_NAME="opensetlist-media"

# Translation APIs (Phase 2)
PAPAGO_CLIENT_ID="..."
PAPAGO_CLIENT_SECRET="..."
DEEPL_API_KEY="..."

# Meilisearch (Phase 1B)
MEILISEARCH_HOST="..."
MEILISEARCH_API_KEY="..."

# Admin (Phase 1A — temporary)
ADMIN_PASSWORD="..."
```

---

## i18n Setup (next-intl)

```
/[locale]/... routing — locale prefix required on all pages
Korean (ko): launch
Japanese (ja): Phase 2
English (en): Phase 3
Chinese (zh-CN): Phase 3
```

Hard rules:
- Never hardcode text — always use i18n keys
- Store dates/times in UTC, convert on display
- Use Noto Sans self-hosted (supports all 4 languages)
- `lang` attribute on `<html>` must match locale

---

## Monetization

### Phase 2 — Ads
- **Kakao AdFit** — Korean users, apply at adfit.kakao.com, Korean phone + Kakao Bank ready
- **Google AdSense** — all users, needs EIN + Privacy Policy

### Phase 2 — Affiliate
- **CDJapan** — primary (Blu-ray, albums, goods) — needs EIN
- **Amazon Associates US** — secondary (covers JP + KR) — needs EIN
- Placement: Event pages (Blu-ray link), Album pages, Artist pages

### Phase 3 — China
- **百度联盟** — Chinese traffic via HK mirror

---

## Legal & Operations

### Operator Info
- Location: Sunnyvale, California, USA
- Korean phone: available (for Kakao AdFit)
- Kakao Bank: available (for Korean payments)
- EIN: pending retrieval (IRS 1-800-829-4933, 7am–9am PT Tue–Thu)

### Privacy Policy
Required before AdSense. Must cover CCPA + GDPR + PIPA.
Use termly.io or iubenda.com.

### Image Copyright
See Image Policy section above.
MVP: no self-hosted images.
Phase 2: user uploads with TOS → R2.

### Twitter/X Note
@opensetlist is a dead squatter account — X inactive request process broken post-2022.
Using @opensetlistdb as the official handle. Monitor @opensetlist for purge.

---

## Domain & Brand

- **Domain:** opensetlist.com (Namecheap, WHOIS privacy ON)
- **Email:** hello.opensetlist@gmail.com
- **"Open"** signals: free to access, open to contributions, community-built
- **Genre-neutral:** works for K-POP/J-POP expansion without rebrand

---

## Expert Feedback Summary

Two expert reviews received. Key validated points:
- Schema design: "excellent" — Translation pattern, roll-up ancestry, time-aware VA tracking, medley support
- Comment roll-up architecture: "truly excellent" (one reviewer)
- China/HK mirror strategy: "realistic and effective"
- CDJapan affiliate model: "perfect fit for the user base"

Key changes adopted from feedback:
- Phase 1A scope radically simplified (no ads, no Meilisearch, no i18n beyond Korean)
- Search: pg_tsvector → Meilisearch Cloud → self-hosted progression
- Translation: lazy (user-requested) not automatic
- Seed data: 3 operator-validated IPs (Love Live!, 우마무스메, 학원아이돌마스터)
- URL slugs: numeric ID canonical, decided now
- BigInt IDs for public-facing tables (Artist, Song, Event, EventSeries, SetlistItem)
- Soft delete (isDeleted + deletedAt) on core content tables
- Enums for all fixed-value string fields (type safety + DB constraints)
- GIN indexes on all roll-up array fields
- Meilisearch: daily R2 backup for disaster recovery
- Community pre-launch outreach on DC인사이드 갤러리 for all 3 IPs
