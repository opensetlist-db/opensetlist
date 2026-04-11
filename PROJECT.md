# PROJECT.md — OpenSetlist Development Plan

> This file is for Claude Code sessions.
> Read CLAUDE.md first for architecture decisions.
> Read schema-changes.md for pending schema changes.
> This file covers: current status, sprint plan, and operational procedures.

---

## Current Status (as of 2026-04-10)

```
✅ DONE:
  Infrastructure deployed (Vercel + Supabase + Cloudflare)
  Next.js 14 App Router initialized
  Prisma 7 configured (prisma.config.ts)
  Schema v9 pushed to Supabase
  DB connection verified (/api/health → { status: "ok", db: "connected" })
  Core public pages (Artist / Event / Song)
  Admin UI (CRUD for all entities)
  next-intl configured (/ko/ routing)

⚠️  KNOWN ISSUES TO FIX NOW:
  middleware.ts: localeDetection must be set to false
  → US visitors get redirected to /en/ → 404
  → Fix: set localeDetection: false in middleware.ts

⏳ NEXT:
  Schema changes from schema-changes.md (Changes 1–6)
  /admin/import CSV bulk import
  Data entry (Google Sheets → CSV)
  SEO / OG image cards
  DC인사이드 outreach
```

---

## Immediate Fix — middleware.ts

```typescript
// middleware.ts — apply this fix RIGHT NOW
import createMiddleware from 'next-intl/middleware'

export default createMiddleware({
  locales: ['ko'],
  defaultLocale: 'ko',
  localeDetection: false,  // ← ADD THIS — prevents redirect to /en/ 404
})

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)']
}
```

---

## Key Dates

```
TODAY:          2026-04-10
6th Live Start: 2026-05-02  Bloom Stage  후쿠오카  Day1  ← 22 days away
                2026-05-03  Bloom Stage  후쿠오카  Day2
                2026-05-23  Garden Stage 고베      Day1
                2026-05-24  Garden Stage 고베      Day2
                2026-05-30  Party Stage  가나가와  Day1
                2026-05-31  Party Stage  가나가와  Day2
                2026-07-11  BGP Stage    사이타마  Day1  ← FINAL
                2026-07-12  BGP Stage    사이타마  Day2  ← 91 days away
```

---

## Sprint Plan

### Sprint 1 — Read-only launch before 후쿠오카 (by 2026-05-01)

**Goal:** Site live with 6th Live data. Setlist updates go live after each show.

```
[ ] Fix middleware.ts localeDetection (immediate)
[ ] Apply schema-changes.md Changes 1–6 (db push + generate)
[ ] Build /admin/import CSV upload page
[ ] Prepare Google Sheets master data
[ ] Import Artists + Members (하스노소라 8명)
[ ] Import Songs (하스노소라 전곡)
[ ] Import 6th Live Events (8 events, status: upcoming)
[ ] Import existing setlists (5th Live or 4th Live as baseline)
[ ] OG image / Twitter card for Event pages
[ ] SEO meta tags (ja + ko titles)
[ ] Google Search Console — submit ja sitemap
[ ] DC인사이드 러브라이브 갤러리 outreach post
[ ] Test real-time setlist update flow (admin mobile)
[ ] Naver Search Advisor registration
```

**Success criteria:**
```
opensetlist.com/ko/events/[6th-fukuoka-day1] loads correctly
Twitter share shows OG card with event info
Admin can add SetlistItem in under 30 seconds
US visitor lands on /ko/ not 404
```

---

### Sprint 2 — Basic community before 가나가와 (by 2026-05-29)

**Goal:** Users can log in and comment on setlist pages.

```
[ ] NextAuth.js — Google + Kakao OAuth
[ ] User profile page (/ko/users/[id])
[ ] Comment system — type=comment (inline reactions)
    → Event page comment section
    → Song page comment section
    → SetlistItem inline expand/collapse
[ ] 1-level replies
[ ] Like (CommentLike)
[ ] Soft delete (isDeleted)
[ ] Comment display — volume-based truncation
    1–5:    show all
    6–20:   show top 3 + expand button
    21+:    show top 3 + link to /comments page
[ ] /ko/songs/[id]/comments full comments page
[ ] Basic spam protection (rate limiting)
[ ] detectedLocale on save (tinyld)
[ ] 번역보기 button (Papago API — ko↔ja)
    → CommentTranslation cache
    → user.knownLocales check
```

**Success criteria:**
```
Korean user can log in with Kakao and comment on 가나가와 Day1 setlist
Japanese text comment shows 번역보기 button for Korean user
After clicking, translation cached — no API call on refresh
```

---

### Sprint 3 — BBS boards + rollup before 사이타마 (by 2026-07-10)

**Goal:** Full community with BBS boards and rollup ancestry.

```
[ ] Comment type=post (BBS posts with title)
[ ] Artist/Group board page (BBS list view)
[ ] BBS post detail page
[ ] Comment rollup ancestry system
    → Server-side rollup computation at write time
    → 6 GIN-indexed arrays
    → Immutable after creation
[ ] Artist page — 게시판 tab + 공연반응 tab
[ ] EventSeries page — 게시판 tab + 공연반응 tab
[ ] taggedEventId / taggedSongId on BBS posts
    → "관련 후기/글" section on Event pages
[ ] Comment rollup feed with source labels
    "Hanamusubi @ 사이타마 Day1"
[ ] Report system (comment + dict_entry)
[ ] Auto-hide threshold (3 reports → hidden pending review)
[ ] Admin moderation queue (/admin/reports)
[ ] UserRole system (board_mod scope)
[ ] TranslationDictionary
    → User submission
    → Trusted user approval
    → Pre-translation substitution pipeline
```

**Success criteria:**
```
Fan posts 사이타마 직관 후기 on 蓮ノ空 board
→ Post appears on:
   蓮ノ空 게시판 tab
   사이타마 Day1 Event page "관련 후기/글" section
   6th Live BGP EventSeries 게시판

Japanese fan's comment on Song page
→ appears in 蓮ノ空 공연반응 tab with source label
→ 번역보기 shows for Korean user (zh-CN user too)
```

---

## Data Entry Workflow

### Google Sheets structure

```
Spreadsheet: "OpenSetlist Master Data"

Tab 1: Artists
  slug | type | parentArtist_slug | ja_name | ja_shortName | ko_name | ko_shortName | imageUrl

Tab 2: Members
  character_slug | character_type | ja_name | ko_name | color
  | artist_slugs (space-separated) | va_slug | va_ja_name | va_ko_name
  | startDate | endDate

Tab 3: Songs
  slug | originalTitle | artist_slug | releaseDate
  | variantLabel | baseVersion_slug | ja_title | ko_title | sourceNote | imageUrl

Tab 4: Events
  series_slug | series_ja_name | series_ja_shortName | series_ko_name | series_ko_shortName
  | series_type | event_slug | parentEvent_slug | event_type | date
  | venue | city | country | ja_name | ja_shortName | ko_name | ko_shortName

Tab 5: SetlistItems
  event_slug | position | song_slug | isEncore | itemType
  | performanceType | stageType | unitName | note | status
  | performers (space-separated character_slugs)
```

### Import order (always in this order)

```
1. artists.csv
2. members.csv
3. songs.csv
4. events.csv
5. setlistitems.csv
```

### Re-import after schema changes

```
1. npx prisma db push
2. npx prisma generate
3. Add new column(s) to Google Sheets
4. File → Download → CSV
5. /admin/import → upload → confirm
   (upsert: existing rows updated, new columns filled)
```

---

## Real-time Setlist Update Procedure

### On concert day

```
Before show:
  → Change Event.status: upcoming → ongoing
  → Open admin on mobile browser
  → Open Twitter/X: #蓮ノ空6thLive + venue hashtag

During show (real-time):
  → Watch Twitter realtime feed
  → Add SetlistItem as each song is performed
  → status: rumoured → live → confirmed
  → For MC: itemType=mc, note="brief description"

After show (within 30 min — golden window):
  → Verify full setlist against multiple sources
  → Fix any errors
  → Change Event.status: ongoing → completed
  → Post to DC인사이드 갤러리:
    "하스노소라 6th Live [공연명] 셋리스트 업데이트"
    + opensetlist.com/ko/events/[id] link
  → Post to @opensetlistdb Twitter

Next day:
  → Cross-reference Blu-ray/fan reports for corrections
  → Add any missed details (unitName, note fields)
```

### Speed target

```
One SetlistItem entry: under 30 seconds
Full 20-song setlist: under 10 minutes
```

If slower than this, fix the admin UI before 후쿠오카 Day1.

---

## SEO Strategy

### Target keywords

```
Korean:
  "하스노소라 6th 셋리스트"
  "하스노소라 [공연명] 선곡"
  "하나무스비 라이브"

Japanese:
  "蓮ノ空 6th Live セトリ"
  "蓮ノ空 [公演名] セットリスト"
  "ハナムスビ ライブ"
```

### Required meta tags per Event page

```html
<title>[shortName] 셋리스트 | OpenSetlist</title>
<meta name="description" content="..." />
<meta property="og:title" content="..." />
<meta property="og:description" content="..." />
<meta property="og:image" content="[OG card image]" />
<meta name="twitter:card" content="summary_large_image" />
```

### OG image spec

```
Size: 1200×630px
Content:
  🌸 [Artist shortName]
  [EventSeries shortName]
  [Event shortName] · [date]
  opensetlist.com

Generate dynamically via Next.js ImageResponse (/api/og)
or use static placeholder until Phase 2
```

---

## Outreach Plan

### DC인사이드 pre-launch (before 5/2)

```
Target galleries:
  러브라이브 갤러리
  하스노소라 갤러리 (if exists)

Post content:
  "6th Live 셋리스트 실시간 업데이트 예정입니다"
  "공연 직후 빠르게 업데이트하겠습니다"
  "유닛/멤버별 누가 어느 곡 불렀는지도 기록합니다"
  opensetlist.com 링크

Tone: 홍보 아닌 공지 — 갤러리에 기여하는 느낌으로
```

### Post-concert (after each show)

```
DC인사이드:
  "[공연명] 셋리스트 업데이트했습니다"
  + 링크

Twitter @opensetlistdb:
  "🌸 [공연명] セトリ更新しました / 셋리스트 업데이트"
  + 링크
  + #蓮ノ空6thLive 해시태그
```

---

## Developer Notes

### Background

- Operator: Chonhyon, California, USA
- Embedded C++ professional, JavaScript experience, Next.js App Router first project
- Solo developer
- Using Claude Code for implementation

### Development pace

```
Sustainable pace: 2hr/weekday, 4hr/weekend
Sprint 1 (22 days): pages + data — achievable at this pace
Sprint 2 (27 days): auth + comments — achievable
Sprint 3 (41 days): BBS + rollup — most complex, enough time
```

### Claude Code usage tips

```
Always provide context files at session start:
  CLAUDE.md         ← architecture decisions
  PROJECT.md        ← this file (current status + sprint plan)
  schema-changes.md ← pending schema changes

When starting new session:
  "Read CLAUDE.md, PROJECT.md, and schema-changes.md.
   Today I want to work on: [specific task]"

For schema changes:
  "Apply the changes listed in schema-changes.md Changes 1-6"
  → Claude Code will make all changes in one session

For new features:
  Reference the relevant section in CLAUDE.md for design decisions
  Don't re-explain — it's already documented
```

### Next.js App Router patterns used in this project

```
Route structure:
  /src/app/[locale]/               ← next-intl locale wrapper
  /src/app/[locale]/artists/[id]/[[...slug]]/page.tsx
  /src/app/[locale]/events/[id]/[[...slug]]/page.tsx
  /src/app/[locale]/songs/[id]/[[...slug]]/page.tsx
  /src/app/api/health/route.ts
  /src/app/admin/                  ← admin pages (no locale prefix)

Data fetching:
  Server Components fetch directly via Prisma (no API layer needed)
  Client Components use fetch() to API routes for mutations

Translation:
  getTranslation(entity, locale) helper → shortName ?? name fallback
  Translation button: shouldShowTranslateButton(detectedLocale, knownLocales)
```

---

## Phase Roadmap Summary

```
Phase 1A — Read-only (Sprint 1, by 5/2):
  Setlist database, no auth, no comments
  6th Live data live, real-time updates during shows

Phase 1B — Basic community (Sprint 2, by 5/30):
  Login (Google + Kakao)
  Inline comments on Song/Event pages
  Translation button (Papago)

Phase 2 — Full community (Sprint 3, by 7/11):
  BBS boards on Artist/Group pages
  Comment rollup ancestry (핵심 차별점)
  Translation dictionary
  Report system + moderation
  Kakao AdFit application
  CDJapan + Amazon affiliate (needs EIN)
  Google AdSense (needs EIN + Privacy Policy)

Phase 3 — Japanese UI (after 7/12):
  Japanese locale (/ja/)
  Meilisearch Cloud (replace pg_tsvector)
  Japanese community outreach (5ch, Togetter)
  Daily Meilisearch dump → R2 backup

Phase 4+ — Global:
  English UI
  Simplified Chinese + HK mirror
  Traditional Chinese (zh-TW)
```

---

## Pending Non-Schema Tasks

```
Legal:
  [ ] Privacy Policy (termly.io or iubenda — CCPA + GDPR + PIPA)
      → Required before AdSense
  [ ] EIN retrieval (IRS 1-800-829-4933, 7am–9am PT Tue–Thu)
      → Required for CDJapan, Amazon, AdSense affiliates

Monetization (after EIN):
  [ ] Kakao AdFit — adfit.kakao.com (Korean phone ready, no EIN needed)
  [ ] Google AdSense
  [ ] CDJapan affiliate — cdj.affiliate.net
  [ ] Amazon Associates US

Infrastructure:
  [ ] Upstash Redis (Phase 2 — caching)
  [ ] Cloudflare R2 (Phase 2 — image uploads)
  [ ] Meilisearch Cloud (Phase 3 — better search)

Social:
  [ ] Monitor @opensetlist Twitter handle (dead squatter, X process broken)
  [ ] GitHub org creation + repo transfer (low priority)
```
