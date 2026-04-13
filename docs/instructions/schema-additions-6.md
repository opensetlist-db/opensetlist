# schema-additions-6.md — Album slug + nullable artistId + AlbumTranslation shortName

> Changes to support Album references in songs.csv at data entry time.
> Avoids having to re-link songs to albums later.

---

## Background

When entering Song data from the discography page, album info is visible
at the same time. Entering album_slug in songs.csv now avoids a second
pass to link songs to albums later.

Requires:
1. Album.slug — stable identifier for CSV cross-reference
2. Album.artistId nullable — split singles and compilations have no single artist
3. AlbumTranslation.shortName — consistency with other translation models
4. albums.csv — new CSV file (imported before songs.csv)
5. songs.csv — add album_slug and track_number columns

---

## Updated Models

### Album (UPDATED — add slug, make artistId nullable)

```prisma
model Album {
  id          String             @id @default(uuid())
  slug        String             @unique
  // Stable identifier for CSV import and cross-reference.
  // e.g. "dream-believers-mini", "cerise-bouquet-1st", "split-1st"

  artistId    BigInt?
  // null for split singles (multiple units) and compilations.
  // Set for unit albums and group albums.

  type        AlbumType
  releaseDate DateTime?          @db.Date
  labelName   String?
  imageUrl    String?
  createdAt   DateTime           @default(now())

  artist      Artist?            @relation(fields: [artistId], references: [id])
  translations AlbumTranslation[]
  tracks      AlbumTrack[]

  @@index([artistId])
}
```

### AlbumTranslation (UPDATED — add shortName)

```prisma
model AlbumTranslation {
  id        String @id @default(uuid())
  albumId   String
  locale    String
  title     String
  shortName String?
  // Usually null — album titles are rarely shortened.
  // Use if official abbreviated title exists.

  album     Album  @relation(fields: [albumId], references: [id])
  @@unique([albumId, locale])
  @@index([albumId])
}
```

---

## AlbumType enum reference

```prisma
enum AlbumType {
  single      // single / split single
  album       // full album
  ep          // mini album / EP
  live_album  // live recording album
  soundtrack  // game/anime OST
}
```

Usage for Hasunosora:
```
Dream Believers (デビューミニアルバム) → ep
Unit albums (各ユニット 1st, 2nd...) → ep
Split singles (ユニットスプリットシングル) → single
Singles (単独シングル) → single
Graduation albums (卒業アルバム) → album
Streaming-only collections → ep
```

---

## New CSV: albums.csv

Import this BEFORE songs.csv.

```csv
slug,type,artist_slug,releaseDate,ja_title,ko_title,labelName

# 전체 그룹 앨범 (Full group)
dream-believers-mini,ep,hasunosora,2023-06-28,Dream Believers,Dream Believers,Lantis
dream-believers-104,ep,hasunosora,2024-04-10,Dream Believers (104期 Ver.),Dream Believers (104기 Ver.),Lantis
dream-believers-105,ep,hasunosora,2025-04-09,Dream Believers (105期 Ver.),Dream Believers (105기 Ver.),Lantis

# Cerise Bouquet / スリーズブーケ
cerise-bouquet-1st,ep,cerise-bouquet,2023-05-10,スリーズブーケ,스리즈 부케,Lantis
cerise-bouquet-2nd,ep,cerise-bouquet,2023-11-22,スリーズブーケ 2nd,스리즈 부케 2nd,Lantis
cerise-bouquet-3rd,ep,cerise-bouquet,2024-09-25,スリーズブーケ 3rd,스리즈 부케 3rd,Lantis

# DOLLCHESTRA / ドルケストラ
dollchestra-1st,ep,dollchestra,2023-05-10,ドルケストラ,돌체스트라,Lantis
dollchestra-2nd,ep,dollchestra,2023-11-22,ドルケストラ 2nd,돌체스트라 2nd,Lantis
dollchestra-3rd,ep,dollchestra,2024-09-25,ドルケストラ 3rd,돌체스트라 3rd,Lantis

# Mira-Cra Park! / みらくらぱーく！
mira-cra-park-1st,ep,mira-cra-park,2023-11-29,みらくらぱーく！,미라크라 파크,Lantis
mira-cra-park-2nd,ep,mira-cra-park,2024-09-25,みらくらぱーく！2nd,미라크라 파크 2nd,Lantis

# Edel Note
edel-note-1st,ep,edel-note,2025-xx-xx,Edel Note 1st,에델 노트 1st,Lantis

# 스플릿 싱글 (Split singles — no single artist, artist_slug empty)
split-1st,single,,2024-03-27,1st ユニットスプリットシングル,1st 유닛 스플릿 싱글,Lantis
split-2nd,single,,2024-09-25,2nd ユニットスプリットシングル,2nd 유닛 스플릿 싱글,Lantis
split-3rd,single,,2025-02-19,3rd ユニットスプリットシングル,3rd 유닛 스플릿 싱글,Lantis
split-4th,single,,2026-02-18,4th ユニットスプリットシングル,4th 유닛 스플릿 싱글,Lantis

# 전체 그룹 싱글 (Group singles)
hasunosora-single-1st,single,hasunosora,2024-xx-xx,1stシングル,1st 싱글,Lantis

# 졸업 앨범 (Graduation albums — individual artist)
graduation-kozue,album,hasunosora,2025-03-31,～Star Sign Memories～ Otomune Kozue,～Star Sign Memories～ 오토무네 코즈에,Lantis
graduation-tsuzuri,album,hasunosora,2025-03-31,～Star Sign Memories～ Yugiri Tsuzuri,～Star Sign Memories～ 유기리 츠즈리,Lantis
graduation-megumi,album,hasunosora,2025-03-31,～Star Sign Memories～ Fujishima Megumi,～Star Sign Memories～ 후지시마 메구미,Lantis

# 스트리밍 한정 (Streaming only)
collection-104th,ep,hasunosora,2024-xx-xx,104th Collection,104th 컬렉션,Lantis
```

Note: Fill in exact dates while looking at the discography page.
`xx` placeholders should be replaced with actual dates.

---

## Updated songs.csv — add album_slug and track_number

```csv
slug,originalTitle,artist_slug,releaseDate,variantLabel,baseVersion_slug,
ja_title,ko_title,sourceNote,album_slug,track_number

# Cerise Bouquet 1st
hanamusubi,ハナムスビ,cerise-bouquet,2023-05-10,,,ハナムスビ,하나무스비,,cerise-bouquet-1st,1
birdcage,Birdcage,cerise-bouquet,2023-05-10,,,Birdcage,버드케이지,,cerise-bouquet-1st,2

# DOLLCHESTRA 1st
deepness,DEEPNESS,dollchestra,2023-05-10,,,DEEPNESS,DEEPNESS,,dollchestra-1st,1

# Dream Believers mini album
dream-believers,Dream Believers,hasunosora,2023-06-28,,,Dream Believers,Dream Believers,,dream-believers-mini,1

# Variants — baseVersion_slug references original
dream-believers-104,Dream Believers (104期 Ver.),hasunosora,2024-04-10,104期 Ver.,dream-believers,Dream Believers (104期 Ver.),Dream Believers (104기 Ver.),,dream-believers-104,1
dream-believers-105,Dream Believers (105期 Ver.),hasunosora,2025-04-09,105期 Ver.,dream-believers,Dream Believers (105期 Ver.),Dream Believers (105기 Ver.),,dream-believers-105,1

# Split singles — artist_slug is the unit that sings this specific song
# album_slug references the split single album
edelied,Edelied,cerise-bouquet,2024-03-27,,,Edelied,에델리에드,,split-1st,1
joushou-kiryuu,上昇気流にのせて,dollchestra,2024-03-27,,,上昇気流にのせて,조승기류,,split-1st,2
hana-mau-sekai,花咲く世界,mira-cra-park,2024-03-27,,,花咲く世界,꽃피는 세계,,split-1st,3
```

Note: For split singles, `artist_slug` = the unit that performs the song.
`album_slug` = the split single compilation slug.
Both fields are needed.

---

## Import logic update

```typescript
// src/lib/csv-import.ts

// Import order:
// 1. albums.csv  → Album + AlbumTranslation
// 2. songs.csv   → Song + SongTranslation + SongArtist + AlbumTrack

// albums.csv import
async function importAlbums(rows) {
  for (const row of rows) {
    const artistId = row.artist_slug
      ? artistMap.get(row.artist_slug)
      : null  // null for split singles

    await prisma.album.upsert({
      where: { slug: row.slug },
      create: {
        slug: row.slug,
        artistId,
        type: row.type,
        releaseDate: row.releaseDate ? new Date(row.releaseDate) : null,
        labelName: row.labelName || null,
        translations: {
          create: [
            { locale: 'ja', title: row.ja_title },
            { locale: 'ko', title: row.ko_title },
          ].filter(t => t.title)
        }
      },
      update: {
        artistId,
        type: row.type,
        releaseDate: row.releaseDate ? new Date(row.releaseDate) : null,
        labelName: row.labelName || null,
      }
    })
  }
}

// songs.csv import — add AlbumTrack creation
async function importSongs(rows) {
  for (const row of rows) {
    const song = await prisma.song.upsert({
      where: { slug: row.slug },
      create: { slug: row.slug, originalTitle: row.originalTitle, ... },
      update: { ... }
    })

    // Create AlbumTrack if album_slug provided
    if (row.album_slug && row.track_number) {
      const album = await prisma.album.findUnique({
        where: { slug: row.album_slug }
      })
      if (album) {
        await prisma.albumTrack.upsert({
          where: { albumId_trackNumber: {
            albumId: album.id,
            trackNumber: parseInt(row.track_number)
          }},
          create: {
            albumId: album.id,
            songId: song.id,
            trackNumber: parseInt(row.track_number)
          },
          update: { songId: song.id }
        })
      }
    }
  }
}
```

---

## Updated import order (all CSV files)

```
1. artists.csv
2. members.csv
3. albums.csv      ← NEW (before songs)
4. songs.csv       ← now includes album_slug, track_number
5. events.csv
6. setlistitems.csv
```

---

## Steps for ClaudeCode

1. Add `slug String @unique` to `Album` model
2. Change `Album.artistId` from `BigInt` to `BigInt?` (nullable)
3. Add `shortName String?` to `AlbumTranslation` model
4. Run `npx prisma db push`
5. Run `npx prisma generate`
6. Update `src/lib/csv-import.ts`:
   - Add `importAlbums()` function for albums.csv
   - Add `album_slug` and `track_number` parsing to `importSongs()`
   - Create `AlbumTrack` rows during song import
   - Update import order: albums before songs
7. Add albums.csv tab to Google Sheets
8. Add `album_slug` and `track_number` columns to songs.csv tab
9. Verify: `npm run dev` → /api/health → { status: "ok", db: "connected" }
