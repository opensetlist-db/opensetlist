# schema-additions.md — Prisma Code Blocks for schema-changes.md

> This file contains the complete Prisma code for all changes described
> in schema-changes.md. Apply these directly to prisma/schema.prisma.
> After all changes: npx prisma db push && npx prisma generate

---

## Updated Enums

### EventType (UPDATED — add virtual_live)

```prisma
enum EventType {
  concert        // 성우 라이브 — VAs perform on physical stage
  festival       // multi-artist festival (Animelo, 이차원 페스 etc.)
  fan_meeting    // 팬미팅
  showcase       // 쇼케이스
  virtual_live   // 3DCG/virtual live — characters perform (Fes×LIVE)
}
```

### SetlistItemPerformanceType (NEW)

```prisma
enum SetlistItemPerformanceType {
  live_performance  // VA physically performs on stage (default)
  virtual_live      // 3DCG character performs (Fes×LIVE segment)
  video_playback    // pre-recorded video played on screen
}
```

### SetlistItemType (NEW)

```prisma
enum SetlistItemType {
  song      // normal song performance (default)
  mc        // talk/MC segment
  video     // video playback (opening VTR, member intro video etc.)
  interval  // intermission, stage setup break, costume change
}
```

### CommentType (NEW)

```prisma
enum CommentType {
  post     // BBS-style post — has title, written on Artist/Group/EventSeries board
  comment  // inline reaction — no title, written on Song/Event/SetlistItem page
}
```

### DictCategory (NEW)

```prisma
enum DictCategory {
  character_name   // 캐릭터명: 코즈에, 스페셜위크
  song_title       // 곡 제목: 하나무스비, Birdcage
  event_name       // 이벤트명: 블루파, 이차원 페스
  fandom_term      // 팬덤 용어: 직관, 최애, 성우
  abbreviation     // 약칭: 링크라, 하스노소라
  meme             // 밈/유행어: 뇨호호
  preserve         // do not translate — keep as-is
}
```

### ReportTarget (NEW)

```prisma
enum ReportTarget {
  comment      // Comment (type=comment or type=post)
  dict_entry   // TranslationDictionary entry
}
```

### ReportReason (NEW)

```prisma
enum ReportReason {
  hate_speech     // 혐오 발언 (nationality, language, race discrimination)
  harassment      // 특정 유저 괴롭힘
  spam            // 스팸/광고
  misinformation  // 오정보 (잘못된 셋리스트 데이터 포함)
  copyright       // 저작권 침해
  bad_translation // 의도적 오번역 (dict_entry only)
  other
}
```

### ReportStatus (NEW)

```prisma
enum ReportStatus {
  pending    // 검토 대기
  reviewed   // 검토 완료, 조치 없음
  actioned   // 조치 완료 (content hidden / dict entry revoked)
  dismissed  // 기각 (허위 신고)
}
```

### RoleType (NEW)

```prisma
enum RoleType {
  superadmin  // site owner — all permissions
  admin       // global admin — can handle all reports, ban users
  board_mod   // local moderator — specific Artist or Group board only
  trusted     // trusted contributor — can approve dictionary entries
}
```

### ScopeType (NEW)

```prisma
enum ScopeType {
  artist  // scoped to a specific Artist (and its sub-units)
  group   // scoped to a specific Group (and all its Artists)
}
```

---

## Updated Models

### SetlistItem (UPDATED — add performanceType and type)

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

  event       Event               @relation(fields: [eventId], references: [id])
  songs       SetlistItemSong[]
  performers  SetlistItemMember[]

  @@unique([eventId, position])
  @@index([eventId])
  @@index([isDeleted])
}
```

### Comment (UPDATED — add type, title, taggedEventId, taggedSongId)

```prisma
model Comment {
  id            String      @id @default(uuid())
  userId        String
  parentId      String?

  type          CommentType @default(comment)
  title         String?
  // type=post:    title required — shown in BBS list
  // type=comment: title null — inline reaction only
  // parentId!=null (replies): title always null

  // posted at (exactly one set)
  setlistItemId String?
  songId        String?
  eventId       String?
  eventSeriesId String?
  artistId      String?
  groupId       String?

  // optional tags for type=post — enables rollup to tagged entities
  taggedEventId   String?
  taggedSongId    String?

  // optional song tag for live-viewing comments
  mentionedSongId String?

  // roll-up ancestry — server-computed, immutable after creation
  rollupSongIds        String[]
  rollupEventIds       String[]
  rollupEventSeriesIds String[]
  rollupArtistIds      String[]
  rollupGroupIds       String[]   // hasBoard=true groups only
  rollupCategories     String[]   // ["anime"] ["kpop"] etc.

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

### User (UPDATED — add knownLocales, autoTranslate, roles relation)

```prisma
model User {
  id                String     @id @default(uuid())
  email             String     @unique
  name              String
  avatarUrl         String?
  preferredLocale   String     @default("ko")
  knownLocales      String[]   @default(["ko"])
  // Languages the user can read without translation.
  // Translation button hidden for these locales.
  // Always includes preferredLocale.
  autoTranslate     Boolean    @default(false)
  // Phase 2: if true, auto-translate unknown-language comments on render
  contributionCount Int        @default(0)
  isDeleted         Boolean    @default(false)
  deletedAt         DateTime?
  createdAt         DateTime   @default(now())

  comments          Comment[]
  commentLikes      CommentLike[]
  commentEdits      CommentEdit[]
  roles             UserRole[]
}
```

### ArtistTranslation (UPDATED — add shortName)

```prisma
model ArtistTranslation {
  id        String  @id @default(uuid())
  artistId  BigInt
  locale    String
  name      String
  shortName String?
  // Display name for space-constrained UI contexts.
  // e.g. name="蓮ノ空女学院スクールアイドルクラブ" shortName="蓮ノ空"
  // If null, UI falls back to name automatically.
  bio       String?

  artist    Artist  @relation(fields: [artistId], references: [id])
  @@unique([artistId, locale])
  @@index([artistId])
}
```

### EventSeriesTranslation (UPDATED — add shortName)

```prisma
model EventSeriesTranslation {
  id            String      @id @default(uuid())
  eventSeriesId BigInt
  locale        String
  name          String
  shortName     String?
  // e.g. name="蓮ノ空 6th Live Dream ～Bloom Garden Party～"
  //      shortName="6th Live BGP"
  description   String?

  eventSeries   EventSeries @relation(fields: [eventSeriesId], references: [id])
  @@unique([eventSeriesId, locale])
  @@index([eventSeriesId])
}
```

### EventTranslation (UPDATED — add shortName)

```prisma
model EventTranslation {
  id        String @id @default(uuid())
  eventId   BigInt
  locale    String
  name      String
  shortName String?
  // e.g. name="Bloom Garden Party Stage／埼玉公演 Day1"
  //      shortName="사이타마 Day1"

  event     Event  @relation(fields: [eventId], references: [id])
  @@unique([eventId, locale])
  @@index([eventId])
}
```

### GroupTranslation (UPDATED — add shortName)

```prisma
model GroupTranslation {
  id          String  @id @default(uuid())
  groupId     String
  locale      String
  name        String
  shortName   String?
  // e.g. name="Love Live! School idol project series"
  //      shortName="러브라이브"
  description String?

  group       Group   @relation(fields: [groupId], references: [id])
  @@unique([groupId, locale])
  @@index([groupId])
}
```

---

## New Models

### UserRole (NEW)

```prisma
// Assigns a role to a user, optionally scoped to a specific board.
//
// scopeType + scopeId = null → global role (superadmin, admin)
// scopeType = artist, scopeId = "42" → board_mod for that Artist only
// scopeType = group, scopeId = "uuid" → board_mod for all that Group's boards
//
// board_mod permissions:
//   ✅ Handle reports in scope
//   ✅ Hide/restore comments in scope
//   ✅ Approve dictionary entries in scope
//   ❌ Ban users (admin only)
//   ❌ Permanent delete (admin only)
//
// trusted permissions:
//   ✅ Approve dictionary entries in scope
//   ✅ Auto-approved contributions
//   ❌ Handle reports

model UserRole {
  id          String     @id @default(uuid())
  userId      String

  role        RoleType

  scopeType   ScopeType?
  scopeId     String?
  // Artist.id stored as String (BigInt serialized)
  // Group.id stored as String (UUID)
  // null for global roles (superadmin, admin)

  grantedBy   String     // userId of admin who granted this role
  grantedAt   DateTime   @default(now())
  expiresAt   DateTime?  // null = permanent
  note        String?    // e.g. "蓮ノ空 volunteer moderator"

  user        User       @relation(fields: [userId], references: [id])

  @@unique([userId, role, scopeType, scopeId])
  @@index([userId])
  @@index([scopeType, scopeId])
  @@index([role])
}
```

### TranslationDictionary (NEW)

```prisma
// Community-maintained overrides for translation API.
// Applied as pre-translation substitutions before calling Papago/DeepL.
//
// Examples:
//   sourceText="직관" sourceLang="ko" targetLang="en"
//     → targetText="직접 관람 (attended in person)"
//   sourceText="링크라" sourceLang="*" targetLang="*"
//     → targetText="링크라"  (preserve as-is in any language)
//   sourceText="코즈에" sourceLang="*" targetLang="*"
//     → targetText="Kozue Otomari (小豆沢こずえ)"

model TranslationDictionary {
  id          String       @id @default(uuid())
  sourceText  String
  // Exact string to match (case-insensitive).

  sourceLang  String
  // Language of sourceText. "ko" | "ja" | "en" | "zh-CN" | "zh-TW"
  // Use "*" for language-agnostic terms (appear in any language)

  targetText  String
  // Replacement text sent to translation API.
  // For DictCategory.preserve: same as sourceText

  targetLang  String
  // Target language this entry applies to.
  // Use "*" for entries that preserve term in any target language.

  category    DictCategory

  isApproved  Boolean  @default(false)
  // false → applied only for the submitting user (trial)
  // true  → applied for all users

  createdBy   String       // userId
  approvedBy  String?      // admin/trusted userId
  useCount    Int          @default(0)
  createdAt   DateTime     @default(now())

  @@unique([sourceText, sourceLang, targetLang])
  @@index([sourceLang, isApproved])
  @@index([createdBy])
}
```

### Report (NEW)

```prisma
model Report {
  id          String       @id @default(uuid())
  reporterId  String

  targetType  ReportTarget
  targetId    String
  // Comment.id or TranslationDictionary.id

  reason      ReportReason
  detail      String?      @db.Text

  status      ReportStatus @default(pending)

  // Routing — which board_mod is assigned to handle this report
  assignedScope      String?    // scopeId of assigned board_mod
  assignedScopeType  ScopeType? // artist or group

  resolvedBy  String?      // userId of admin/mod who handled it
  resolvedAt  DateTime?
  createdAt   DateTime     @default(now())

  reporter    User         @relation(fields: [reporterId], references: [id])

  @@index([status, createdAt])    // moderation queue: pending by time
  @@index([targetType, targetId]) // all reports on a specific item
  @@index([reporterId])
  @@index([assignedScope, status]) // board_mod's queue
}
```

---

## Helper: displayName utility

Add this to `src/lib/display.ts`:

```typescript
/**
 * Returns shortName if available, falls back to name.
 * Use 'full' mode for SEO meta tags and page H1 titles.
 * Use 'short' mode (default) everywhere else.
 */
export function displayName(
  translation: { name: string; shortName?: string | null },
  mode: 'short' | 'full' = 'short'
): string {
  if (mode === 'short') {
    return translation.shortName ?? translation.name
  }
  return translation.name
}
```

---

## Steps for ClaudeCode

1. Add all new enums (EventType update, 8 new enums)
2. Update SetlistItem model
3. Update Comment model
4. Update User model (add knownLocales, autoTranslate, roles relation)
5. Update ArtistTranslation model (add shortName)
6. Update EventSeriesTranslation model (add shortName)
7. Update EventTranslation model (add shortName)
8. Update GroupTranslation model (add shortName)
9. Add UserRole model
10. Add TranslationDictionary model
11. Add Report model
12. Create src/lib/display.ts with displayName helper
13. Run `npx prisma db push`
14. Run `npx prisma generate`
15. Verify: `npm run dev` → /api/health → { status: "ok", db: "connected" }
