# schema-additions-11.md — AlbumTrack.discNumber

> Add discNumber to AlbumTrack to support multi-disc albums.
> Single disc albums unaffected (@default(1)).

---

## Background

```
Multi-disc album:
  Disc 1 Track 1, Disc 1 Track 2
  Disc 2 Track 1, Disc 2 Track 2

Current @@unique([albumId, trackNumber]):
  Disc 2 Track 1 conflicts with Disc 1 Track 1
  → Error on import

Fix:
  Add discNumber field
  @@unique([albumId, discNumber, trackNumber])
```

---

## Schema change

```prisma
model AlbumTrack {
  albumId     String
  songId      BigInt
  discNumber  Int    @default(1)
  // Disc number within the album.
  // 1 for single-disc albums (default).
  // 2, 3... for multi-disc albums.
  trackNumber Int

  album       Album  @relation(fields: [albumId], references: [id])
  song        Song   @relation(fields: [songId], references: [id])

  @@unique([albumId, discNumber, trackNumber])
  @@index([albumId])
  @@index([songId])
}
```

---

## Updated songs.csv

Add `disc_number` column. Leave empty for single-disc albums (@default(1)).

```csv
slug,originalTitle,originalLanguage,artist_slugs,releaseDate,
variantLabel,baseVersion_slug,ko_title,en_title,sourceNote,
album_slug,disc_number,track_number

# Single disc — disc_number empty (defaults to 1)
dream-believers,Dream Believers,en,hasunosora,2023-06-28,
,,Dream Believers,Dream Believers,,
dream-believers-mini,,1

hanamusubi,ハナムスビ,ja,cerise-bouquet,2023-05-10,
,,하나무스비,Hanamusubi,,
cerise-bouquet-1st,,1

# Multi-disc album
song-disc1-track1,曲名A,ja,hasunosora,2025-xx-xx,
,,한국어,English,,
multi-disc-album,1,1

song-disc1-track2,曲名B,ja,hasunosora,2025-xx-xx,
,,한국어,English,,
multi-disc-album,1,2

song-disc2-track1,曲名C,ja,hasunosora,2025-xx-xx,
,,한국어,English,,
multi-disc-album,2,1

song-disc2-track2,曲名D,ja,hasunosora,2025-xx-xx,
,,한국어,English,,
multi-disc-album,2,2
```

---

## Updated import logic

```typescript
// src/lib/csv-import.ts

if (row.album_slug && row.track_number) {
  const album = await prisma.album.findUnique({
    where: { slug: row.album_slug }
  })
  if (album) {
    await prisma.albumTrack.upsert({
      where: {
        albumId_discNumber_trackNumber: {
          albumId: album.id,
          discNumber: row.disc_number ? parseInt(row.disc_number) : 1,
          trackNumber: parseInt(row.track_number)
        }
      },
      create: {
        albumId: album.id,
        songId: song.id,
        discNumber: row.disc_number ? parseInt(row.disc_number) : 1,
        trackNumber: parseInt(row.track_number)
      },
      update: { songId: song.id }
    })
  }
}
```

---

## Steps for ClaudeCode

1. Add `discNumber Int @default(1)` to `AlbumTrack` model (before `trackNumber`)
2. Update `@@unique([albumId, trackNumber])` → `@@unique([albumId, discNumber, trackNumber])`
3. Run `npx prisma db push`
4. Run `npx prisma generate`
5. Update `src/lib/csv-import.ts`:
   - Parse `disc_number` column from songs.csv
   - Pass to AlbumTrack upsert (default 1 if empty)
   - Update upsert `where` clause to include `discNumber`
6. Add `disc_number` column to songs.csv tab in Google Sheets
7. Verify: `npm run dev` → /api/health → { status: "ok", db: "connected" }
