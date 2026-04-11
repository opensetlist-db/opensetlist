# schema-additions-8.md — EventPerformer model + SetlistItem performer rules

> Finalizes the performer resolution system for SetlistItems.
> Covers all known Hasunosora live edge cases.

---

## Background

Three problems needed solving:

```
Problem 1: StageIdentity page — "which events did this character appear in?"
  → SetlistItemMember empty = no record = character appears nowhere
  → Needed: Event-level performer list as fallback

Problem 2: Date-based inference is unreliable
  → Dream lives: graduated members return as regular performers
  → Pre-debut members: appear in events before their unit join date
  → Cannot use startDate/endDate for SetlistItem display (per schema-additions-5.md)

Problem 3: getCurrentUnitMembers(endDate=null) also unreliable
  → 2nd Live: Kozue not yet in Cerise Bouquet → but endDate=null now
  → Would incorrectly include pre-debut members
```

---

## Final performer resolution rules

```
Unit songs:
  performer_slugs ALWAYS required
  No fallback — too many edge cases to handle automatically

Full group songs:
  performer_slugs optional
  If empty → use Event.performers where isGuest=false
  If filled → use SetlistItemMember directly (special cases: guest joins, etc.)

Solo / guest songs:
  performer_slugs always required (obvious)
```

---

## New model: EventPerformer

```prisma
// Records all performers for an event — both regular and guests.
// Used as fallback for full group SetlistItems where performer_slugs is empty.
// Also used for StageIdentity page "appeared in these events" queries.
//
// isGuest=false (regular):
//   Included in fallback for full group songs
//
// isGuest=true (guest):
//   Excluded from fallback
//   Only appears when explicitly in SetlistItemMember
//
// artistId NOT included — unit songs always use explicit performer_slugs,
// so unit override per event is never needed.

model EventPerformer {
  id              String        @id @default(uuid())
  eventId         BigInt
  stageIdentityId String

  isGuest         Boolean       @default(false)
  // false = regular performer → included in full group fallback
  // true  = guest → excluded from fallback, explicit only

  event           Event         @relation(fields: [eventId], references: [id])
  stageIdentity   StageIdentity @relation(fields: [stageIdentityId], references: [id])

  @@unique([eventId, stageIdentityId])
  @@index([eventId])
  @@index([stageIdentityId])
}
```

Add relation to Event model:

```prisma
model Event {
  // ... existing fields ...
  performers    EventPerformer[]   // ← ADD
}
```

---

## All Hasunosora live cases — verified

### Case 1 — 2nd Live

```
Setup:
  Regular (isGuest=false): 6명 (102기 + 103기)
    kaho, sayaka, rurino, ginko, kozue, megumi
  Guest (isGuest=true): 3명 (104기, pre-debut)
    kousuzuu, himeme, izumi — artistId=null (not in any unit yet)

Pre-encore unit song (e.g. Hanamusubi):
  artist_slugs:    cerise-bouquet
  performer_slugs: sayaka kozue rurino  ← explicitly entered
  → SetlistItemMember used directly ✅
  → Pre-debut kousuzuu not included ✅

Pre-encore full group song:
  artist_slugs:    hasunosora
  performer_slugs: (empty)
  → fallback: EventPerformer isGuest=false = 6명 ✅
  → Guest 3명 excluded ✅

Post-encore full group song (9명):
  artist_slugs:    hasunosora
  performer_slugs: kaho sayaka rurino ginko kozue megumi kousuzuu himeme izumi
  → explicitly entered ✅

Post-encore unit song (guest included):
  artist_slugs:    cerise-bouquet
  performer_slugs: sayaka kozue rurino kousuzuu  ← explicitly entered ✅
```

### Case 2 — 4th Live

```
Setup:
  Regular (isGuest=false): 9명 (102기 + 103기 + 104기)
  Guest (isGuest=true): 세라스 + 이즈미 (Edel Note — pre-Hasunosora)
    seras: isGuest=true
    izumi: isGuest=true

Full group song (9명 only):
  performer_slugs: (empty)
  → fallback: EventPerformer isGuest=false = 9명 ✅
  → 세라스/이즈미 excluded ✅

Edel Note song:
  artist_slugs:    edel-note-mizukawa
  performer_slugs: seras izumi  ← explicitly entered ✅
```

### Case 3 — 6th Live 사이타마 (파이널)

```
Setup:
  Regular (isGuest=false): 11명 전원
  Graduates treated as regular, NOT guest:
    kozue: isGuest=false
    megumi: isGuest=false
    rurino: isGuest=false
  (No artistId needed — unit songs always use explicit performer_slugs)

Full group song (11명):
  performer_slugs: (empty)
  → fallback: EventPerformer isGuest=false = 11명 ✅

Unit song (Cerise Bouquet):
  performer_slugs: sayaka kozue rurino  ← explicitly entered ✅
  → Graduated kozue correctly included because explicitly entered ✅
```

---

## Performer resolution query

```typescript
async function getPerformers(
  setlistItem: SetlistItemWithRelations,
  event: EventWithPerformers
) {
  // Unit songs — always explicitly entered, use directly
  if (isUnitSong(setlistItem)) {
    // performers should always be filled for unit songs
    // if somehow empty, return empty rather than guessing
    return setlistItem.performers
  }

  // Full group songs
  if (setlistItem.performers.length > 0) {
    // Special case explicitly entered (e.g. guests join full group song)
    return setlistItem.performers
  }

  // Full group songs — use Event.performers (regular only)
  return event.performers
    .filter(p => !p.isGuest)
    .map(p => p.stageIdentity)
}

function isUnitSong(setlistItem: SetlistItemWithRelations): boolean {
  // Unit song = has artist AND that artist is not the top-level group
  return setlistItem.artists.some(a => a.artist.parentArtistId !== null)
}
```

---

## StageIdentity page query — "events this character appeared in"

```typescript
// Two-part query:

// Part 1: Events where character is in SetlistItemMember (explicit)
const fromSetlistItems = await prisma.setlistItem.findMany({
  where: {
    performers: {
      some: { stageIdentityId: characterId }
    }
  },
  include: { event: true }
})

// Part 2: Events where character is regular EventPerformer
// AND the event has full group songs (performer_slugs empty)
const fromEventPerformers = await prisma.event.findMany({
  where: {
    performers: {
      some: {
        stageIdentityId: characterId,
        isGuest: false
      }
    }
  }
})

// Merge and deduplicate
const allEventIds = new Set([
  ...fromSetlistItems.map(si => si.eventId),
  ...fromEventPerformers.map(e => e.id)
])
```

---

## Admin UI — Event performer management

Event setup page (before entering setlist):

```
┌─────────────────────────────────────────┐
│ 6th Live 후쿠오카 Day1 — 출연진          │
│                                         │
│ 정규                        [+ 추가]    │
│  [카호 ×] [사야카 ×] [루리노 ×]        │
│  [긴코 ×] [코스즈 ×] [히메 ×]          │
│  [세라스 ×] [이즈미 ×]                  │
│                                         │
│ 게스트                      [+ 추가]    │
│  (없음)                                 │
└─────────────────────────────────────────┘
```

SetlistItem entry — unit song with pre-filled performers:

```
┌─────────────────────────────────────────┐
│ Hanamusubi                              │
│ Artist: [Cerise Bouquet ▾]             │
│                                         │
│ Performers (이 공연의 Cerise Bouquet):  │
│  ☑ 사야카  ☑ 코즈에  ☑ 루리노         │
│  ☐ 카호   ☐ 긴코   ☐ 코스즈          │
│  (unit members pre-checked)             │
└─────────────────────────────────────────┘
```

Pre-fill logic:
```typescript
// When unit is selected in SetlistItem form,
// pre-check members from EventPerformer who are regular (isGuest=false)
// AND belong to that unit via StageIdentityArtist (endDate=null)

function getDefaultPerformers(artistId, eventPerformers) {
  // Get regular EventPerformers for this event
  const regularPerformers = eventPerformers.filter(p => !p.isGuest)

  // Filter to those who belong to the selected unit (endDate=null)
  return regularPerformers.filter(p =>
    p.stageIdentity.artistLinks.some(
      link => link.artistId === artistId && link.endDate === null
    )
  )
}
```

---

## events.csv — add performer columns

```csv
event_slug,...,event_performer_slugs,event_guest_slugs

# event_performer_slugs: space-separated, regular performers (isGuest=false)
# event_guest_slugs: space-separated, guests (isGuest=true)

# 6th 후쿠오카 (현역 8명, 게스트 없음)
6th-fukuoka-day1,...,
  kaho sayaka rurino ginko kozue himeme seras izumi,

# 4th Live (9명 정규 + Edel Note 게스트)
4th-live-day1,...,
  kaho sayaka rurino ginko kozue megumi kousuzuu himeme izumi,
  seras izumi

# 6th 사이타마 파이널 (11명 전원 정규, 졸업생도 정규)
6th-saitama-day1,...,
  kaho sayaka rurino ginko kozue megumi kousuzuu himeme seras izumi,
```

---

## setlistitems.csv — performer rules summary

```
Unit songs:
  performer_slugs: ALWAYS fill
  e.g. "sayaka kozue rurino" for Cerise Bouquet song

Full group songs:
  performer_slugs: leave empty (use Event.performers fallback)
  EXCEPTION: fill if guest joins full group song
  e.g. post-encore 9명 song in 2nd Live

Guest/solo songs:
  performer_slugs: ALWAYS fill
```

---

## Steps for ClaudeCode

1. Add `EventPerformer` model to `prisma/schema.prisma`
2. Add `performers EventPerformer[]` relation to `Event` model
3. Add `eventPerformers EventPerformer[]` relation to `StageIdentity` model
4. Run `npx prisma db push`
5. Run `npx prisma generate`
6. Update `src/lib/csv-import.ts`:
   - Parse `event_performer_slugs` and `event_guest_slugs` from events.csv
   - Create `EventPerformer` rows during event import
     (isGuest=false for performer_slugs, isGuest=true for guest_slugs)
7. Create `src/lib/performers.ts`:
   - `getPerformers(setlistItem, event)` — resolution logic
   - `isUnitSong(setlistItem)` — unit detection
   - `getDefaultPerformers(artistId, eventPerformers)` — admin UI pre-fill
8. Update admin SetlistItem form:
   - Load EventPerformer for current event on page load
   - Pre-check unit members when artist is selected (isGuest=false + endDate=null)
   - Checkbox UI for performer selection
9. Update StageIdentity page query:
   - Two-part query (SetlistItemMember + EventPerformer)
   - Merge and deduplicate event list
10. Verify: `npm run dev` → /api/health → { status: "ok", db: "connected" }
