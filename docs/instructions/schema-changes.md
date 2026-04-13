# Schema Changes — Virtual Live Support

## Background

하스노소라 and 학원아이돌마스터 have two distinct live event types:

**Type A — 성우 라이브 (Voice Actress Live)**
- Real human VAs perform on a physical stage
- Examples: 하스노소라 4th Live, 5th Live, 6th Live, 학원아이마스 1st LIVE
- The fan sees the VA performing as the character

**Type B — Fes×LIVE (3DCG Virtual Live)**
- 3DCG characters perform in a virtual space
- VAs provide voice and motion capture, but are not visible on stage
- Examples: 하스노소라 Fes×LIVE (held quarterly), 학원아이마스 Fes×LIVE
- The fan sees the character on screen, not the VA

**Type C — Mixed (physical concert with virtual segment)**
- A physical concert that includes a virtual live segment
- Example: 하스노소라 5th Live Tokyo had a partial virtual live component
- Same Event contains both live_performance and virtual_live SetlistItems

---

## Required Changes

### 1. Update EventType enum

Add `virtual_live` to the existing `EventType` enum.

**Current:**
```prisma
enum EventType {
  concert
  festival
  fan_meeting
  showcase
}
```

**Updated:**
```prisma
enum EventType {
  concert        // 성우 라이브 — VAs perform on physical stage
  festival       // multi-artist festival (Animelo, 이차원 페스 etc.)
  fan_meeting    // 팬미팅
  showcase       // 쇼케이스
  virtual_live   // 3DCG/virtual live — characters perform (Fes×LIVE)
}
```

---

### 2. Add new SetlistItemPerformanceType enum

This is needed because a single Event can contain both physical and virtual
performances (mixed events like 하스노소라 5th Live Tokyo).

**Add this new enum:**
```prisma
enum SetlistItemPerformanceType {
  live_performance  // VA physically performs on stage (default)
  virtual_live      // 3DCG character performs (Fes×LIVE segment)
  video_playback    // pre-recorded video played on screen (opening videos etc.)
}
```

---

### 3. Add performanceType field to SetlistItem model

**Current SetlistItem:**
```prisma
model SetlistItem {
  id          BigInt               @id @default(autoincrement())
  eventId     BigInt
  position    Int
  isEncore    Boolean              @default(false)
  stageType   SetlistItemStageType @default(full_group)
  unitName    String?
  note        String?
  status      SetlistItemStatus    @default(confirmed)
  isDeleted   Boolean              @default(false)
  deletedAt   DateTime?
  createdAt   DateTime             @default(now())
  ...
}
```

**Updated SetlistItem — add one field after `status`:**
```prisma
model SetlistItem {
  id              BigInt                      @id @default(autoincrement())
  eventId         BigInt
  position        Int
  isEncore        Boolean                     @default(false)
  stageType       SetlistItemStageType        @default(full_group)
  unitName        String?
  note            String?
  status          SetlistItemStatus           @default(confirmed)
  performanceType SetlistItemPerformanceType  @default(live_performance)  // ← ADD THIS
  isDeleted       Boolean                     @default(false)
  deletedAt       DateTime?
  createdAt       DateTime                    @default(now())
  ...
}
```

---

## How realPersonId Behaves With These Changes

`SetlistItemMember.realPersonId` should ALWAYS be set when the VA is known,
regardless of whether the performance is live or virtual.

The VA does real work in a Fes×LIVE (voice + motion capture) so their
contribution should be recorded. The `performanceType` field on `SetlistItem`
is what tells you whether it was a physical or virtual performance — NOT the
presence or absence of `realPersonId`.

```
성우 라이브 SetlistItemMember:
  stageIdentityId → Kozue Otomari
  realPersonId    → Niina Hanamiya    ← VA on physical stage

Fes×LIVE SetlistItemMember:
  stageIdentityId → Kozue Otomari
  realPersonId    → Niina Hanamiya    ← VA did mocap (still record it)
  (SetlistItem.performanceType = virtual_live tells you it was virtual)

Unknown performer SetlistItemMember:
  stageIdentityId → some character
  realPersonId    → null              ← null ONLY when genuinely unknown
```

---

## Data Examples

### Example 1 — 하스노소라 4th Live Kobe Day 2 (성우 라이브)
```
Event:
  type: concert
  date: 2025-06-01

SetlistItem (position 4 — Hanamusubi):
  stageType:       unit
  performanceType: live_performance   ← physical stage
  unitName:        null (song is already credited to Cerise Bouquet)

SetlistItemMember:
  stageIdentityId → Kozue Otomari
  realPersonId    → Niina Hanamiya    ← VA physically on stage
  (+ other Cerise Bouquet members)
```

### Example 2 — 하스노소라 Fes×LIVE (3DCG virtual)
```
Event:
  type: virtual_live                  ← entire event is 3DCG
  date: (quarterly, various dates)

SetlistItem (position 1 — any song):
  stageType:       full_group
  performanceType: virtual_live       ← 3DCG character on screen

SetlistItemMember:
  stageIdentityId → Kozue Otomari
  realPersonId    → Niina Hanamiya    ← still record VA (did mocap)
```

### Example 3 — 하스노소라 5th Live Tokyo (mixed)
```
Event:
  type: concert                       ← physical concert overall
  date: 2025-10-04

SetlistItem (physical stage song):
  performanceType: live_performance   ← VA on stage
  → SetlistItemMember: realPersonId set

SetlistItem (virtual segment song):
  performanceType: virtual_live       ← 3DCG segment within concert
  → SetlistItemMember: realPersonId set (VA did mocap for this segment)
```

### Example 4 — 우마무스메 STARTING GATE (all virtual)
```
Event:
  type: virtual_live                  ← entire event is 3DCG
  date: (various)

All SetlistItems:
  performanceType: virtual_live

SetlistItemMember:
  stageIdentityId → (each Uma Musume character)
  realPersonId    → (corresponding VA — always record when known)
```

---

## UI Implications (for future reference)

- Event pages: show a "3DCG 라이브" badge when Event.type = virtual_live
- SetlistItem: show a small "3D" indicator when performanceType = virtual_live
- VA profile page: show performances split by type
  - "성우 라이브 출연: N회"
  - "Fes×LIVE 출연: N회"
- Both types should appear in "Niina Hanamiya가 공연한 곡" search results
  but with clear labeling

---

## Steps for ClaudeCode

1. Open `prisma/schema.prisma`
2. Add `virtual_live` to the `EventType` enum
3. Add the new `SetlistItemPerformanceType` enum (after the other enums,
   before the model definitions)
4. Add `performanceType SetlistItemPerformanceType @default(live_performance)`
   to the `SetlistItem` model (after the `status` field)
5. Run `npx prisma db push`
6. Run `npx prisma generate`
7. Verify with `npm run dev` and check /api/health still returns ok

---

## Change 2 — MC and Non-Song Setlist Entries

### Background

Real concert setlists include non-song entries such as:

```
pos 1  — Edelied                    (song)
pos 2  — AURORA FLOWER              (song)
pos 3  — MC                         (talk segment — between songs)
pos 4  — Hanamusubi                 (song)
pos 5  — Birdcage                   (song)
pos 6  — MC (유닛 코너 소개)          (talk segment — unit intro)
pos 7  — Joushou Kiryuu             (song)
pos 22 — Legato                     (song)
pos 23 — MC (앙코르 전 인사)          (talk segment — before encore)
pos 24 — DEEPNESS                   (encore)
```

Non-song entries have no `SetlistItemSong` rows — the junction table is
simply empty for those items.

### Why not use a fake "MC" Song row

Creating a placeholder Song row for MC entries would pollute the song table
and cause "MC" to appear in song search results. Non-song entries should be
first-class citizens with their own type.

---

### 4. Add new SetlistItemType enum

**Add this new enum** (alongside the other enums, before model definitions):

```prisma
enum SetlistItemType {
  song      // normal song performance (default)
  mc        // talk/MC segment
  video     // video playback (opening VTR, member introduction video etc.)
  interval  // intermission, stage setup break, costume change
}
```

---

### 5. Add type field to SetlistItem model

**Updated SetlistItem — add `type` field after `performanceType`:**

```prisma
model SetlistItem {
  id              BigInt                      @id @default(autoincrement())
  eventId         BigInt
  position        Int
  isEncore        Boolean                     @default(false)
  stageType       SetlistItemStageType        @default(full_group)
  unitName        String?
  note            String?
  status          SetlistItemStatus           @default(confirmed)
  performanceType SetlistItemPerformanceType  @default(live_performance)
  type            SetlistItemType             @default(song)  // ← ADD THIS
  isDeleted       Boolean                     @default(false)
  deletedAt       DateTime?
  createdAt       DateTime                    @default(now())
  ...
}
```

---

## How type field works with SetlistItemSong

When `type = song`:
- `SetlistItemSong` has one or more rows (normal song, or medley)
- All existing song/medley logic applies

When `type = mc`, `video`, or `interval`:
- `SetlistItemSong` has NO rows — junction table is empty for this item
- `SetlistItemMember` may or may not have rows depending on who was on stage
- `note` field captures what the MC/video/interval was about

```
MC example:
  SetlistItem:
    position: 3
    type:     mc
    note:     "유닛 코너 소개"
    stageType: full_group         ← all members on stage during MC
    (no SetlistItemSong rows)
    SetlistItemMember: (optional — record who was on stage)

Video example:
  SetlistItem:
    position: 1
    type:     video
    note:     "오프닝 VTR"
    stageType: full_group
    (no SetlistItemSong rows)
    (no SetlistItemMember rows — no one on stage)

Interval example:
  SetlistItem:
    position: 12
    type:     interval
    note:     "의상 교체"
    (no SetlistItemSong rows)
    (no SetlistItemMember rows)
```

---

## Data Examples — MC in Real Setlist

### 하스노소라 4th Live Kobe Day 2 (with MC entries)

```
SetlistItem pos 1:  type: song,     song: Edelied,         performanceType: live_performance
SetlistItem pos 2:  type: song,     song: AURORA FLOWER,   performanceType: live_performance
SetlistItem pos 3:  type: mc,       note: "오프닝 MC",      stageType: full_group
SetlistItem pos 4:  type: song,     song: Hanamusubi,      stageType: unit
SetlistItem pos 5:  type: song,     song: Birdcage,        stageType: unit
SetlistItem pos 6:  type: song,     song: Joushou Kiryuu,  stageType: unit
SetlistItem pos 7:  type: mc,       note: "유닛 코너 후 MC"
...
SetlistItem pos 22: type: song,     song: Legato,          isEncore: false
SetlistItem pos 23: type: mc,       note: "앙코르 전 인사"
SetlistItem pos 24: type: song,     song: DEEPNESS,        isEncore: true
```

---

## Query Examples

```sql
-- Get full setlist including MCs (for display)
SELECT * FROM SetlistItem
WHERE eventId = 123
ORDER BY position

-- Get only song performances (for song history, statistics)
SELECT si.* FROM SetlistItem si
WHERE si.eventId = 123
AND si.type = 'song'
ORDER BY si.position

-- Get all MC segments across all events (moderation/data quality)
SELECT si.*, e.date FROM SetlistItem si
JOIN Event e ON e.id = si.eventId
WHERE si.type = 'mc'
ORDER BY e.date DESC
```

---

## Updated Steps for ClaudeCode

Apply ALL of the following changes to `prisma/schema.prisma`:

1. Add `virtual_live` to the `EventType` enum
2. Add the new `SetlistItemPerformanceType` enum
3. Add the new `SetlistItemType` enum
4. Add `performanceType` field to `SetlistItem` model (after `status`)
5. Add `type` field to `SetlistItem` model (after `performanceType`)
6. Run `npx prisma db push`
7. Run `npx prisma generate`
8. Verify with `npm run dev` and check /api/health still returns ok

### Complete updated SetlistItem model for reference:

```prisma
model SetlistItem {
  id              BigInt                      @id @default(autoincrement())
  eventId         BigInt
  position        Int
  isEncore        Boolean                     @default(false)
  stageType       SetlistItemStageType        @default(full_group)
  unitName        String?
  note            String?
  status          SetlistItemStatus           @default(confirmed)
  performanceType SetlistItemPerformanceType  @default(live_performance)
  type            SetlistItemType             @default(song)
  isDeleted       Boolean                     @default(false)
  deletedAt       DateTime?
  createdAt       DateTime                    @default(now())

  event       Event                @relation(fields: [eventId], references: [id])
  songs       SetlistItemSong[]
  performers  SetlistItemMember[]

  @@unique([eventId, position])
  @@index([eventId])
  @@index([isDeleted])
}
```

### Complete list of new/updated enums for reference:

```prisma
// UPDATED — add virtual_live
enum EventType {
  concert
  festival
  fan_meeting
  showcase
  virtual_live
}

// NEW
enum SetlistItemPerformanceType {
  live_performance
  virtual_live
  video_playback
}

// NEW
enum SetlistItemType {
  song
  mc
  video
  interval
}
```
---

## Change 3 — Comment Type, Title, and BBS Post Rollup

### Background

The community system supports two distinct comment behaviors:

**type=comment (inline reaction):**
- Written directly on a Song/Event/SetlistItem page
- No title — short reaction to a specific entity
- Rollup ancestry computed automatically from the entity it was posted on
- Appears in the inline comment thread on that page
- Also appears in Artist/Group "공연반응" tab via rollup

**type=post (BBS post):**
- Written on an Artist/Group/EventSeries board (게시판)
- Has a title — standalone piece of content
- User optionally tags related Event/Song at write time
- Rollup computed from: (a) the board it was posted on + (b) any user-selected tags
- Appears in the BBS list view of the board
- Also appears as "관련 후기/글" section on tagged Event/Song pages

Both types use the SAME rollup ancestry arrays — the difference is how those
arrays get populated (auto vs user-tagged) and how the UI renders them.

---

### 6. Add CommentType enum

**Add this new enum** (alongside the other enums):

```prisma
enum CommentType {
  post     // BBS-style post — has title, written on Artist/Group/EventSeries board
  comment  // Inline reaction — no title, written on Song/Event/SetlistItem page
}
```

---

### 7. Add type and title fields to Comment model

**Add two fields to the Comment model:**

```prisma
model Comment {
  id            String      @id @default(uuid())
  userId        String
  parentId      String?

  type          CommentType @default(comment)  // ← ADD THIS
  title         String?                        // ← ADD THIS (type=post only)

  // posted at (exactly one set)
  setlistItemId String?
  songId        String?
  eventId       String?
  eventSeriesId String?
  artistId      String?
  groupId       String?

  // user-selected tags for type=post (optional, enables rollup to tagged entities)
  taggedEventId       String?   // ← ADD THIS
  taggedSongId        String?   // ← ADD THIS

  // roll-up ancestry — server-computed, immutable after creation
  rollupSongIds        String[]
  rollupEventIds       String[]
  rollupEventSeriesIds String[]
  rollupArtistIds      String[]
  rollupGroupIds       String[]
  rollupCategories     String[]

  content        String   @db.Text
  detectedLocale String   @default("ko")
  likeCount      Int      @default(0)
  isDeleted      Boolean  @default(false)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  ...
}
```

---

### How rollup is computed for each type

**type=comment** — fully automatic, based on posted-at entity:
```
Comment posted on SetlistItem (고베 Day2, pos.4 Hanamusubi):
  rollupSongIds        → [hanamusubi_id]
  rollupEventIds       → [고베Day2_id, 고베leg_id]
  rollupEventSeriesIds → [4thLive_id]
  rollupArtistIds      → [ceriseB_id, hasunosora_id]
  rollupGroupIds       → [lovelive_id]  (hasBoard=true only)
  rollupCategories     → ["anime"]
```

**type=post** — based on board posted on + optional user tags:
```
Post written on 蓮ノ空 Artist board,
  user tagged: Event = 고베 Day2

  rollupSongIds        → []  (no song tagged)
  rollupEventIds       → [고베Day2_id, 고베leg_id]  ← from taggedEventId
  rollupEventSeriesIds → [4thLive_id]               ← ancestor of tagged event
  rollupArtistIds      → [hasunosora_id]             ← from board posted on
  rollupGroupIds       → [lovelive_id]               ← ancestor of artist
  rollupCategories     → ["anime"]

Post written on 蓮ノ空 Artist board, no tags:
  rollupArtistIds      → [hasunosora_id]
  rollupGroupIds       → [lovelive_id]
  (everything else empty)
```

---

### Where each type can be written

```
type=comment:
  ✅ Song page
  ✅ Event page
  ✅ SetlistItem (inline on Event page)
  ✅ EventSeries page
  ❌ NOT on Artist/Group board (use type=post there)

type=post:
  ✅ Artist page (hasBoard=true)
  ✅ Group page (hasBoard=true)
  ✅ EventSeries page (hasBoard=true)
  ❌ NOT on Song/Event/SetlistItem page
```

---

### How pages display each type

**Song/Event/SetlistItem page:**
```
댓글 (89)                          ← type=comment only
  user_ko: 고베에서 이 곡 진짜 울었음
  user_ja: 最高でした
  ...
```

**Event page — combined view:**
```
📝 관련 후기/글 (3)                ← type=post, rolled up from board
  "4th Live 고베 직관 후기 + 사진"  ← has title, links to board post
  "고베 Day2 셋리스트 실시간 업데이트"
  ───────────────────────────────
💬 댓글 (89)                       ← type=comment, inline reactions
  user_ko: 앙코르 3곡 감동 ㅠㅠ
  ...
```

**Artist page — 게시판 tab:**
```
[BBS list — type=post, parentId=null, rollupArtistIds contains this artist]
  "4th Live 고베 직관 후기 + 사진"   ❤42  💬8
  "하스노소라 6th Live 예상 셋리스트" ❤31  💬15
  ...
```

**Artist page — 공연반응 tab:**
```
[Feed — type=comment, parentId=null, rollupArtistIds contains this artist]
  Hanamusubi @ 4th Live 고베 Day2    ← source label from rollup
  user_ko: 고베에서 이 곡 진짜 울었음
  ───
  DEEPNESS @ 4th Live 고베 Day2
  user_ja: 最高でした
  ...
```

---

### Query patterns

```sql
-- Artist BBS board list
SELECT * FROM Comment
WHERE type = 'post'
AND parentId IS NULL
AND 'hasunosora_id' = ANY(rollupArtistIds)
AND isDeleted = false
ORDER BY createdAt DESC

-- Artist 공연반응 feed (inline comments rolled up)
SELECT * FROM Comment
WHERE type = 'comment'
AND parentId IS NULL
AND 'hasunosora_id' = ANY(rollupArtistIds)
AND isDeleted = false
ORDER BY createdAt DESC

-- Event page: related posts (BBS posts that tagged this event)
SELECT * FROM Comment
WHERE type = 'post'
AND parentId IS NULL
AND 'kobe_day2_id' = ANY(rollupEventIds)
AND isDeleted = false
ORDER BY likeCount DESC

-- Event page: inline comments
SELECT * FROM Comment
WHERE type = 'comment'
AND eventId = 'kobe_day2_id'
AND parentId IS NULL
AND isDeleted = false
ORDER BY createdAt DESC
```

---

### BBS post write UI

```
[게시판 글쓰기 form]

제목: [4th Live 고베 직관 후기 + 사진        ]

관련 태그 (선택):
  이벤트: [4th Live 고베 Day2          ▾]   ← sets taggedEventId
  곡:     [검색...                     ▾]   ← sets taggedSongId

본문:
  [3시간 줄 서서 들어갔는데...]

[게시하기]
```

On submit:
1. Server saves taggedEventId / taggedSongId
2. Server traverses ancestry of tagged entities
3. Server computes all 6 rollup arrays
4. Arrays stored as immutable after creation

---

### Inline comment display — handling large comment counts

Comment volume on Song/Event pages determines display depth:

```
1–5 comments:    show all
6–20 comments:   show top 3 (by likeCount) + "N개 더 보기" expand button
21–100 comments: show top 3 + "댓글 N개 전체 보기 →" link to /comments page
100+ comments:   show top 3 as "🔥 인기 댓글" + link to /comments page
```

SetlistItem inline (within Event page) — always show max 3, link to full page:
```
  4  Hanamusubi    unit · Cerise B.
     💬 74개  ❤ 최고 127  [펼치기 ▾]
     ┌──────────────────────────────┐
     │ 🔥 user_ko: 고베에서 울었음 ❤127│
     │ 🔥 user_ja: 最高でした ❤89    │
     │ 🔥 user_ko2: 데뷔곡... ❤71    │
     │ ── 💬 71개 더 보기 → ──       │
     │ [댓글 입력...]                 │
     └──────────────────────────────┘
```

Full comments page URL: `/ko/songs/789/hanamusubi/comments`
  - Supports filter by event: shows only comments with specific rollupEventId
  - Useful: "Hanamusubi 댓글 중 고베 Day2 공연 관련만 보기"

---

## Updated Steps for ClaudeCode (all changes combined)

Apply ALL of the following changes to `prisma/schema.prisma`:

1. Add `virtual_live` to the `EventType` enum
2. Add the new `SetlistItemPerformanceType` enum
3. Add the new `SetlistItemType` enum
4. Add the new `CommentType` enum
5. Add `performanceType` field to `SetlistItem` model (after `status`)
6. Add `type` field to `SetlistItem` model (after `performanceType`)
7. Add `type CommentType @default(comment)` to `Comment` model (after `parentId`)
8. Add `title String?` to `Comment` model (after `type`)
9. Add `taggedEventId String?` to `Comment` model (after `groupId`)
10. Add `taggedSongId String?` to `Comment` model (after `taggedEventId`)
11. Run `npx prisma db push`
12. Run `npx prisma generate`
13. Verify with `npm run dev` and check /api/health still returns ok

---

## Complete reference — all new/updated enums

```prisma
// UPDATED — add virtual_live
enum EventType {
  concert
  festival
  fan_meeting
  showcase
  virtual_live
}

// NEW
enum SetlistItemPerformanceType {
  live_performance
  virtual_live
  video_playback
}

// NEW
enum SetlistItemType {
  song
  mc
  video
  interval
}

// NEW
enum CommentType {
  post     // BBS post — has title, written on board
  comment  // inline reaction — no title, written on entity page
}
```

## Complete reference — updated Comment model

```prisma
model Comment {
  id            String      @id @default(uuid())
  userId        String
  parentId      String?

  type          CommentType @default(comment)
  title         String?                        // type=post only; null for type=comment

  // posted at (exactly one set)
  setlistItemId String?
  songId        String?
  eventId       String?
  eventSeriesId String?
  artistId      String?
  groupId       String?

  // optional tags for type=post — enables rollup to tagged entities
  taggedEventId String?
  taggedSongId  String?

  // optional song tag for live-viewing comments (existing field, keep as-is)
  mentionedSongId String?

  // roll-up ancestry — server-computed, immutable after creation
  rollupSongIds        String[]
  rollupEventIds       String[]
  rollupEventSeriesIds String[]
  rollupArtistIds      String[]
  rollupGroupIds       String[]
  rollupCategories     String[]

  content        String   @db.Text
  detectedLocale String   @default("ko")
  likeCount      Int      @default(0)
  isDeleted      Boolean  @default(false)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  user           User                 @relation(fields: [userId], references: [id])
  parent         Comment?             @relation("CommentReplies", fields: [parentId], references: [id])
  replies        Comment[]            @relation("CommentReplies")
  translations   CommentTranslation[]
  likes          CommentLike[]
  edits          CommentEdit[]

  @@index([userId, createdAt])
  @@index([createdAt, isDeleted])
  @@index([rollupSongIds], type: Gin)
  @@index([rollupEventIds], type: Gin)
  @@index([rollupEventSeriesIds], type: Gin)
  @@index([rollupArtistIds], type: Gin)
  @@index([rollupGroupIds], type: Gin)
  @@index([rollupCategories], type: Gin)
}
```

---

## Change 4 — Translation System, User Dictionary, and Reporting

### Background

Three related systems discussed and finalized:

1. **Per-user known languages** — users declare which languages they can read,
   and translation buttons are only shown for languages they don't know.
2. **Community translation dictionary** — user-contributed overrides for
   character names, fandom terms, and abbreviations that translation APIs
   handle poorly.
3. **Reporting system** — for flagging hate speech, spam, misinformation,
   and bad dictionary entries.

---

## Part A — Per-User Known Languages

### Design principle

```
Show [번역보기] button only when:
  comment.detectedLocale NOT IN user.knownLocales

Examples:
  User knownLocales = ["ko", "ja", "en"]
  → Korean comment:  no button (can read)
  → Japanese comment: no button (can read)
  → English comment:  no button (can read)
  → Chinese comment:  [번역보기] shown
  → Taiwan comment:   [번역보기] shown

Unauthenticated users:
  → Use navigator.language from browser as fallback
  → Show button for all other languages
```

### User model changes

Add two fields to the existing `User` model:

```prisma
model User {
  // ... existing fields ...
  preferredLocale  String   @default("ko")

  // ADD THESE:
  knownLocales     String[] @default(["ko"])
  // Languages the user can read without translation.
  // Translation button is hidden for these languages.
  // Always includes preferredLocale. User can add more (e.g. ["ko","ja","en"])

  autoTranslate    Boolean  @default(false)
  // Phase 2 option: if true, auto-translate unknown-language comments
  // without requiring button click. Default false (lazy/on-demand).
}
```

### Translation button rendering logic

```typescript
function shouldShowTranslateButton(
  commentLocale: string,
  userKnownLocales: string[]
): boolean {
  // Never show button if locale unknown (detection failed)
  if (!commentLocale) return false
  // Never show button if user knows this language
  if (userKnownLocales.includes(commentLocale)) return false
  // Show button for all other languages
  return true
}

// autoTranslate mode (Phase 2):
// if user.autoTranslate === true AND shouldShowTranslateButton === true
// → fetch translation immediately on render, no button click needed
```

### Settings UI

```
프로필 설정 → 언어

내가 읽을 수 있는 언어:
  ✅ 한국어  (기본, 제거 불가)
  ✅ 日本語   [제거]
  ✅ English  [제거]
  ➕ 언어 추가...

번역 표시:
  ◉ 버튼 클릭 시 번역  (기본)
  ○ 모르는 언어 자동 번역  (Phase 2)

설명: 위 목록에 없는 언어로 작성된 댓글에만
[번역보기] 버튼이 표시됩니다.
```

### Translation display — after clicking translate

```
원문 (번역 후):
  [번역된 텍스트 표시]
  [원문 보기 ▾]   ← toggle to see original

이유: 번역이 어색할 때 원문 확인 가능.
     특히 캐릭터명/밈이 포함된 댓글에서 유용.
```

### detectedLocale accuracy note

Mixed-language comments (common in anime fandom) may have low detection
confidence. Store confidence score and handle gracefully:

```
"링크라에서 神戸公演 직관했는데 最高でした ㅠㅠ"
→ Could detect as "ko" or "ja" depending on tinyld

Handling:
  - If confidence < threshold: default to showing translate button
  - detectedLocale stored at write time, not re-computed on read
  - Future improvement: store detectedLocaleConfidence Float? on Comment
```

---

## Part B — Community Translation Dictionary

### Problem

Translation APIs fail on anime/game fandom content:

```
Failures:
  "링크라"     → should stay "링크라" (Link! Like! ラブライブ! abbrev.)
  "블루파"     → should stay "블루파" (Bloom Garden Party abbrev.)
  "직관"       → "direct observation" instead of "attended in person"
  "최애"       → "most favorite" instead of "oshi"
  "코즈에"     → may mistranslate character name
  "DOLLCHESTRA"→ may translate as "doll orchestra"
  "뇨호호"     → fandom expression, untranslatable — keep as-is
```

### New table: TranslationDictionary

```prisma
model TranslationDictionary {
  id          String       @id @default(uuid())
  sourceText  String
  // The exact string to match (case-insensitive).
  // Examples: "직관", "링크라", "코즈에", "DOLLCHESTRA"

  sourceLang  String
  // Language of the source text. "ko" | "ja" | "en" | "zh-CN" | "zh-TW"
  // Use "*" for language-agnostic terms (e.g. "DOLLCHESTRA" appears in any lang)

  targetText  String
  // Replacement text sent to translation API.
  // Examples:
  //   "직관" ko→en: "직접 관람(attended in person)"
  //   "링크라" *→*: "링크라"  ← preserve as-is
  //   "코즈에" *→*: "Kozue Otomari (小豆沢こずえ)"

  targetLang  String
  // Target language this entry applies to.
  // Use "*" for entries that should preserve the term in any target language.

  category    DictCategory
  isApproved  Boolean      @default(false)
  // false = only applied for the submitting user (trial)
  // true  = applied for all users

  createdBy   String       // userId
  approvedBy  String?      // admin userId
  useCount    Int          @default(0)
  createdAt   DateTime     @default(now())

  @@unique([sourceText, sourceLang, targetLang])
  @@index([sourceLang, isApproved])
}

enum DictCategory {
  character_name   // 캐릭터명: 코즈에, 스페셜위크
  song_title       // 곡 제목: 하나무스비, Birdcage
  event_name       // 이벤트명: 블루파, 이차원 페스
  fandom_term      // 팬덤 용어: 직관, 최애, 성우
  abbreviation     // 약칭: 링크라, 하스노소라→蓮ノ空
  meme             // 밈/유행어: 뇨호호
  preserve         // 번역하지 말고 그대로 유지
}
```

### Translation pipeline with dictionary

```
Step 1: Load approved dictionary entries for (sourceLang → targetLang)
Step 2: Apply pre-translation substitutions to comment text
        "링크라에서 직관했어요" 
        → "링크라[DICT_001]에서 직접관람[DICT_002]했어요"
Step 3: Send substituted text to Papago/DeepL
Step 4: Restore dictionary tokens in translated result
Step 5: Cache result in CommentTranslation
Step 6: On render, show "번역 개선 제안" link below translated text
```

### Dictionary approval flow

```
Anyone (logged in):     Submit new entry → status: pending
                        Applied only to submitter's own translations

Trusted user            Review and approve entries
(contributionCount 50+  Applied to all users after approval
or moderator):

Admin:                  Immediate approval, bulk management

Abuse:
  Any user can report a dictionary entry
  Reports go to moderation queue (see Part C)
  Approved entries with 3+ reports → auto-flagged for admin review
```

---

## Part C — Reporting System

### New tables: Report

```prisma
model Report {
  id          String       @id @default(uuid())
  reporterId  String
  targetType  ReportTarget
  targetId    String
  // ID of the reported item.
  // For comment/post: Comment.id
  // For dict entry: TranslationDictionary.id

  reason      ReportReason
  detail      String?      @db.Text  // optional free-text explanation
  status      ReportStatus @default(pending)
  resolvedBy  String?      // admin userId who handled it
  resolvedAt  DateTime?
  createdAt   DateTime     @default(now())

  reporter    User         @relation(fields: [reporterId], references: [id])

  @@index([status, createdAt])   // moderation queue: pending reports by time
  @@index([targetType, targetId]) // find all reports on a specific item
  @@index([reporterId])           // find all reports by a user
}

enum ReportTarget {
  comment      // type=comment or type=post
  dict_entry   // TranslationDictionary entry
}

enum ReportReason {
  hate_speech     // 혐오 발언 (nationality, language, race discrimination)
  harassment      // 특정 유저 괴롭힘
  spam            // 스팸/광고
  misinformation  // 오정보 (잘못된 셋리스트 데이터 포함)
  copyright       // 저작권 침해
  bad_translation // 의도적 오번역 (dict_entry only)
  other
}

enum ReportStatus {
  pending    // 검토 대기
  reviewed   // 검토 완료, 조치 없음
  actioned   // 조치 완료 (content hidden / dict entry revoked)
  dismissed  // 기각 (허위 신고)
}
```

### Auto-action thresholds

```
Comment/post:
  3 reports from different users → auto-hide pending review
  (isDeleted stays false, but hidden from public view)
  Admin reviews and either restores or confirms deletion

TranslationDictionary entry:
  3 reports → auto-revoke approval (back to pending)
  Admin reviews

Reporter abuse prevention:
  User with 5+ dismissed reports in 30 days → reports deprioritized
  (counted but not auto-actioned)
```

### Moderation queue UI (admin only)

```
/admin/reports

필터: 전체 | 대기중 | comment | dict_entry
정렬: 최신순 | 신고수순

┌─────────────────────────────────────────┐
│ 🚨 대기중 12건                           │
│                                         │
│ [혐오발언] user_xx · 3시간 전  신고 3건  │
│ "일본놈들은..." → [원문보기] [숨김] [무시]│
│                                         │
│ [오번역] "직관" → "spy" · 신고 2건       │
│ DictCategory: fandom_term               │
│ [승인취소] [수정] [무시]                 │
└─────────────────────────────────────────┘
```

---

## Summary of all schema changes in Change 4

### New tables (2)
```
TranslationDictionary   — community translation dictionary
Report                  — content and dictionary reporting
```

### New enums (4)
```
DictCategory    — character_name | song_title | event_name |
                  fandom_term | abbreviation | meme | preserve
ReportTarget    — comment | dict_entry
ReportReason    — hate_speech | harassment | spam |
                  misinformation | copyright | bad_translation | other
ReportStatus    — pending | reviewed | actioned | dismissed
```

### Modified models (1)
```
User:
  + knownLocales  String[]  @default(["ko"])
  + autoTranslate Boolean   @default(false)
```

---

## Updated master steps for ClaudeCode (all changes 1–4)

Apply ALL of the following changes to `prisma/schema.prisma`:

**SetlistItem changes:**
1. Add `virtual_live` to `EventType` enum
2. Add new `SetlistItemPerformanceType` enum
3. Add new `SetlistItemType` enum
4. Add `performanceType` field to `SetlistItem` (after `status`)
5. Add `type` field to `SetlistItem` (after `performanceType`)

**Comment changes:**
6. Add new `CommentType` enum
7. Add `type CommentType @default(comment)` to `Comment` (after `parentId`)
8. Add `title String?` to `Comment` (after `type`)
9. Add `taggedEventId String?` to `Comment` (after `groupId`)
10. Add `taggedSongId String?` to `Comment` (after `taggedEventId`)

**User changes:**
11. Add `knownLocales String[] @default(["ko"])` to `User`
12. Add `autoTranslate Boolean @default(false)` to `User`

**New tables:**
13. Add `TranslationDictionary` model
14. Add `Report` model

**New enums:**
15. Add `DictCategory` enum
16. Add `ReportTarget` enum
17. Add `ReportReason` enum
18. Add `ReportStatus` enum

**After schema changes:**
19. Run `npx prisma db push`
20. Run `npx prisma generate`
21. Verify with `npm run dev` and check /api/health still returns ok

---

## Change 5 — shortName for Display in UI

### Background

Full official names are too long for UI display in space-constrained contexts.
Fans never use the full name in practice:

```
ArtistTranslation.name = "蓮ノ空女学院スクールアイドルクラブ"
  → Too long for navbar, setlist performer labels, breadcrumbs
  → Fans say: "蓮ノ空" / "하스노소라"

EventSeriesTranslation.name = "蓮ノ空 6th Live Dream ～Bloom Garden Party～"
  → Too long for breadcrumbs, comment source labels
  → Fans say: "6th Live BGP"

EventTranslation.name = "Bloom Garden Party Stage／埼玉公演 Day1"
  → Fans say: "사이타마 Day1"

GroupTranslation.name = "Love Live! School idol project series"
  → Fans say: "러브라이브"
```

shortName is nullable — if not set, UI falls back to name automatically.

---

### Fields to add

Add `shortName String?` to the following four translation models:

```prisma
model ArtistTranslation {
  id        String  @id @default(uuid())
  artistId  BigInt
  locale    String
  name      String       // full official name
  shortName String?      // ← ADD: display name e.g. "蓮ノ空" / "하스노소라"
  bio       String?

  artist    Artist @relation(fields: [artistId], references: [id])
  @@unique([artistId, locale])
  @@index([artistId])
}

model EventSeriesTranslation {
  id            String      @id @default(uuid())
  eventSeriesId BigInt
  locale        String
  name          String       // full name
  shortName     String?      // ← ADD: e.g. "6th Live BGP"
  description   String?

  eventSeries   EventSeries @relation(fields: [eventSeriesId], references: [id])
  @@unique([eventSeriesId, locale])
  @@index([eventSeriesId])
}

model EventTranslation {
  id      String @id @default(uuid())
  eventId BigInt
  locale  String
  name    String       // full name
  shortName String?    // ← ADD: e.g. "사이타마 Day1" / "후쿠오카 Day2"

  event   Event  @relation(fields: [eventId], references: [id])
  @@unique([eventId, locale])
  @@index([eventId])
}

model GroupTranslation {
  id          String  @id @default(uuid())
  groupId     String
  locale      String
  name        String       // full name
  shortName   String?      // ← ADD: e.g. "러브라이브" / "아이마스"
  description String?

  group       Group   @relation(fields: [groupId], references: [id])
  @@unique([groupId, locale])
  @@index([groupId])
}
```

**NOT added to:**
```
SongTranslation         — song titles are already short, no need
StageIdentityTranslation — character names are already short, no need
AlbumTranslation        — album titles not displayed in space-constrained UI
RealPersonTranslation   — real person names are already short
```

---

### UI usage pattern

```typescript
// Single helper function — use everywhere
function displayName(
  translation: { name: string; shortName?: string | null },
  mode: 'short' | 'full' = 'short'
): string {
  if (mode === 'short') {
    return translation.shortName ?? translation.name
  }
  return translation.name
}
```

### Where each mode is used

```
shortName (mode='short') — space-constrained contexts:
  Navbar / breadcrumbs
  Setlist item performer label
    e.g. "Hanamusubi — Cerise Bouquet"  not  "Cerise Bouquet (蓮ノ空...)"
  Comment source label
    e.g. "Hanamusubi @ 사이타마 Day1"   not  "...Bloom Garden Party Stage Day1"
  Search result list
  Artist chip/badge on song page
  Event list rows

name (mode='full') — full name contexts:
  Artist detail page header (H1)
  EventSeries detail page header
  SEO meta title and og:title tags  ← always use full name for search engines
  Page <title> tag
  Official information sections
  Admin UI (always show full name to avoid confusion)
```

### Fallback behavior

```
shortName is nullable.
If shortName is null → displayName() returns name automatically.
No UI breakage if shortName is not populated.

Priority for data entry:
  1. Artists with long names (蓮ノ空, 学園アイドルマスター, etc.)
  2. EventSeries with long tour names
  3. Events (city + day is usually short enough already)
  4. Groups
```

### Search index

Both `name` and `shortName` should be indexed in Meilisearch:

```
"하스노소라" search → hits ArtistTranslation.shortName → returns 蓮ノ空 artist
"蓮ノ空" search    → hits ArtistTranslation.shortName → same result
"하스노소라학원"    → hits ArtistTranslation.name    → same result
```

---

### Example data

```
Artist: 蓮ノ空女学院スクールアイドルクラブ
  ko: name="하스노소라여학원스쿨아이돌클럽" shortName="하스노소라"
  ja: name="蓮ノ空女学院スクールアイドルクラブ" shortName="蓮ノ空"
  en: name="Hasunosora Girls' High School Idol Club" shortName="Hasunosora"

EventSeries: 6th Live Dream ～Bloom Garden Party～
  ko: name="하스노소라 6th Live Dream ～Bloom Garden Party～"
      shortName="6th Live BGP"
  ja: name="蓮ノ空 6th Live Dream ～Bloom Garden Party～"
      shortName="6th Live BGP"

Event: Bloom Garden Party Stage 사이타마 Day1
  ko: name="Bloom Garden Party Stage／埼玉公演 Day1"
      shortName="사이타마 Day1"
  ja: name="Bloom Garden Party Stage／埼玉公演 Day.1"
      shortName="埼玉 Day1"

Group: Love Live! series
  ko: name="러브 라이브! 시리즈" shortName="러브라이브"
  ja: name="ラブライブ！シリーズ" shortName="ラブライブ"
  en: name="Love Live! Series"  shortName="Love Live!"
```

---

## Updated master steps for ClaudeCode (all changes 1–5)

Apply ALL of the following changes to `prisma/schema.prisma`:

**SetlistItem changes:**
1. Add `virtual_live` to `EventType` enum
2. Add new `SetlistItemPerformanceType` enum
3. Add new `SetlistItemType` enum
4. Add `performanceType` field to `SetlistItem` (after `status`)
5. Add `type` field to `SetlistItem` (after `performanceType`)

**Comment changes:**
6. Add new `CommentType` enum
7. Add `type CommentType @default(comment)` to `Comment` (after `parentId`)
8. Add `title String?` to `Comment` (after `type`)
9. Add `taggedEventId String?` to `Comment` (after `groupId`)
10. Add `taggedSongId String?` to `Comment` (after `taggedEventId`)

**User changes:**
11. Add `knownLocales String[] @default(["ko"])` to `User`
12. Add `autoTranslate Boolean @default(false)` to `User`

**New tables:**
13. Add `TranslationDictionary` model
14. Add `Report` model

**New enums:**
15. Add `DictCategory` enum
16. Add `ReportTarget` enum
17. Add `ReportReason` enum
18. Add `ReportStatus` enum

**New moderation/governance tables:**
19. Add `UserRole` model
20. Add `RoleType` enum
21. Add `ScopeType` enum
22. Add `assignedScope String?` and `assignedScopeType ScopeType?` to `Report`

**shortName changes:**
23. Add `shortName String?` to `ArtistTranslation`
24. Add `shortName String?` to `EventSeriesTranslation`
25. Add `shortName String?` to `EventTranslation`
26. Add `shortName String?` to `GroupTranslation`

**After all schema changes:**
27. Run `npx prisma db push`
28. Run `npx prisma generate`
29. Verify with `npm run dev` and check /api/health still returns ok

---

## Change 6 — CSV Import & Image URL Strategy

### Background

Manual admin UI entry is too slow for bulk seed data.
Google Sheets → CSV → bulk import is the primary data entry method.
imageUrl fields exist in schema but are not implemented in Phase 1A.

---

### No schema changes required

This change is purely operational/UI:
- All imageUrl fields already exist in schema (nullable String?)
- CSV import is an admin UI feature, not a schema change
- imageUrl stays null in Phase 1A, populated in Phase 2 via R2

---

### CSV import feature (/admin/import)

**Supported CSV types:**
```
artists.csv       → Artist + ArtistTranslation rows
members.csv       → StageIdentity + RealPerson + RealPersonStageIdentity rows
songs.csv         → Song + SongTranslation + SongArtist rows
events.csv        → EventSeries + EventSeriesTranslation + Event + EventTranslation rows
setlistitems.csv  → SetlistItem + SetlistItemSong + SetlistItemMember rows
```

**Import behavior:**
```
upsert (not insert):
  → If row exists: update
  → If row doesn't exist: create
  → Safe to re-run after schema changes
  → Re-upload same CSV = idempotent
```

**Import order (dependency order):**
```
1. artists.csv      (no dependencies)
2. members.csv      (depends on artists)
3. songs.csv        (depends on artists)
4. events.csv       (depends on artists)
5. setlistitems.csv (depends on songs + events + members)
```

---

### CSV column specs

#### artists.csv
```csv
slug,type,parentArtist_slug,ja_name,ja_shortName,ko_name,ko_shortName,imageUrl
hasunosora,group,,蓮ノ空女学院スクールアイドルクラブ,蓮ノ空,하스노소라여학원스쿨아이돌클럽,하스노소라,
cerise-bouquet,unit,hasunosora,Cerise Bouquet,Cerise Bouquet,세리제 부케,세리제,
dollchestra,unit,hasunosora,DOLLCHESTRA,DOLLCHESTRA,돌체스트라,돌체스트라,
mira-cra-park,unit,hasunosora,Mira-Cra Park!,Mira-Cra Park!,미라크라 파크,미라크라,
```

Note: `slug` is a stable import identifier, distinct from URL slug.
Used as a human-readable foreign key in other CSVs.
Not stored in DB — used only during import to resolve relationships.

#### members.csv
```csv
character_slug,character_type,ja_name,ko_name,color,artist_slugs,va_slug,va_ja_name,va_ko_name,startDate,endDate
kaho,character,日野下花帆,히노시타 카호,#FF8FAB,hasunosora,yuii-nozomi,楡井希実,유이 노조미,,
sayaka,character,村野さやか,무라노 사야카,#7FC8E8,hasunosora cerise-bouquet,nonaka-kokona,野中ここな,노나카 코코나,,
rurino,character,大沢瑠璃乃,오오사와 루리노,#A8D8A8,hasunosora cerise-bouquet,suga-kanawa,菅叶和,스가 카나와,,
ginko,character,百生吟子,모모오 긴코,#DDA0DD,hasunosora dollchestra,sakurai-haruna,櫻井陽菜,사쿠라이 하루나,,
kozue,character,徒町小鈴,카치마치 코스즈,#98FB98,hasunosora cerise-bouquet dollchestra,hayama-fuka,葉山風花,하야마 후카,,
himeme,character,安養寺姫芽,안요지 히메메,#FFB6C1,hasunosora mira-cra-park,kurusu-rin,来栖りん,쿠루스 린,,
seras,character,セラス柳田リリエンフェルト,세라스 야나기다 릴리엔펠트,#B8860B,hasunosora mira-cra-park,miyake-miu,三宅美羽,미야케 미우,,
izumi,character,桂城泉,카츠라기 이즈미,#4169E1,hasunosora dollchestra mira-cra-park,shindo-amane,進藤あまね,신도 아마네,,
```

Note: `artist_slugs` is space-separated — character belongs to multiple units.

#### songs.csv
```csv
slug,originalTitle,artist_slug,releaseDate,variantLabel,baseVersion_slug,ja_title,ko_title,sourceNote
hanamusubi,ハナムスビ,hasunosora,2024-03-27,,,ハナムスビ,하나무스비,
deepness,DEEPNESS,hasunosora,2024-03-27,,,DEEPNESS,DEEPNESS,
dream-believers,Dream Believers,hasunosora,2024-06-26,,,Dream Believers,Dream Believers,
dream-believers-sakura,Dream Believers (SAKURA Ver.),hasunosora,,SAKURA Ver.,dream-believers,Dream Believers (SAKURA Ver.),Dream Believers (SAKURA Ver.),
birdcage,Birdcage,cerise-bouquet,2024-03-27,,,Birdcage,버드케이지,
```

#### events.csv
```csv
series_slug,series_ja_name,series_ja_shortName,series_ko_name,series_ko_shortName,series_type,event_slug,parentEvent_slug,event_type,date,venue,city,country,ja_name,ja_shortName,ko_name,ko_shortName
6th-bgp,蓮ノ空 6th Live Dream ～Bloom Garden Party～,6th Live BGP,하스노소라 6th Live Dream ～Bloom Garden Party～,6th Live BGP,concert_tour,6th-fukuoka-day1,,concert,2026-05-02,マリンメッセ福岡B館,福岡,JP,Bloom Stage 福岡公演 Day1,후쿠오카 Day1,Bloom Stage 후쿠오카 Day1,후쿠오카 Day1
6th-bgp,,,,,concert_tour,6th-fukuoka-day2,,concert,2026-05-03,マリンメッセ福岡B館,福岡,JP,Bloom Stage 福岡公演 Day2,후쿠오카 Day2,Bloom Stage 후쿠오카 Day2,후쿠오카 Day2
6th-bgp,,,,,concert_tour,6th-kobe-day1,,concert,2026-05-23,神戸ワールド記念ホール,神戸,JP,Garden Stage 兵庫公演 Day1,고베 Day1,Garden Stage 고베 Day1,고베 Day1
6th-bgp,,,,,concert_tour,6th-kobe-day2,,concert,2026-05-24,神戸ワールド記念ホール,神戸,JP,Garden Stage 兵庫公演 Day2,고베 Day2,Garden Stage 고베 Day2,고베 Day2
6th-bgp,,,,,concert_tour,6th-kanagawa-day1,,concert,2026-05-30,ぴあアリーナMM,横浜,JP,Party Stage 神奈川公演 Day1,가나가와 Day1,Party Stage 가나가와 Day1,가나가와 Day1
6th-bgp,,,,,concert_tour,6th-kanagawa-day2,,concert,2026-05-31,ぴあアリーナMM,横浜,JP,Party Stage 神奈川公演 Day2,가나가와 Day2,Party Stage 가나가와 Day2,가나가와 Day2
6th-bgp,,,,,concert_tour,6th-saitama-day1,,concert,2026-07-11,ベルーナドーム,所沢,JP,Bloom Garden Party Stage 埼玉公演 Day1,사이타마 Day1,BGP Stage 사이타마 Day1,사이타마 Day1
6th-bgp,,,,,concert_tour,6th-saitama-day2,,concert,2026-07-12,ベルーナドーム,所沢,JP,Bloom Garden Party Stage 埼玉公演 Day2,사이타마 Day2,BGP Stage 사이타마 Day2,사이타마 Day2
```

Note: series columns only need to be filled on first row of each series.
Subsequent rows with same series_slug reuse existing series.

#### setlistitems.csv
```csv
event_slug,position,song_slug,isEncore,itemType,performanceType,stageType,unitName,note,status,performers
6th-fukuoka-day1,1,hanamusubi,false,song,live_performance,unit,Cerise Bouquet,,confirmed,sayaka kozue rurino
6th-fukuoka-day1,2,deepness,false,song,live_performance,full_group,,,confirmed,kaho sayaka rurino ginko kozue himeme seras izumi
6th-fukuoka-day1,3,,false,mc,live_performance,full_group,,오프닝 MC,confirmed,
```

Note: `performers` is space-separated list of character_slugs.
Empty `song_slug` for mc/video/interval type items.

---

### imageUrl strategy

**Phase 1A (now):**
```
All imageUrl fields = null
UI renders color + initial letter avatar as fallback:

  StageIdentity.color exists → colored circle with character initial
  Artist/Group no color → gray circle with name initial

  function AvatarFallback({ name, color }) {
    return (
      <div style={{ backgroundColor: color ?? '#888' }}>
        {name[0]}
      </div>
    )
  }
```

**CSV columns:**
```
imageUrl column included in all CSV specs above
Left empty in Phase 1A
Populated in Phase 2 after R2 upload feature built
```

**Phase 2:**
```
1. Build image upload → Cloudflare R2
2. Upload images manually or via batch script
3. Update imageUrl in Google Sheets CSV
4. Re-upload CSV → upsert updates imageUrl only
```

---

### Google Sheets workflow

```
Master data lives in Google Sheets (not in DB):
  Tab: Artists
  Tab: Members
  Tab: Songs
  Tab: EventSeries + Events
  Tab: SetlistItems (per-event tabs or one big tab)

Workflow:
  1. Edit data in Google Sheets
  2. File → Download → CSV
  3. /admin/import → upload CSV
  4. Preview + validate
  5. Confirm import

Schema changes:
  prisma db push
  → Add new column to Google Sheets
  → Re-download CSV
  → Re-upload → upsert fills new column
  DB is always reconstructable from Sheets
```

---

## Updated master steps for ClaudeCode (all changes 1–6)

Apply ALL of the following changes to `prisma/schema.prisma`:

**SetlistItem changes:**
1. Add `virtual_live` to `EventType` enum
2. Add new `SetlistItemPerformanceType` enum
3. Add new `SetlistItemType` enum
4. Add `performanceType` field to `SetlistItem` (after `status`)
5. Add `type` field to `SetlistItem` (after `performanceType`)

**Comment changes:**
6. Add new `CommentType` enum
7. Add `type CommentType @default(comment)` to `Comment` (after `parentId`)
8. Add `title String?` to `Comment` (after `type`)
9. Add `taggedEventId String?` to `Comment` (after `groupId`)
10. Add `taggedSongId String?` to `Comment` (after `taggedEventId`)

**User changes:**
11. Add `knownLocales String[] @default(["ko"])` to `User`
12. Add `autoTranslate Boolean @default(false)` to `User`

**New tables:**
13. Add `TranslationDictionary` model
14. Add `Report` model
15. Add `UserRole` model

**New enums:**
16. Add `DictCategory` enum
17. Add `ReportTarget` enum
18. Add `ReportReason` enum
19. Add `ReportStatus` enum
20. Add `RoleType` enum
21. Add `ScopeType` enum

**Report changes:**
22. Add `assignedScope String?` to `Report`
23. Add `assignedScopeType ScopeType?` to `Report`

**shortName changes:**
24. Add `shortName String?` to `ArtistTranslation`
25. Add `shortName String?` to `EventSeriesTranslation`
26. Add `shortName String?` to `EventTranslation`
27. Add `shortName String?` to `GroupTranslation`

**After all schema changes:**
28. Run `npx prisma db push`
29. Run `npx prisma generate`
30. Verify with `npm run dev` and check /api/health still returns ok
