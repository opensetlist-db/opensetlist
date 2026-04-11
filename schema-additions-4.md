# schema-additions-4.md — SetlistItemArtist + EventTranslation city/venue

> Two changes:
> 1. Add SetlistItemArtist junction table (Artist directly on SetlistItem)
> 2. Add city and venue fields to EventTranslation
>
> Also clarifies unitName and note usage conventions (no schema change).

---

## Change 1 — SetlistItemArtist

### Background

Finding which Artist/unit performed a SetlistItem was inefficient:

```
Before:
  SetlistItem → SetlistItemMember → StageIdentity → StageIdentityArtist → Artist
  3 joins to find the performing unit

After:
  SetlistItem → SetlistItemArtist → Artist
  1 join — direct
```

### When to use SetlistItemArtist vs SetlistItemMember

```
SetlistItemArtist (new):
  → Registered Artist performs
  → Covers 95%+ of cases
  → Locale-aware name display from Artist translations
  → Used for rollup ancestry (direct path, no StageIdentity needed)

SetlistItemMember (existing, keep):
  → One-off temporary units not registered as Artist
  → When per-member VA detail is needed
  → Optional: can combine with SetlistItemArtist for full detail

unitName (existing, keep):
  → Only for one-off units with no Artist entry
  → Write in English when possible ("Special Unit", "Team A")
  → Very rare in practice for target IPs

note (existing, keep):
  → Always write in English
  → "acoustic ver.", "world premiere", "live debut", "surprise appearance"
  → No translation in Phase 1A — auto-translation handles it in Phase 2
```

### Case matrix

```
Case A — registered Artist unit:
  SetlistItemArtist: [cerise-bouquet]
  SetlistItemMember: (empty)
  unitName:          null
  UI: Artist translations → "スリーズブーケ" (ja) / "세리제 부케" (ko)

Case B — full group:
  SetlistItemArtist: [hasunosora]
  SetlistItemMember: (empty)
  unitName:          null

Case C — one-off temporary unit:
  SetlistItemArtist: (empty)
  SetlistItemMember: [sayaka, kozue, ginko]
  unitName:          "Special Unit"

Case D — registered unit + individual member detail:
  SetlistItemArtist: [cerise-bouquet]
  SetlistItemMember: [sayaka, kozue, rurino]
  unitName:          null

Case E — MC / video / interval:
  SetlistItemArtist: [hasunosora]
  SetlistItemMember: (empty)
  unitName:          null
  note:              "opening MC"
```

### New model: SetlistItemArtist

```prisma
// Direct N:N between SetlistItem and Artist.
// Use for all registered Artist/unit performances.
// Replaces the inefficient path through SetlistItemMember → StageIdentity.

model SetlistItemArtist {
  id            String      @id @default(uuid())
  setlistItemId BigInt
  artistId      BigInt

  setlistItem   SetlistItem @relation(fields: [setlistItemId], references: [id])
  artist        Artist      @relation(fields: [artistId], references: [id])

  @@unique([setlistItemId, artistId])
  @@index([setlistItemId])
  @@index([artistId])
}
```

### Updated SetlistItem model

```prisma
model SetlistItem {
  id              BigInt                     @id @default(autoincrement())
  eventId         BigInt
  position        Int
  isEncore        Boolean                    @default(false)
  stageType       SetlistItemStageType       @default(full_group)
  unitName        String?
  note            String?
  status          SetlistItemStatus          @default(confirmed)
  performanceType SetlistItemPerformanceType @default(live_performance)
  type            SetlistItemType            @default(song)
  isDeleted       Boolean                    @default(false)
  deletedAt       DateTime?
  createdAt       DateTime                   @default(now())

  event       Event                @relation(fields: [eventId], references: [id])
  artists     SetlistItemArtist[]  // ← NEW
  songs       SetlistItemSong[]
  performers  SetlistItemMember[]

  @@unique([eventId, position])
  @@index([eventId])
  @@index([isDeleted])
}
```

### Updated Artist model (add relation)

```prisma
model Artist {
  // ... existing fields ...
  setlistItems   SetlistItemArtist[]  // ← ADD THIS RELATION
}
```

### Rollup computation — updated path

```typescript
// Before (complex):
// SetlistItem → SetlistItemMember → StageIdentity
//   → StageIdentityArtist → Artist → parentArtist → ...

// After (simple):
// SetlistItem → SetlistItemArtist → Artist → parentArtist → ...

async function computeRollup(setlistItem) {
  const artistIds: string[] = []

  for (const sia of setlistItem.artists) {
    // Add direct artist
    artistIds.push(String(sia.artistId))

    // Walk up parent chain
    let current = sia.artist
    while (current.parentArtistId) {
      artistIds.push(String(current.parentArtistId))
      current = await prisma.artist.findUnique({
        where: { id: current.parentArtistId }
      })
    }
  }

  return {
    rollupArtistIds: [...new Set(artistIds)],
    // ... other rollup arrays
  }
}
```

### Updated setlistitems.csv spec

```csv
event_slug,position,song_slug,isEncore,itemType,performanceType,stageType,artist_slugs,unitName,performer_slugs,note,status

# Case A — registered unit
6th-fukuoka-day1,1,edelied,false,song,live_performance,full_group,hasunosora,,,, confirmed
6th-fukuoka-day1,4,hanamusubi,false,song,live_performance,unit,cerise-bouquet,,,, confirmed

# Case C — one-off unit
6th-fukuoka-day1,10,special-song,false,song,live_performance,unit,,Special Unit,sayaka kozue ginko,,confirmed

# MC
6th-fukuoka-day1,3,,false,mc,live_performance,full_group,hasunosora,,,opening MC,confirmed
```

`artist_slugs` and `performer_slugs` are space-separated.
`artist_slugs` empty = use performer_slugs only (Case C).
`performer_slugs` empty = use artist_slugs only (Cases A/B/E).

---

## Change 2 — EventTranslation city and venue

### Background

`Event.city` and `Event.venue` are stored in Japanese (original language).
Korean/English users cannot read Japanese venue names or city names.

Auto-conversion via lookup table was considered but rejected:
```
Problems with lookup table:
  → Obscure cities ("所沢") hard to map accurately
  → Future overseas venues (Korea, Taiwan) need constant updates
  → Code changes required for every new city
  → Translation accuracy uncertain for less-known cities

Solution: Add city and venue to EventTranslation
  → Explicit per-locale values
  → Copy-paste for repeated cities = fast input
  → No code complexity
  → Works for any city anywhere in the world
```

### Updated EventTranslation model

```prisma
model EventTranslation {
  id        String  @id @default(uuid())
  eventId   BigInt
  locale    String
  name      String
  shortName String?
  city      String?
  // Locale-specific city name.
  // ja: "福岡" / ko: "후쿠오카" / en: "Fukuoka"
  venue     String?
  // Locale-specific venue name.
  // ja: "マリンメッセ福岡B館" / ko: "마리나메세 후쿠오카 B관" / en: "Marine Messe Fukuoka Hall B"

  event     Event   @relation(fields: [eventId], references: [id])
  @@unique([eventId, locale])
  @@index([eventId])
}
```

`Event.city` and `Event.venue` fields on the Event model:
```
Keep as-is — store original language (Japanese) as fallback.
EventTranslation.city/venue used when available for display.
Fallback chain: EventTranslation(locale) → Event.city/venue
```

### Display logic

```typescript
function getEventDisplay(event, translations, locale) {
  const t = getTranslation(translations, locale)
  return {
    name:  t?.name  ?? event.translations[0]?.name,
    city:  t?.city  ?? event.city,   // fallback to raw field
    venue: t?.venue ?? event.venue,  // fallback to raw field
  }
}
```

### Updated events.csv spec

```csv
series_slug,series_ja_name,series_ja_shortName,series_ko_name,series_ko_shortName,series_type,
event_slug,parentEvent_slug,event_type,date,venue,city,country,
ja_name,ja_shortName,ja_city,ja_venue,
ko_name,ko_shortName,ko_city,ko_venue

6th-bgp,蓮ノ空 6th Live Dream ～Bloom Garden Party～,6th Live BGP,하스노소라 6th Live Dream ～Bloom Garden Party～,6th Live BGP,concert_tour,
6th-fukuoka-day1,,concert,2026-05-02,マリンメッセ福岡B館,福岡,JP,
Bloom Stage 福岡公演 Day1,후쿠오카 Day1,福岡,マリンメッセ福岡B館,
Bloom Stage 후쿠오카 Day1,후쿠오카 Day1,후쿠오카,마리나메세 후쿠오카 B관

6th-bgp,,,,,concert_tour,
6th-fukuoka-day2,,concert,2026-05-03,マリンメッセ福岡B館,福岡,JP,
Bloom Stage 福岡公演 Day2,후쿠오카 Day2,福岡,マリンメッセ福岡B館,
Bloom Stage 후쿠오카 Day2,후쿠오카 Day2,후쿠오카,마리나메세 후쿠오카 B관

6th-bgp,,,,,concert_tour,
6th-kobe-day1,,concert,2026-05-23,神戸ワールド記念ホール,神戸,JP,
Garden Stage 兵庫公演 Day1,고베 Day1,神戸,神戸ワールド記念ホール,
Garden Stage 고베 Day1,고베 Day1,고베,고베 월드기념홀

6th-bgp,,,,,concert_tour,
6th-kobe-day2,,concert,2026-05-24,神戸ワールド記念ホール,神戸,JP,
Garden Stage 兵庫公演 Day2,고베 Day2,神戸,神戸ワールド記念ホール,
Garden Stage 고베 Day2,고베 Day2,고베,고베 월드기념홀

6th-bgp,,,,,concert_tour,
6th-kanagawa-day1,,concert,2026-05-30,ぴあアリーナMM,横浜,JP,
Party Stage 神奈川公演 Day1,가나가와 Day1,横浜,ぴあアリーナMM,
Party Stage 가나가와 Day1,가나가와 Day1,가나가와,피아 아레나 MM

6th-bgp,,,,,concert_tour,
6th-kanagawa-day2,,concert,2026-05-31,ぴあアリーナMM,横浜,JP,
Party Stage 神奈川公演 Day2,가나가와 Day2,横浜,ぴあアリーナMM,
Party Stage 가나가와 Day2,가나가와 Day2,가나가와,피아 아레나 MM

6th-bgp,,,,,concert_tour,
6th-saitama-day1,,concert,2026-07-11,ベルーナドーム,所沢,JP,
BGP Stage 埼玉公演 Day1,사이타마 Day1,所沢,ベルーナドーム,
BGP Stage 사이타마 Day1,사이타마 Day1,사이타마,베루나 돔

6th-bgp,,,,,concert_tour,
6th-saitama-day2,,concert,2026-07-12,ベルーナドーム,所沢,JP,
BGP Stage 埼玉公演 Day2,사이타마 Day2,所沢,ベルーナドーム,
BGP Stage 사이타마 Day2,사이타마 Day2,사이타마,베루나 돔
```

Note: CSV rows are wrapped for readability. In actual CSV each event is one row.

---

## Steps for ClaudeCode

1. Add `SetlistItemArtist` model to `prisma/schema.prisma`
2. Add `artists SetlistItemArtist[]` relation to `SetlistItem` model
3. Add `setlistItems SetlistItemArtist[]` relation to `Artist` model
4. Add `city String?` to `EventTranslation` model
5. Add `venue String?` to `EventTranslation` model
6. Run `npx prisma db push`
7. Run `npx prisma generate`
8. Update `src/lib/csv-import.ts`:
   - Parse `artist_slugs` column in setlistitems.csv
   - Create `SetlistItemArtist` rows during import
   - Parse `ja_city`, `ja_venue`, `ko_city`, `ko_venue` in events.csv
   - Store in `EventTranslation`
9. Update `src/lib/rollup.ts`:
   - Use `SetlistItemArtist → Artist` path for rollupArtistIds
   - Remove dependency on `SetlistItemMember → StageIdentity` for rollup
10. Update event display helper to use `EventTranslation.city/venue`
    with fallback to `Event.city/venue`
11. Verify: `npm run dev` → /api/health → { status: "ok", db: "connected" }
