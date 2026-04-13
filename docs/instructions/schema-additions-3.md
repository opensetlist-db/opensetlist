# schema-additions-3.md — Slug Field for Artist, Song, Event, EventSeries

> Add slug field to Artist, Song, Event, EventSeries models.
> Slug serves two purposes:
>   1. Stable upsert key for CSV re-import after schema changes
>   2. URL display slug (decorative, numeric ID remains canonical)

---

## Background

Without a stable unique key, CSV re-import cannot reliably find existing rows:

```
Problem:
  Artist has no natural unique key besides auto-increment BigInt id.
  Re-import after schema change → upsert has nothing to match on.
  → Creates duplicates or fails.

Solution:
  Store slug as a @unique field.
  CSV slug = DB slug = URL slug (one consistent system).
  Upsert matches on slug, never on id.
```

---

## Slug Rules

```
Format:    lowercase, hyphens only
           "cerise-bouquet", "hanamusubi", "6th-fukuoka-day1"
Character: ASCII only (romanized from Japanese/Korean name)
Uniqueness: unique per table (not globally)
Immutable: set at creation, never changed
Max length: 100 characters

Examples:
  Artist:      "hasunosora", "cerise-bouquet", "dollchestra"
  Song:        "hanamusubi", "deepness", "dream-believers"
               "dream-believers-sakura-ver" (variants)
  Event:       "6th-fukuoka-day1", "6th-saitama-day2"
  EventSeries: "6th-bgp", "5th-live", "ijigen-fes-2023"
```

---

## Updated Models

### Artist (UPDATED — add slug)

```prisma
model Artist {
  id             BigInt              @id @default(autoincrement())
  slug           String              @unique
  // Stable identifier for CSV import and URL display.
  // e.g. "hasunosora", "cerise-bouquet", "dollchestra"
  // Set at creation. Never changed.
  parentArtistId BigInt?
  type           ArtistType
  hasBoard       Boolean             @default(true)
  imageUrl       String?
  isDeleted      Boolean             @default(false)
  deletedAt      DateTime?
  createdAt      DateTime            @default(now())

  parentArtist   Artist?             @relation("ArtistChildren", fields: [parentArtistId], references: [id])
  subArtists     Artist[]            @relation("ArtistChildren")
  translations   ArtistTranslation[]
  groupLinks     ArtistGroup[]
  stageLinks     StageIdentityArtist[]
  songCredits    SongArtist[]
  eventSeries    EventSeries[]
  albums         Album[]
  roles          UserRole[]

  @@index([parentArtistId])
  @@index([isDeleted])
}
```

### Song (UPDATED — add slug)

```prisma
model Song {
  id            BigInt            @id @default(autoincrement())
  slug          String            @unique
  // e.g. "hanamusubi", "deepness", "dream-believers-sakura-ver"
  // For variants: append "-variantLabel" to base slug.
  baseVersionId BigInt?
  originalTitle String
  variantLabel  String?
  releaseDate   DateTime?         @db.Date
  sourceNote    String?
  isDeleted     Boolean           @default(false)
  deletedAt     DateTime?
  createdAt     DateTime          @default(now())

  baseVersion   Song?             @relation("SongVariants", fields: [baseVersionId], references: [id])
  variants      Song[]            @relation("SongVariants")
  artists       SongArtist[]
  translations  SongTranslation[]
  setlistItems  SetlistItemSong[]
  albumTracks   AlbumTrack[]

  @@index([baseVersionId])
  @@index([isDeleted])
}
```

### EventSeries (UPDATED — add slug)

```prisma
model EventSeries {
  id             BigInt                   @id @default(autoincrement())
  slug           String                   @unique
  // e.g. "6th-bgp", "5th-live", "ijigen-fes-2023"
  artistId       BigInt?
  parentSeriesId BigInt?
  type           EventSeriesType
  organizerName  String?
  hasBoard       Boolean                  @default(false)
  imageUrl       String?
  isDeleted      Boolean                  @default(false)
  deletedAt      DateTime?
  createdAt      DateTime                 @default(now())

  artist         Artist?                  @relation(fields: [artistId], references: [id])
  parentSeries   EventSeries?             @relation("SeriesChildren", fields: [parentSeriesId], references: [id])
  childSeries    EventSeries[]            @relation("SeriesChildren")
  translations   EventSeriesTranslation[]
  events         Event[]

  @@index([artistId])
  @@index([parentSeriesId])
  @@index([isDeleted])
}
```

### Event (UPDATED — add slug)

```prisma
model Event {
  id            BigInt             @id @default(autoincrement())
  slug          String             @unique
  // e.g. "6th-fukuoka-day1", "6th-saitama-day2"
  // For leg containers (no date): "6th-saitama-leg"
  eventSeriesId BigInt?
  parentEventId BigInt?
  type          EventType
  status        EventStatus        @default(upcoming)
  date          DateTime?          @db.Date
  venue         String?
  city          String?
  country       String?
  posterUrl     String?
  isDeleted     Boolean            @default(false)
  deletedAt     DateTime?
  createdAt     DateTime           @default(now())

  eventSeries   EventSeries?       @relation(fields: [eventSeriesId], references: [id])
  parentEvent   Event?             @relation("EventChildren", fields: [parentEventId], references: [id])
  childEvents   Event[]            @relation("EventChildren")
  translations  EventTranslation[]
  setlistItems  SetlistItem[]

  @@index([eventSeriesId])
  @@index([parentEventId])
  @@index([date, status])
  @@index([isDeleted])
}
```

---

## CSV Import — Upsert Pattern

With slug stored in DB, upsert is clean and reliable:

```typescript
// src/lib/csv-import.ts

// Artists
await prisma.artist.upsert({
  where: { slug: row.slug },
  create: {
    slug: row.slug,
    type: row.type,
    parentArtistId: parentId ?? null,
    translations: {
      create: buildTranslations(row)
    }
  },
  update: {
    type: row.type,
    parentArtistId: parentId ?? null,
    // slug never updated
  }
})

// Songs
await prisma.song.upsert({
  where: { slug: row.slug },
  create: {
    slug: row.slug,
    originalTitle: row.originalTitle,
    baseVersionId: baseVersionId ?? null,
    variantLabel: row.variantLabel || null,
    releaseDate: row.releaseDate ? new Date(row.releaseDate) : null,
  },
  update: {
    originalTitle: row.originalTitle,
    variantLabel: row.variantLabel || null,
    releaseDate: row.releaseDate ? new Date(row.releaseDate) : null,
  }
})

// Events (upsert series first, then event)
await prisma.eventSeries.upsert({
  where: { slug: row.series_slug },
  create: { slug: row.series_slug, ... },
  update: { ... }
})

await prisma.event.upsert({
  where: { slug: row.event_slug },
  create: { slug: row.event_slug, ... },
  update: { ... }
})
```

---

## URL Routing with Slug

Slug is used as the decorative URL segment. Numeric ID remains canonical.

```typescript
// app/[locale]/artists/[id]/[[...slug]]/page.tsx

export default async function ArtistPage({
  params
}: {
  params: { locale: string; id: string; slug?: string[] }
}) {
  const artist = await prisma.artist.findUnique({
    where: { id: BigInt(params.id) },  // always match on id
    include: { translations: true }
  })

  if (!artist) notFound()

  // Redirect if slug is wrong or missing
  const correctSlug = artist.slug
  const currentSlug = params.slug?.[0]

  if (currentSlug !== correctSlug) {
    redirect(`/${params.locale}/artists/${params.id}/${correctSlug}`)
  }

  return <ArtistPageContent artist={artist} />
}
```

URL examples:
```
/ko/artists/42/hasunosora         ← correct
/ko/artists/42/anything           ← redirects to correct slug
/ko/artists/42                    ← redirects to correct slug
/ko/artists/42/hasunosora-old     ← redirects to correct slug
```

---

## Slug Generation Helper

Add to `src/lib/slug.ts`:

```typescript
/**
 * Generates a URL/import slug from a name string.
 * Used when creating entities without an explicit slug.
 *
 * Rules:
 *   - Lowercase
 *   - Replace spaces and special chars with hyphens
 *   - ASCII only (strips non-ASCII after transliteration)
 *   - No leading/trailing hyphens
 *   - No consecutive hyphens
 *   - Max 100 chars
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')   // remove non-word chars except hyphens
    .replace(/[\s_]+/g, '-')    // spaces/underscores → hyphens
    .replace(/-+/g, '-')        // consecutive hyphens → single
    .replace(/^-|-$/g, '')      // trim leading/trailing hyphens
    .slice(0, 100)
}

// Examples:
// generateSlug("Cerise Bouquet")     → "cerise-bouquet"
// generateSlug("DOLLCHESTRA")        → "dollchestra"
// generateSlug("Dream Believers")    → "dream-believers"
// generateSlug("6th Live BGP")       → "6th-live-bgp"
// generateSlug("Bloom Garden Party Stage 후쿠오카 Day1")
//   → "bloom-garden-party-stage-day1"
//   (Korean chars stripped — use explicit slug in CSV instead)
```

Note: For Japanese/Korean names, always provide explicit slug in CSV
rather than relying on auto-generation (non-ASCII stripped).

---

## Updated CSV Column Specs

All CSVs already include `slug` column (defined in schema-changes.md Change 6).
No CSV format changes needed — slug was already planned.

Reminder of slug conventions per entity:

```
artists.csv:
  hasunosora, cerise-bouquet, dollchestra, mira-cra-park
  uma-musume, special-week, tokai-teio

songs.csv:
  hanamusubi, deepness, birdcage, aurora-flower
  dream-believers, dream-believers-sakura-ver (variants)
  joushou-kiryuu, legato

events.csv (event_slug):
  6th-fukuoka-day1, 6th-fukuoka-day2
  6th-kobe-day1, 6th-kobe-day2
  6th-kanagawa-day1, 6th-kanagawa-day2
  6th-saitama-day1, 6th-saitama-day2

events.csv (series_slug):
  6th-bgp, 5th-live, 4th-live
  ijigen-fes-2023, uma-1st-event, uma-3rd-event
```

---

## Steps for ClaudeCode

1. Add `slug String @unique` to `Artist` model (after `id`)
2. Add `slug String @unique` to `Song` model (after `id`)
3. Add `slug String @unique` to `EventSeries` model (after `id`)
4. Add `slug String @unique` to `Event` model (after `id`)
5. Run `npx prisma db push`
6. Run `npx prisma generate`
7. Create `src/lib/slug.ts` with `generateSlug()` helper
8. Update `src/lib/csv-import.ts` to use `where: { slug }` in all upserts
9. Update route handlers to use `[[...slug]]` pattern with redirect logic
10. Verify: `npm run dev` → /api/health → { status: "ok", db: "connected" }

Note: If existing Artist/Song/Event/EventSeries rows exist in DB without
slug, you must either:
  a) Drop and recreate the tables (safe if no real data yet), OR
  b) Add slug as nullable first, populate, then make required
  Recommended: option (a) since seed data is managed via CSV anyway.
