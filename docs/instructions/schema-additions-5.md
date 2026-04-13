# schema-additions-5.md — Multiple small changes

> Five changes discussed and finalized:
> 1. StageIdentityTranslation — add shortName
> 2. StageIdentityArtist — add startDate/endDate
> 3. ArtistType — remove band enum value
> 4. Clarify SetlistItemArtist vs SetlistItemMember design
>    (date-based inference removed)
> 5. RealPersonStageIdentity — clarify date usage

---

## Change 1 — StageIdentityTranslation shortName

### Background

セラス柳田リリエンフェルト (11 chars) is too long for UI display.
Fans call her "セラス" / "세라스".

StageIdentityTranslation did not have shortName originally
because most character names are short. But this case is an exception.

For consistency with other Translation models, add shortName.

```prisma
model StageIdentityTranslation {
  id              String        @id @default(uuid())
  stageIdentityId String
  locale          String
  name            String
  shortName       String?
  // Display name for space-constrained UI.
  // e.g. name="セラス柳田リリエンフェルト" shortName="セラス"
  // For most characters: shortName is null (name is already short enough)

  stageIdentity   StageIdentity @relation(fields: [stageIdentityId], references: [id])
  @@unique([stageIdentityId, locale])
  @@index([stageIdentityId])
}
```

### Data examples

```
コズエ (Kozue):
  ja: name="大沢瑠璃乃" shortName=null  (short enough)
  ko: name="오오사와 루리노" shortName=null

セラス (Seras):
  ja: name="セラス柳田リリエンフェルト" shortName="セラス"
  ko: name="세라스 야나기다 릴리엔펠트" shortName="세라스"
```

### displayName() usage

Same helper applies:
```typescript
displayName(stageIdentityTranslation)
// → shortName if set, falls back to name
```

---

## Change 2 — StageIdentityArtist startDate/endDate

### Background

Characters' unit membership changes over time:
- Graduation (103기 멤버들 2025-03-31 졸업)
- Transfer (세라스/이즈미: 미즈카와 → 하스노소라)
- Future: Edel Note 해산 후 기존 유닛 편입 (미발생)

startDate/endDate records the story-canon membership period.

### IMPORTANT: These dates are NOT used for SetlistItem display

```
SetlistItemArtist and SetlistItemMember are always entered explicitly.
Date-based inference is NOT used for SetlistItem display.

Reason:
  "Dream" lives (4th, 6th) feature graduated members as guests.
  e.g. 코즈에 (졸업: 2025-03-31) appears in 6th Live (2026-05-02)
  Date-based query would incorrectly exclude her.

StageIdentityArtist dates are used for:
  ✅ Character profile page ("Cerise Bouquet 멤버: 2023-04 ~ 2025-03")
  ✅ Unit history display
  ✅ "Who was in this unit at this time" informational queries
  ❌ NOT for determining SetlistItem performers
```

### Updated model

```prisma
model StageIdentityArtist {
  id              String        @id @default(uuid())
  stageIdentityId String
  artistId        BigInt

  startDate       DateTime?     @db.Date
  // null = from the beginning (founder member)
  endDate         DateTime?     @db.Date
  // null = currently active
  // Set when character graduates or transfers out

  note            String?
  // e.g. "graduated", "transferred to Hasunosora", "Edel Note dissolution"

  stageIdentity   StageIdentity @relation(fields: [stageIdentityId], references: [id])
  artist          Artist        @relation(fields: [artistId], references: [id])

  @@unique([stageIdentityId, artistId])
  @@index([stageIdentityId])
  @@index([artistId])
}
```

### Data examples for Hasunosora

```
103기 멤버 (graduated 2025-03-31):
  카호 → 蓮ノ空: startDate=null endDate=null (105기 체제에서도 계속)
  사야카 → Cerise Bouquet: startDate=null endDate=null
  루리노 → Cerise Bouquet: startDate=null endDate=null
  코즈에 → Cerise Bouquet: startDate=null endDate=2025-03-31
    note="graduated 103rd term"
  메구미 → Mira-Cra Park!: startDate=null endDate=2025-03-31
    note="graduated 103rd term"

104기 멤버 (currently active):
  긴코 → DOLLCHESTRA: startDate=2024-04-01 endDate=null
  코스즈 → Cerise Bouquet: startDate=2024-04-01 endDate=null

105기 멤버:
  히메 → Mira-Cra Park!: startDate=2025-04-01 endDate=null
  세라스 → Edel Note (하스노소라): startDate=2025-04-01 endDate=null
  이즈미 → Edel Note (하스노소라): startDate=2025-04-01 endDate=null

세라스의 미즈카와 시절 (별도 Artist 등록 시):
  세라스 → Edel Note (미즈카와): startDate=null endDate=2025-03-31
    note="transferred to Hasunosora"
```

### CSV members.csv — add startDate/endDate columns

```csv
character_slug,character_type,ja_name,ko_name,color,artist_slugs,
va_slug,va_ja_name,va_ko_name,startDate,endDate,note

kaho,character,日野下花帆,히노시타 카호,#FF8FAB,hasunosora cerise-bouquet,
yuii-nozomi,楡井希実,유이 노조미,,,

kozue,character,大沢瑠璃乃,오오사와 루리노,#A8D8A8,hasunosora cerise-bouquet,
suga-kanawa,菅叶和,스가 카나와,,2025-03-31,graduated 103rd term

seras,character,セラス柳田リリエンフェルト,세라스 야나기다 릴리엔펠트,#B8860B,
hasunosora edel-note,miyake-miu,三宅美羽,미야케 미우,2025-04-01,,
```

Note: artist_slugs for members with endDate still lists the artist.
The endDate on StageIdentityArtist is what marks the end of membership.

---

## Change 3 — Remove band from ArtistType

### Background

`band` is functionally identical to `group` for OpenSetlist's purposes.
BanG Dream!'s Poppin'Party etc. would be modeled as `group`.
No UI or query logic differs between band and group.

```prisma
// BEFORE
enum ArtistType {
  solo
  group
  unit
  band   // ← REMOVE
}

// AFTER
enum ArtistType {
  solo    // individual credit (character solo songs)
  group   // main group (蓮ノ空, Poppin'Party, Uma Musume)
  unit    // sub-unit (Cerise Bouquet, DOLLCHESTRA etc.)
}
```

---

## Change 4 — SetlistItemArtist vs SetlistItemMember — design clarification

No schema change. This clarifies the intended usage documented in
schema-additions-4.md.

### Corrected design principle

```
Date-based inference of performers: NEVER USE
  → Breaks for Dream lives with graduated members as guests
  → Always enter SetlistItemArtist and SetlistItemMember explicitly

SetlistItemArtist (unit level):
  → Which Artist/unit performed this song
  → Required for all song SetlistItems
  → Entered by admin at data entry time

SetlistItemMember (individual level):
  → Which specific characters appeared
  → Optional — enter when individual detail matters
  → ALWAYS explicitly entered, never inferred from dates
  → Handles edge cases: graduated members, surprise guests,
    one-off unit combinations

Example — 코즈에 appears in 6th Live (post-graduation):
  SetlistItemArtist: [cerise-bouquet]  ← unit
  SetlistItemMember:
    → 코즈에 (stageIdentityId: kozue, realPersonId: hanamiya-nina)
    → 사야카 (stageIdentityId: sayaka, realPersonId: nonaka-kokona)
    → 루리노 (stageIdentityId: rurino, realPersonId: suga-kanawa)
  All three explicitly entered — no date inference
```

### setlistitems.csv usage

```
artist_slugs:    always fill for song items (unit or full group)
performer_slugs: fill when individual character detail is known/needed

For events where graduated members appear:
  artist_slugs:    cerise-bouquet (unit identity stays)
  performer_slugs: kozue sayaka rurino (explicitly list who appeared)

For regular events where lineup is obvious from unit:
  artist_slugs:    cerise-bouquet
  performer_slugs: (leave empty — unit implies members)
```

---

## Change 5 — RealPersonStageIdentity date usage clarification

No schema change. Clarifies existing dates field meaning.

```
RealPersonStageIdentity.startDate/endDate:
  → VA's casting period for this character
  → Used for VA profile page ("担当期間: 2023-04 ~ present")
  → Used for recast history display

NOT used for:
  → SetlistItem performer inference (same reason as above)
  → SetlistItemMember.realPersonId is always explicitly set

Example:
  If a character is recast:
    Original VA: startDate=null endDate=2024-06-01
    New VA:      startDate=2024-06-01 endDate=null

  For a live after recast with original VA as guest:
    SetlistItemMember.realPersonId = original VA (explicitly set)
    Date inference would give wrong answer (new VA)
    → Always explicit, never inferred
```

---

## Steps for ClaudeCode

1. Add `shortName String?` to `StageIdentityTranslation` model
2. Add `startDate DateTime? @db.Date` to `StageIdentityArtist` model
3. Add `endDate DateTime? @db.Date` to `StageIdentityArtist` model
4. Add `note String?` to `StageIdentityArtist` model
5. Remove `band` from `ArtistType` enum
6. Run `npx prisma db push`
7. Run `npx prisma generate`
8. Update `src/lib/csv-import.ts`:
   - Parse `startDate`, `endDate`, `note` from members.csv
   - Create `StageIdentityArtist` with these values
9. Remove any date-based performer inference logic if already implemented
10. Verify: `npm run dev` → /api/health → { status: "ok", db: "connected" }

---

## Summary of all model changes

```
StageIdentityTranslation:
  + shortName String?

StageIdentityArtist:
  + startDate DateTime? @db.Date
  + endDate   DateTime? @db.Date
  + note      String?

ArtistType enum:
  - band (removed)

No new tables.
No other model changes.
```
