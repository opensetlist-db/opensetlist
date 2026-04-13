# CLAUDE.md — Anime/Game Setlist Site Project

> This file summarizes all architectural and design decisions made during the Claude planning session.

---

## Project Overview

A setlist database site focused on Japanese anime/game live events.
Similar to setlist.fm — users can search which live events a specific song was performed at.

- Phase 1 target: Korean users
- Future expansion: Japanese, English, Simplified Chinese

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| i18n | next-intl |
| Auth | NextAuth.js |
| ORM | Prisma 7 |
| Database | PostgreSQL (Supabase) |
| Cache | Redis (Upstash — free tier) |
| Search | Meilisearch (self-hosted on Vultr Seoul) |
| Hosting | Vercel (frontend) + Supabase (DB) |
| CDN | Cloudflare (free) |

---

## Hosting & Budget

- **Vultr Seoul region** — VPS $6/mo (~₩8,500), used for Meilisearch
- **Supabase** — start on free tier PostgreSQL
- **Vercel** — start on free tier for Next.js
- **Domain** — Gabia or Namecheap (~₩10,000–15,000/year)
- **Estimated monthly cost** — ~₩10,000–20,000 (within ₩15,000–50,000 budget)
- **Phase 3 addition: HK mirror** — Alibaba Cloud HK or Tencent Cloud HK (~$15/mo), makes site accessible in China without VPN, no ICP license required

---

## Internationalization (i18n) Design

### URL Structure
```
/ko/songs/잔혹한-천사의-테제
/ja/songs/残酷な天使のテーゼ
/en/songs/cruel-angel-thesis
/zh-CN/songs/残酷天使的行动纲领
```

### Phased Language Rollout
1. Korean (ko) — launch
2. Japanese (ja) — 6 months later
3. English (en) — 1 year later
4. Simplified Chinese (zh-CN) — 1.5 years later

### Translation Table Pattern
Instead of adding per-language columns, use separate `*Translation` tables.
Adding a new language only requires inserting new rows — no schema changes.

```prisma
model SongTranslation {
  id     String @id @default(uuid())
  songId String
  locale String  // "ko" | "ja" | "en" | "zh-CN"
  title  String
  song   Song   @relation(fields: [songId], references: [id])
  @@unique([songId, locale])
}
```

### Hard Rules (must follow from day one)
- Never hardcode text — always use i18n keys
- Store all dates/times in UTC, convert on display
- Use Noto Sans font — self-hosted, supports Korean, Japanese, Chinese, and English
- Include `/[locale]/` in all URL paths from the start
- Never load fonts from Google Fonts — self-host to avoid China firewall issues

---

## Core DB Schema (Prisma) — Final v9 + Community v4

The complete schema is in `prisma/schema.prisma` (520 lines).
See also: the ERD diagrams discussed with Claude.

### Design Principles
- All translatable entities have a `*Translation` table — new locales = new rows, no schema change
- No affiliate/external URL fields in MVP — added later when monetization strategy is clear
- Image URLs point to Cloudflare R2 only — no external image dependencies
- `hasBoard` flag on `Group`, `Artist`, `EventSeries` — admin-controlled, prevents unbounded board creation

---

### Core Tables

#### Group layer (above Artist)
| Table | Purpose |
|---|---|
| `Group` | Flat tagging — franchises, labels, agencies, series. `hasBoard` admin-controlled. `category`: "anime"\|"kpop"\|"jpop"\|"game" |
| `GroupTranslation` | Multilingual group names |
| `ArtistGroup` | N:N between Artist and Group — one artist can belong to multiple groups |

#### Artist layer
| Table | Purpose |
|---|---|
| `Artist` | Performing entity. `parentArtistId` self-references for sub-units. `type`: "solo"\|"group"\|"unit"\|"band". `hasBoard` default true |
| `ArtistTranslation` | Multilingual artist names |

#### Performer layer
| Table | Purpose |
|---|---|
| `StageIdentity` | The name fans identify performers by. `type`: "character" (anime) \| "persona" (K-POP). Has `color` for personal colors |
| `StageIdentityTranslation` | Multilingual character/member names |
| `StageIdentityArtist` | N:N — one StageIdentity can belong to multiple Artists (Megumi → 蓮ノ空, Mira-Cra Park!, KahoMegu♡Gelato) |
| `RealPerson` | The actual human performer — VA for anime, same as persona for K-POP |
| `RealPersonTranslation` | Multilingual real person names |
| `RealPersonStageIdentity` | Time-aware N:N — handles VA changes (`startDate`/`endDate`), one-day covers (`note`) |

#### Event layer
| Table | Purpose |
|---|---|
| `EventSeries` | Groups related events. `artistId` null for multi-artist festivals. `parentSeriesId` self-references for nested series. `hasBoard` admin-controlled |
| `EventSeriesTranslation` | Multilingual series names |
| `Event` | One concert date or leg-group container. `status`: "upcoming"\|"ongoing"\|"completed"\|"cancelled". `parentEventId` for leg grouping. `date` null for containers |
| `EventTranslation` | Multilingual event names |

#### Setlist layer
| Table | Purpose |
|---|---|
| `SetlistItem` | One performance slot. `stageType`: "full_group"\|"unit"\|"solo"\|"special". `status`: "rumoured"\|"live"\|"confirmed". `unitName` free text |
| `SetlistItemSong` | N:N — one item can contain multiple songs (medley support). Has `order` field |
| `SetlistItemMember` | Who performed — always has `stageIdentityId`, optional `realPersonId` (null if unknown) |

#### Music layer
| Table | Purpose |
|---|---|
| `Song` | No `artistId` — credits via `SongArtist`. `baseVersionId` self-references for variants. `variantLabel`: "SAKURA Ver." etc. `sourceNote` free text for edge cases |
| `SongArtist` | N:N — one song can be credited to multiple artists (collaboration). `role`: "primary"\|"featured"\|"cover" |
| `SongTranslation` | Multilingual song titles |
| `Album` | `type`: "single"\|"album"\|"ep"\|"live_album"\|"soundtrack". Has `labelName` (per-release label may differ) |
| `AlbumTranslation` | Multilingual album titles |
| `AlbumTrack` | N:N — one song can appear on multiple albums |

---

### Community Tables

| Table | Purpose |
|---|---|
| `User` | `preferredLocale` drives auto-translation display. `contributionCount` denormalized cache |
| `Comment` | See comment system design below |
| `CommentTranslation` | Cached auto-translation per `targetLocale`. `@@unique([commentId, targetLocale])` |
| `CommentLike` | Simple junction — `@@unique([commentId, userId])` |
| `CommentEdit` | Append-only audit trail — every content change logged here |

---

### Key Design Decisions

**Sub-units as Artists:**
Cerise Bouquet, DOLLCHESTRA, Mira-Cra Park! are all `Artist` entries with `parentArtistId → 蓮ノ空`.
Sub-unit membership is implicit from which songs they perform together via `SetlistItemMember`.

**Song variants:**
"Dream Believers (SAKURA Ver.)" has `baseVersionId → "Dream Believers"` and `variantLabel: "SAKURA Ver."`.

**Medleys:**
`SetlistItemSong` junction table with `order` field. `SetlistItem` has no direct `songId`.

**Collaborations:**
`SongArtist` junction with `role`. "Link to the FUTURE" → three SongArtist rows.

**Guest performers:**
Guests (e.g. Miyake Miu before joining as member) get a `Member`/`StageIdentity` row from day one.
Their 4th Live appearance is a normal `SetlistItemMember` row. No special guest handling needed.

**Multi-artist events:**
이차원 페스 gets an `EventSeries` with `artistId: null` and `organizerName: "Bandai Namco / Lantis"`.
Each performing artist gets their own `SetlistItem` rows under the same `Event`.

**EventSeries nesting:**
`EventSeries.parentSeriesId` self-references. "Animelo 2023" → parent: "Animelo Summer Live" brand.

**Event leg grouping:**
`Event.parentEventId` self-references. "Kobe Day 1" + "Kobe Day 2" share `parentEventId → "Kobe leg"`.
Leg container events have `date: null`.

**VA changes:**
`RealPersonStageIdentity` has `startDate`/`endDate` for time-aware VA tracking.
`SetlistItemMember.realPersonId` is always explicit — never inferred from dates.

---

## Search

**Phase 1A (MVP):** Supabase pg_tsvector — free, already in stack, sufficient for early data volume
**Phase 2:** Meilisearch Cloud — better quality for Japanese/Korean, managed service
**Phase 3:** Self-hosted Meilisearch on Vultr — cost optimization at scale

- **Searchable fields**: `original_title`, `translations.*.title`, `sourceNote`
- **Japanese tokenizer**: Kuromoji (Phase 2+)
- **Chinese tokenizer**: Jieba (Phase 3+)

**Meilisearch backup:** Daily automated dump → Cloudflare R2 (protects against VPS disk failure)

---

## Comment System

- **Style**: 2-level comments (YouTube/Namu Wiki style) — replies one level deep only
- **Placement**: bottom of each song page + bottom of each event page
- **Real-time**: none (refresh to see new comments) — upgradeable to Supabase Realtime later
- **Sorting**: newest first / most liked
- **Permissions**: login required to post, anyone can read

### Spam Prevention
- Rate limiting: Upstash Ratelimit (max 5 comments per minute per user)
- Profanity filter: `bad-words` library
- Report feature (future)

---

## Multilingual Comment Auto-Translation

### Translation API Strategy
| Use case | API |
|---|---|
| Korean ↔ Japanese | Papago API (best quality, 10,000 chars/month free) |
| All other languages | DeepL API (500,000 chars/month free) |

### Translation Flow
1. Detect language on comment submit (`tinyld` library)
2. If different from viewer's locale, check translation cache (`CommentTranslation`)
3. If no cache, call translation API and save to DB
4. Show translated text by default + "Show original" toggle in UI

---

## Ad Monetization

| Network | Target audience | Priority |
|---|---|---|
| Kakao AdFit | Korean users | 1st |
| Google AdSense | Global users (fallback) | 2nd |
| Naver GFA | After traffic grows | 3rd |
| 百度联盟 (Baidu Union) | Chinese users (Phase 3) | 4th |

### Google Dependency Warning for China
Google AdSense, Google Fonts, Google Analytics, and reCAPTCHA are all blocked in China.
For Chinese users, replace with:
- Ads: 百度联盟 (Baidu Union)
- Analytics: self-hosted Umami or 百度统计
- Fonts: self-hosted Noto Sans (do this from day one)
- CAPTCHA: Geetest (极验)

---

## Affiliate Monetization

Affiliate links are the highest-value monetization opportunity for this site because users
already have high purchase intent — someone who looked up an event's setlist is exactly
the person who would buy that concert's Blu-ray.

### Affiliate Programs
| Program | Commission | Best for |
|---|---|---|
| CDJapan | 3–8% | Blu-rays, CDs, merch — best fit |
| Amazon JP | 2–10% | Everything |
| Amazon KR | 2–6% | Korean users |
| Play-Asia | 5–7% | Games, physical media |
| Apple Music | ~$0.10–0.15/signup | Music streaming referrals |

### Placement Strategy
- **Event page**: "Buy this concert on Blu-ray" → CDJapan / Amazon JP affiliate link
- **Song page**: "Listen on" → Apple Music / Spotify referral
- **Upcoming events**: "Get tickets" → eplus / Lawson Ticket
- **Song tied to anime/game**: link to related manga, game, or streaming

### Schema Addition
```prisma
model Event {
  // ...existing fields...
  bluRayUrl  String?   // CDJapan or Amazon affiliate link
  ticketUrl  String?   // eplus / Lawson ticket link
  merchUrl   String?   // official merch store link
}
```

---

## China Strategy

### The Challenge
The Great Firewall blocks Vercel, Google services, and Cloudflare in China.
Chinese users can still access via VPN (common among anime fans), but proper support requires extra steps.

### Three-tier Approach

| Tier | Effort | When |
|---|---|---|
| Do nothing — VPN users only | Zero | Phase 1–2 |
| HK/SG mirror on Alibaba Cloud HK | Low (1–2 days, ~$15/mo) | Phase 3 |
| Full China hosting + ICP license | Very high (months, needs Chinese entity) | Only if Chinese traffic justifies it |

### Phase 3 China Tasks
- [ ] Deploy HK mirror on Alibaba Cloud HK or Tencent Cloud HK
- [ ] Self-host Noto Sans fonts (remove any Google Fonts dependency)
- [ ] Submit sitemap to Baidu for indexing
- [ ] Replace Google Analytics with self-hosted Umami
- [ ] Add 百度联盟 ads for Chinese traffic
- [ ] Outreach to Bilibili anime communities for organic traffic

### Bilibili is Key
Chinese anime fans are highly active on Bilibili. A single mention in a popular Bilibili
video about a Japanese concert can drive thousands of Chinese visitors. Prioritize Bilibili
community engagement over paid acquisition for the Chinese market.

---

## Revenue Estimates by Phase

| Phase | Monthly Visitors | Est. Monthly Revenue |
|---|---|---|
| Phase 1 — MVP (months 1–2) | 0–500 | ₩0–3,000 |
| Phase 2 — Crowdsourcing (months 3–5) | 1,000–5,000 | ₩3,000–37,000 |
| Phase 3 — Global (months 6–8) | 10,000–50,000 | ₩30,000–375,000 |
| Established (year 1–2) | 100,000–500,000 | ₩350,000–4,250,000 |

Affiliate revenue (CDJapan, Amazon JP) can match or exceed ad revenue at scale,
especially because setlist users have high purchase intent around concert Blu-rays and merch.

---

## Development Roadmap

### Phase 1A — Data Foundation (4–6 weeks)
Focus: get enough data to be useful before opening to public.
No monetization, no user accounts, no comments yet.

- [ ] Core CRUD pages — Artist, Song, Event, SetlistItem
- [ ] Basic pg_tsvector search (Supabase built-in — no Meilisearch yet)
- [ ] Read-only public pages (Korean UI only)
- [ ] Admin data entry interface
- [ ] Self-host Noto Sans fonts

**Seed data (operator-validated IPs):**
- [ ] Love Live! series — μ's, Aqours, 니지가사키, Liella!, 하스노소라 (all lives)
- [ ] 우마무스메 — STARTING GATE, 3rd/4th EVENT, MAKE A NEW TRACK!!
- [ ] 학원아이돌마스터 — 1st LIVE "We're GakoMas!"
- [ ] Target: ~125 events, ~2500 setlist items at launch

**Community pre-launch outreach:**
- [ ] DC인사이드 러브라이브 갤러리 — recruit early contributors
- [ ] DC인사이드 우마무스메 갤러리 — recruit early contributors
- [ ] DC인사이드 아이돌마스터 갤러리 — recruit early contributors
- [ ] Twitter/X @opensetlistdb — announce development

### Phase 1B — Contribution (2–4 weeks)
- [ ] NextAuth.js user login
- [ ] Simple contribution/edit form (setlist data)
- [ ] Trust system — new edits require approval, trusted users auto-approved
- [ ] Top contributor badges + leaderboard
- [ ] Basic 2-level comments (no roll-up yet)
- [ ] Meilisearch backup → Cloudflare R2 (daily automated dump)

### Phase 2 — Growth & Monetization (2–3 months)
- [ ] Meilisearch Cloud (replace pg_tsvector — better Japanese/Korean search)
- [ ] Lazy auto-translation — "번역 보기" button, cached on first request
- [ ] Comment roll-up ancestry system
- [ ] Edit history (Wikipedia-style)
- [ ] Spam protection (rate limit + profanity filter)
- [ ] Kakao AdFit + Google AdSense
- [ ] CDJapan + Amazon affiliate links
- [ ] Supabase Pro tier (when free tier shows strain)
- [ ] Group.hasBoard auto-recommendation (flag when comment volume > threshold)

### Phase 3 — Global Expansion (3+ months)
- [ ] Japanese UI + Kuromoji tokenizer
- [ ] English UI
- [ ] Simplified Chinese UI + Jieba tokenizer
- [ ] HK mirror deployment (Alibaba Cloud HK, ~$15/mo)
- [ ] Baidu sitemap submission
- [ ] Self-hosted Umami analytics
- [ ] 百度联盟 ads for Chinese traffic
- [ ] Bilibili community outreach
- [ ] Supabase Realtime comments (live event support)
- [ ] Tencent Cloud MT for ja→zh-CN translation quality
- [ ] Public API
- [ ] Self-hosted Meilisearch on Vultr (when Meilisearch Cloud cost justifies)

---

## Environment Variables (.env)

```env
# Database
DATABASE_URL="postgresql://..."

# Translation
DEEPL_API_KEY=""
PAPAGO_CLIENT_ID=""
PAPAGO_CLIENT_SECRET=""

# Search
MEILISEARCH_HOST="http://your-vultr-ip:7700"
MEILISEARCH_API_KEY=""

# Cache
UPSTASH_REDIS_URL=""
UPSTASH_REDIS_TOKEN=""

# Auth
NEXTAUTH_SECRET=""
NEXTAUTH_URL=""

# Ads
KAKAO_ADFIT_ID=""
GOOGLE_ADSENSE_ID=""
BAIDU_UNION_ID=""

# Affiliate
CDJA PAN_AFFILIATE_ID=""
AMAZON_JP_AFFILIATE_ID=""
AMAZON_KR_AFFILIATE_ID=""
```

---

## Recommended Folder Structure

```
/
├── app/
│   └── [locale]/           ← locale-based routing
│       ├── page.tsx
│       ├── songs/[id]/
│       └── events/[id]/
├── messages/
│   ├── ko.json
│   ├── ja.json
│   ├── en.json
│   └── zh-CN.json
├── public/
│   └── fonts/              ← self-hosted Noto Sans (no Google Fonts)
├── prisma/
│   └── schema.prisma
├── lib/
│   ├── translate.ts        ← Papago + DeepL logic
│   ├── search.ts           ← Meilisearch client
│   └── affiliate.ts        ← affiliate link helpers
└── CLAUDE.md               ← this file
```

---

*Generated from Claude conversation — 2026-04-07*

---

## Pre-Launch Checklist

Things to decide and set up before writing the first line of code.

### Priority Order
```
1. Legal / ToS + Privacy Policy     ← required for AdSense approval
2. Cold start data strategy         ← site is useless without data
3. Domain & branding                ← painful to change later
4. Analytics setup (Umami)          ← need data from day one
5. Community identification         ← know your early adopters
6. URL slug strategy                ← painful to change later
7. Image hosting (Cloudflare R2)    ← affects schema design
```

---

### 1. Legal & Copyright

**Setlist data** — setlists (the list of songs performed) are generally not copyrightable,
but some Japanese entertainment companies (Aniplex, Lantis, King Records) are aggressive
about fan content. Research their policies before launch.

**User-generated content** — Terms of Service must clarify that users are responsible for
submitted data accuracy, and that you can remove content at any time.

**Affiliate disclosure** — legally required in Korea, Japan, and most countries.
Add a visible label near all affiliate links (e.g. "이 링크는 제휴 링크입니다").

**Privacy Policy** — mandatory for AdSense approval, and legally required under:
- Korea: PIPA (개인정보보호법)
- Japan: APPI
- EU visitors: GDPR (cookie consent banner required)

**GDPR** — even without targeting Europe, European visitors trigger GDPR compliance obligations.
At minimum: cookie consent banner + privacy policy before launch.

---

### 2. Cold Start Data Strategy

A setlist site with no data is useless. Users won't contribute to an empty site.

**Seed data before launch** — focus on 3 IPs the operator knows well and can validate for correctness.

**Target IPs:**
- Love Live! series — μ's, Aqours, 니지가사키, Liella!, 하스노소라 (all lives)
  → Korean community: DC인사이드 러브라이브 갤러리, Naver 러브라이브 팬 카페
- 우마무스메 — STARTING GATE, 3rd/4th EVENT, MAKE A NEW TRACK!!
  → Korean community: DC인사이드 우마무스메 갤러리, 아라뱃 카페
- 학원아이돌마스터 — 1st LIVE "We're GakoMas!"
  → Korean community: DC인사이드 아이돌마스터 갤러리

**Target volume at launch:** ~125 events, ~2500 setlist items

**Why these three:**
- Operator can personally validate data correctness
- Korean communities are known and accessible for outreach
- Together they test almost every schema feature (sub-units, VA changes,
  multi-leg tours, medleys, multi-artist events, franchise hierarchy)
- setlist.fm has minimal unit/member detail for these IPs — clear value-add

**Data sources for seeding** (use as reference, not automated scraping):
- namu.wiki — very detailed for all three IPs, Korean descriptions
- Fandom wiki (Love Live!, Uma Musume) — English structured data
- VGMdb — album/song data with release dates
- Twitter/X fan threads — setlist confirmation from attendees
- YouTube concert videos and comments

**Crowdsourcing incentives** — users need a reason to contribute:
- Contribution count on user profiles
- "Top contributor" badges per event or artist
- "Verified by X users" status on setlists

---

### 3. Domain & Branding

- Use a **neutral English domain** — works for Korean, Japanese, and Chinese users equally
  (e.g. `anisetlist.com`, `livedb.net`, `animesetlist.com`)
- **Avoid artist/event names** in the domain — companies can issue DMCA-equivalent
  takedowns in Japan if your domain contains their trademark (e.g. "animelo", "lantis")
- **Register social accounts early** — Twitter/X, Instagram, Bilibili — even before launch,
  so the name isn't taken

---

### 4. Analytics (Umami — self-hosted)

Use **Umami** instead of Google Analytics:
- Open source and self-hosted
- GDPR compliant (no cookies by default)
- Works in China (unlike Google Analytics)
- Free

**Key metrics to track from day one:**
- Monthly active users per locale (`ko`, `ja`, `en`, `zh-CN`)
- Setlists submitted per week (crowdsourcing health indicator)
- Search queries with zero results (shows what data is missing)
- Bounce rate on song/event pages (shows whether content is useful)
- Affiliate link click-through rate per placement type

---

### 5. Community Identification

Traffic for a niche site comes from community, not SEO, especially early on.
Know where your users are before you launch.

| Region | Communities |
|---|---|
| Korea | DC인사이드 애니갤, 루리웹, Naver Cafe anime boards |
| Japan | Twitter/X anime circles, 5ch, Niconico |
| China | Bilibili, Weibo anime communities |
| Global | Reddit r/anime, r/japanesemusic |

**Build in public** — post progress updates in these communities before launch to
generate early interest and attract first contributors.

**Moderators** — recruit trusted community members early to help with data quality.
Think about how to reward them (badges, special roles, credit on the site).

---

### 6. URL Slug Strategy

Decide before building — painful to change once content is indexed by search engines.

**Option A — Numeric IDs** (simpler to implement)
```
/en/events/1234
/en/songs/5678
```

**Option B — Slugs** (better for SEO and sharing — recommended)
```
/en/events/animelo-summer-live-2023
/en/songs/cruel-angel-thesis
```

For multilingual slugs, use the original Japanese title slug for the canonical URL
and redirect locale-specific slugs to it:
```
/ja/songs/zankoku-na-tenshi-no-these   → canonical
/ko/songs/잔혹한-천사의-테제            → redirects to canonical
```

---

### 7. Image Hosting (Cloudflare R2)

Use **Cloudflare R2** for artist photos and event posters:
- Free for first 10GB storage + 1M requests/month
- No egress fees (unlike AWS S3)
- Global CDN built in
- Works well with Cloudflare (already in your stack)

Never link to external image sources — they break over time.

Schema addition for images:
```prisma
model Artist {
  // ...existing fields...
  imageUrl  String?   // Cloudflare R2 URL
}

model Event {
  // ...existing fields...
  posterUrl String?   // Cloudflare R2 URL
}
```

---

### 8. SEO (Search Engine Optimization)

SEO = making your site appear in search results on Google, Naver, Baidu, etc.
For a setlist site, good SEO means someone searching "Animelo 2023 setlist" finds your site for free.

**Must-haves before launch:**
- Server-side rendering (Next.js handles this by default — don't fetch setlist data client-side)
- Unique `<title>` and `<meta description>` per page
- Canonical URLs for multilingual pages (`<link rel="canonical">`)
- Submit sitemap to Google Search Console, Naver Webmaster, and Baidu (Phase 3)

**Open Graph tags** — when a setlist link is shared on Twitter/X or KakaoTalk,
it should show a preview card with event name, date, and song count.
This drives organic sharing significantly.

```html
<meta property="og:title" content="Animelo Summer Live 2023 Setlist" />
<meta property="og:description" content="42 songs performed · August 26–27, 2023" />
<meta property="og:image" content="https://r2.yoursite.com/events/animelo-2023-poster.jpg" />
```

**Structured data (JSON-LD)** — mark up event pages with `MusicEvent` schema.
Improves how Google displays your pages in search results. Not critical at launch
but worth adding in Phase 2.

**Naver SEO** — for Korean users, Naver search matters as much as Google.
Submit your sitemap to Naver Webmaster Tools and ensure pages are server-side rendered.

---

### 9. Moderation & Data Quality

**Duplicate events** — users will create "Animelo 2023" and "Animelo Summer Live 2023"
as separate entries. Solutions:
- Strict naming convention enforced at submission time
- Merge/redirect system for duplicate entries
- Admin review for new event creation

**Inaccurate setlists** — wrong song order, missing songs, wrong titles. Consider:
- "Verified" status once multiple users confirm a setlist
- Source field on SetlistItem (where did this data come from?)
- Easy edit + rollback via edit history (already planned)

**Vandalism** — less of a risk for a niche site, but edit history (already in Phase 2 plan)
covers this.

---

*Generated from Claude conversation — 2026-04-07*

---


---

## Comment System Design

### Comment Boards (where comments can be posted)
```
✅ SetlistItem   — specific song performance
✅ Song          — all performances of a song
✅ Event         — a specific concert date
✅ EventSeries   — an entire tour/festival series
✅ Artist        — artist discussion board
✅ Group         — franchise/label discussion (hasBoard=true only)
❌ StageIdentity — excluded (covered by Artist board)
❌ RealPerson    — excluded (real-person boards are a safety concern)
❌ Album         — excluded (discussion happens on Song pages)
```

### Roll-up Ancestry
A comment posted at the most specific level automatically appears at all parent levels.
All ancestry fields are server-computed at write time and immutable after creation.
Client NEVER sends ancestry fields — server resolves them from DB.

```
6 roll-up arrays (PostgreSQL native arrays, GIN-indexed):
  rollupSongIds[]        songs of setlist item (medley: multiple songs)
  rollupEventIds[]       leaf event + all ancestor events (any depth)
  rollupEventSeriesIds[] direct series + all ancestor series (any depth)
  rollupArtistIds[]      direct artists + all parent artists (any depth)
  rollupGroupIds[]       hasBoard=true groups only — admin-governed
  rollupCategories[]     ["anime"] | ["kpop"] | ["jpop"] etc.
```

Example: comment on "Hanamusubi" SetlistItem at 4th Live Kobe Day 2 appears on:
```
SetlistItem:    Hanamusubi @ Kobe Day 2
Song:           Hanamusubi
Event:          Kobe Day 2
Event:          Kobe leg (parent event)
EventSeries:    4th Live Dream ~Bloom~
Artist:         Cerise Bouquet
Artist:         蓮ノ空 (parent artist)
Group:          Love Live! series (hasBoard=true)
Category:       anime
```

### Board Governance
- `Group.hasBoard` — admin-only toggle. Prevents unbounded board creation from crowdsourced group additions.
- `Artist.hasBoard` — default true for most artists.
- `EventSeries.hasBoard` — default false, admin enables for major series.
- `rollupGroupIds` only includes groups where `hasBoard=true` at write time.
- If `hasBoard` is later enabled, a reindex job can backfill existing comments.

### Comment Integrity Rules
- **Target fields immutable** — users can never move a comment to a different entity.
- **Ancestry immutable** — computed once at write, never updated (except admin reindex).
- **Content editable** — by owner only, every change logged in `CommentEdit`.
- **Soft delete only** — `isDeleted=true`, content replaced with "[deleted]", row kept for reply thread integrity.
- **No hard deletes** — ensures roll-up queries always return consistent counts.

### Auto-translation
- Language detected at write time via `tinyld` library → stored in `detectedLocale`.
- Translation cached in `CommentTranslation` (`@@unique([commentId, targetLocale])`).
- First viewer triggers API call (Papago for ko↔ja, DeepL for others) → cached for all subsequent viewers.
- UI shows translated text by default + "Show original" toggle.

### Live Event Support (Use Case 3)
- `Event.status = "ongoing"` activates real-time mode in UI.
- `SetlistItem.status = "live"` marks song currently being performed.
- `SetlistItem.status = "rumoured"` for pre-event fan predictions.
- `Comment.mentionedSongId` — optional song tag for event-level comments during live viewing
  (before the SetlistItem row exists in DB).
- Supabase Realtime subscriptions on `SetlistItem` and `Comment` for live updates (Phase 3).

### CommentEdit — Audit Trail
Append-only table. Every content edit creates a new row:
```
CommentEdit: { oldContent, newContent, editedAt, userId }
```
- `Comment.content` always reflects current content.
- `CommentEdit` is the full immutable history.
- Moderators can view edit history to detect abuse.

---

## Future Feature: Album Data (Phase 2+)

Album information can be added per song without touching existing tables — fully additive.

### What It Enables
- Song page shows "originally released on [Single]" + "also appears on [OST, Best Album]"
- Album page shows full tracklist with links to each song's setlist history
- "Buy this album" affiliate link (CDJapan, Amazon JP) on every song and album page
- Live album links on event pages
- Additional SEO surface area (album/tracklist pages indexed by Google, Naver)

### Schema Addition (Phase 2)

```prisma
model Album {
  id           String    @id @default(uuid())
  artistId     String
  releaseDate  DateTime? @db.Date
  labelName    String?
  type         String    // "single" | "album" | "ep" | "live_album" | "soundtrack"
  cdJapanUrl   String?   // affiliate link
  amazonUrl    String?   // affiliate link
  imageUrl     String?   // Cloudflare R2 — album art

  artist       Artist    @relation(fields: [artistId], references: [id])
  translations AlbumTranslation[]
  tracks       AlbumTrack[]
}

model AlbumTranslation {
  id      String @id @default(uuid())
  albumId String
  locale  String
  title   String

  album   Album  @relation(fields: [albumId], references: [id])
  @@unique([albumId, locale])
}

// Many-to-many: one song can appear on multiple albums
model AlbumTrack {
  id          String @id @default(uuid())
  albumId     String
  songId      String
  trackNumber Int

  album       Album  @relation(fields: [albumId], references: [id])
  song        Song   @relation(fields: [songId], references: [id])
  @@unique([albumId, trackNumber])
}
```

### Key Design Decision
`AlbumTrack` is a junction table because one song can appear on many albums
(original single, best-of compilation, live album, OST). This is a many-to-many
relationship between `Song` and `Album`.

### Data Sources for Album Info
| Source | Notes |
|---|---|
| **VGMdb** (vgmdb.net) | Best fit — specialized in anime/game music, detailed tracklists and label info |
| **MusicBrainz** | Open music database, comprehensive for Japanese releases |
| **CDJapan product pages** | Accurate release info + direct affiliate link source |

VGMdb is the most valuable source for this niche — it covers exactly the anime/game
music space this site targets.

### Rollout Plan
```
Phase 1:   No album data — songs only
Phase 2:   Add Album + AlbumTranslation + AlbumTrack tables via prisma migrate
           Seed from VGMdb for the most popular songs
Phase 3+:  Album pages with affiliate links
           "Buy the album" button on song pages
           Live album links on event pages
```

---

## Stretch Goal: Expand Beyond Anime Music (K-POP, J-POP, C-POP)

setlist.fm has almost no traction in East Asia. The infrastructure being built already
supports this expansion — the main work is data, community, and branding, not code.

### How Much Carries Over
```
Already works as-is:
✅ Multilingual DB schema (ko/ja/en/zh-CN)
✅ Comment system + auto-translation
✅ Meilisearch multilingual search
✅ Crowdsourcing + edit history
✅ HK mirror for Chinese users
✅ Tour, Member, unit stage schema (designed in from the start)

Minor extension needed:
⚠️  Artist.genre field — add "kpop" | "jpop" | "cpop"
⚠️  New affiliate partners per market
⚠️  New ad networks per market

New thinking required:
🆕  Community strategy is different per genre
🆕  Data sourcing strategy changes
```

### Expansion Timeline
```
Phase 1–3:         Anime/game music — Korean, Japanese, English, Chinese users
Phase 4 (stretch): J-POP — natural overlap with anime music, same artists/events
Phase 5 (stretch): K-POP — new community strategy, much larger market
Phase 6 (stretch): C-POP + Southeast Asian pop
```

### New Affiliate Opportunities
| Platform | Market | Links |
|---|---|---|
| Melon (멜론) | Korea | K-POP streaming |
| Bugs (벅스) | Korea | K-POP streaming |
| Yes24 | Korea | Concert tickets, albums |
| Interpark | Korea | Concert tickets |
| LINE Music | Japan | J-POP streaming |
| mora | Japan | J-POP digital downloads (lossless) |
| Weverse Shop | Global | K-POP official merch |
| Makestar | Global | K-POP albums + fan projects |

### Domain Name Implication
A genre-specific domain like `anisetlist.com` closes the door on K-POP/J-POP expansion.
Chose a genre-neutral domain from the start if this stretch goal is likely.
Recommended: `livesetlist.com`, `encoredb.com`, `setlistdb.net`

---

## Revised Schema Design: Tour, Member, Unit Stages

Anime live events already have unit stages, sub-group performances, solo stages,
and multi-leg tours — identical complexity to K-POP concerts.
These are designed into the initial schema rather than added later.

### New Tables Added

| Table | Purpose |
|---|---|
| `Tour` | Groups multiple event dates under one tour/series |
| `TourTranslation` | Multilingual tour names |
| `Member` | Individual members of a group (idol, unit, vtuber) |
| `MemberTranslation` | Multilingual member stage names |
| `SetlistItemMember` | Which members performed each setlist item |

### SetlistItem Stage Types
```
"full_group"  → all members perform (default, no member rows needed)
"unit"        → named sub-unit (e.g. "Guilty Kiss", "EXO-CBX", "357")
"solo"        → single member solo stage
"special"     → guest, collaboration, or surprise stage
```

### Real-world Examples This Handles

**Anime (Love Live! concert):**
```
Event: Love Live! Sunshine!! WONDERFUL STORIES
  Setlist:
    pos 1  — "Mijuku DREAMER"        stageType: full_group (Aqours × 9)
    pos 8  — "Strawberry Trapper"    stageType: unit, unitName: "Guilty Kiss"
                                     performers: [Aida Rikako, Furihata Ai, Suzuki Aina]
    pos 14 — "Omoi yo Hitotsu ni"    stageType: solo
                                     performers: [Inami Anju]
```

**K-POP (EXO concert):**
```
Event: EXO Planet #5 – EXplOration
  Setlist:
    pos 1  — "Power"                 stageType: full_group (EXO × 9)
    pos 11 — "Sweet Lies"            stageType: unit, unitName: "EXO-CBX"
                                     performers: [Baekhyun, Xiumin, Chen]
    pos 15 — "Unfair"                stageType: solo
                                     performers: [D.O.]
```

**Multi-leg tour:**
```
Tour: Animelo Summer Live 2023
  Event: Day 1 — Saitama Super Arena, 2023-08-26
  Event: Day 2 — Saitama Super Arena, 2023-08-27

Tour: BTS World Tour – Love Yourself
  Event: Seoul Day 1 — Olympic Stadium, 2018-08-25
  Event: Seoul Day 2 — Olympic Stadium, 2018-08-26
  Event: Los Angeles — Rose Bowl, 2018-09-05
  Event: New York — Citi Field, 2018-10-06
```

### See schema.prisma for Full Code
The complete revised Prisma schema is in `prisma/schema.prisma`.

### Prisma 7 Configuration Notes
Prisma 7 (released Nov 2025) has breaking changes from v6:
- Database URL moved from `schema.prisma` to `prisma.config.ts`
- Generator requires custom `output` path — no longer generates into `node_modules`
- Provider changed from `"prisma-client-js"` to `"prisma-client"`
- `PrismaClient` requires a driver adapter (`@prisma/adapter-pg`)
- `db push` no longer runs `prisma generate` automatically — run it explicitly after

**prisma.config.ts** (root of project):
```typescript
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL_UNPOOLED"),
  },
});
```

**prisma/schema.prisma** generator block:
```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}
```

**PrismaClient instantiation** (src/lib/prisma.ts):
```typescript
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

**.env** (two separate URLs required):
```env
DATABASE_URL="...supabase.co:6543/postgres"          ← transaction pooler (Vercel runtime)
DATABASE_URL_UNPOOLED="...supabase.co:5432/postgres" ← direct connection (Prisma migrations)
```

---

## Domain & Brand: opensetlist.com ✅ CONFIRMED

### Domain
- **opensetlist.com** — registered on Namecheap or Porkbun (~$10–12/year)

### Why "OpenSetlist"
- "Open" signals free to access, open to contributions, community-built
- "Setlist" is unambiguous — exactly what the site is
- Works naturally in Korean (오픈), Japanese (オープン), English
- Future-proof for K-POP/J-POP expansion — genre neutral
- Natural fit for the public API in Phase 3 (`opensetlist.com/api/v1/`)
- Closest real-world parallel: OpenStreetMap — crowdsourced, free, community-owned

### Social Handle Plan
| Platform | Handle | Status |
|---|---|---|
| Twitter/X | @opensetlistdb | Permanent handle — @opensetlist inactive squatter, X inactive request process currently broken |
| Instagram | @opensetlist | Free — register immediately |
| Bilibili | @opensetlist | Free — register immediately |
| YouTube | @opensetlistdb | Working handle — @opensetlist taken by unrelated worship band (398 subs, barely active) |

### Twitter/X Handle Note
@opensetlist is registered by an inactive squatter (0 posts, no profile photo).
X inactive account request process is currently non-functional (broken since post-2022 ownership change).
@opensetlistdb is the permanent handle — consistent with how many known products operate (e.g. @NotionHQ, @LinearApp).
Monitor @opensetlist periodically — claim it if it ever becomes available via a future X account purge.

### Registration Order (do today)
```
1. opensetlist.com          ← most urgent
2. @opensetlist on Instagram
3. @opensetlist on Bilibili
4. @opensetlistdb on YouTube
5. Monitor @opensetlist periodically — claim if available in future X purge
```

---

## Operator Info & Legal Considerations

### Location
- Based in **California, USA**
- Has Korean phone number and Kakao Bank account (under real name)
- Has US bank account

### Payment Flow by Network
| Network | Currency | Payment Method |
|---|---|---|
| Google AdSense | USD | US bank account (ACH) |
| Amazon JP/KR affiliate | USD | US bank account |
| CDJapan affiliate | USD | PayPal |
| Kakao AdFit | KRW | Kakao Bank (direct) |
| Naver GFA | KRW | Kakao Bank (direct) |

### Tax (US / California)
- All site income (ads, affiliate) is taxable US federal + California state income
- Get a free **EIN** from irs.gov — use instead of SSN on all tax forms (W-9 etc.)
- Ad networks and affiliate programs send **1099-NEC** when annual income exceeds $600
- Set aside ~25–30% of site income for federal + CA state taxes
- All hosting/domain/tool expenses are **tax deductible** — keep records
- KRW income (AdFit, Naver) must be reported in USD at the exchange rate on date received

### Business Structure
| Structure | Cost | When |
|---|---|---|
| Sole proprietor | Free | Launch — fine to start |
| LLC | $70 + $800 CA franchise tax/year | Only after $800+/year profit |

Start as sole proprietor. Consider LLC when generating real revenue —
note California's $800 minimum annual franchise tax makes it only worthwhile above that threshold.

### Privacy Policy Requirements
Being CA-based means complying with both:
- **CCPA** (California Consumer Privacy Act) — California users
- **GDPR** — European visitors
- **PIPA** — Korean users

Use **Termly** (termly.io) or **iubenda** (iubenda.com) — both cover all three jurisdictions.
Must include: data collection disclosure, third-party sharing (ads/analytics), user deletion rights.

### Korean Services Access
Korean phone number and Kakao Bank account removes all workarounds:

```
Kakao AdFit:    ✅ Korean phone for verification, Kakao Bank for KRW payouts
Naver services: ✅ Korean phone for Naver account verification
Kakao account:  ✅ Full access with Korean phone
Bilibili:       ✅ Try Korean phone for verification
```

### Kakao AdFit Setup
```
1. adfit.kakao.com
2. Sign in with Kakao account (Korean phone verified)
3. Register opensetlist.com
4. Payment → Kakao Bank account number
5. Approval: 1–3 business days
```

### Full Setup Checklist
```
Immediate:
☐ Get EIN from irs.gov (free, ~5 minutes)
☐ Finish social accounts (Bilibili, YouTube, Twitter/X)
☐ Monitor @opensetlist on X periodically — claim if X purges inactive accounts

This week:
☐ Supabase (region: Northeast Asia / Seoul)
☐ Vercel
☐ Vultr Seoul region
☐ Upstash Redis (region: Seoul)
☐ GitHub repository (private for now)
☐ Kakao AdFit application
☐ Naver Webmaster Tools (searchadvisor.naver.com)

Before monetization:
☐ Privacy policy via Termly or iubenda (CCPA + GDPR + PIPA)
☐ CDJapan affiliate application
☐ Amazon Associates US (covers JP + KR links)
☐ Google AdSense application (after site has content)
☐ W-9 form ready for tax verification on monetization platforms
```
