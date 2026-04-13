# schema-additions-9.md — AlbumArtist junction table

> Replace Album.artistId (single artist) with AlbumArtist N:N junction.
> Supports split singles with multiple artists.
> albums.csv: replace artist_slug with artist_slugs (space-separated).

---

## Background

```
Before:
  Album.artistId BigInt?
  → null for split singles (no artist info)
  → single artist only

After:
  AlbumArtist junction table
  → one or many artists per album
  → split singles: [cerise-bouquet, dollchestra, mira-cra-park]
  → single artist albums: [hasunosora]
  → Album.artistId removed entirely
```

---

## Schema changes

### Remove from Album model

```prisma
model Album {
  id          String   @id @default(uuid())
  slug        String   @unique
  // REMOVE: artistId  BigInt?
  type        AlbumType
  releaseDate DateTime? @db.Date
  labelName   String?
  imageUrl    String?
  createdAt   DateTime @default(now())

  // REMOVE: artist   Artist?  @relation(...)
  translations AlbumTranslation[]
  tracks       AlbumTrack[]
  artists      AlbumArtist[]      // ← ADD
}
```

### New model: AlbumArtist

```prisma
model AlbumArtist {
  albumId   String  // Album.id (uuid)
  artistId  BigInt  // Artist.id

  album     Album   @relation(fields: [albumId], references: [id])
  artist    Artist  @relation(fields: [artistId], references: [id])

  @@unique([albumId, artistId])
  @@index([albumId])
  @@index([artistId])
}
```

### Add relation to Artist model

```prisma
model Artist {
  // ... existing fields ...
  albums    AlbumArtist[]  // ← ADD
}
```

---

## Updated albums.csv spec

```csv
slug,type,artist_slugs,releaseDate,ja_title,ko_title,labelName

# Single artist — one slug
dream-believers,ep,hasunosora,2023-03-29,Dream Believers,Dream Believers,Lantis
cerise-bouquet-1st,ep,cerise-bouquet,2023-05-10,スリーズブーケ,스리즈 부케,Lantis
dollchestra-1st,ep,dollchestra,2023-05-10,ドルケストラ,돌체스트라,Lantis
mira-cra-park-1st,ep,mira-cra-park,2023-11-29,みらくらぱーく！,미라크라 파크,Lantis

# Split singles — multiple slugs, space-separated
split-1st,single,cerise-bouquet dollchestra,2024-03-27,1st ユニットスプリットシングル,1st 유닛 스플릿 싱글,Lantis
split-2nd,single,cerise-bouquet dollchestra mira-cra-park,2024-09-25,2nd ユニットスプリットシングル,2nd 유닛 스플릿 싱글,Lantis
split-3rd,single,cerise-bouquet dollchestra mira-cra-park,2025-02-19,3rd ユニットスプリットシングル,3rd 유닛 스플릿 싱글,Lantis
split-4th,single,cerise-bouquet dollchestra mira-cra-park edel-note,2026-02-18,4th ユニットスプリットシングル,4th 유닛 스플릿 싱글,Lantis

# No artist (compilation etc.)
ijigen-bigbang,single,,2023-12-06,異次元★♥BIGBANG,이차원★♥BIGBANG,Lantis
```

`artist_slugs` is space-separated. Empty = no artist (compilation).

---

## Updated import logic

```typescript
// src/lib/csv-import.ts

async function importAlbums(rows: AlbumRow[]) {
  for (const row of rows) {
    // Upsert album (no artistId)
    const album = await prisma.album.upsert({
      where: { slug: row.slug },
      create: {
        slug: row.slug,
        type: row.type as AlbumType,
        releaseDate: row.releaseDate ? new Date(row.releaseDate) : null,
        labelName: row.labelName || null,
        translations: {
          create: [
            row.ja_title && { locale: 'ja', title: row.ja_title },
            row.ko_title && { locale: 'ko', title: row.ko_title },
          ].filter(Boolean)
        }
      },
      update: {
        type: row.type as AlbumType,
        releaseDate: row.releaseDate ? new Date(row.releaseDate) : null,
        labelName: row.labelName || null,
      }
    })

    // Upsert AlbumArtist rows
    if (row.artist_slugs) {
      const slugs = row.artist_slugs.trim().split(' ').filter(Boolean)

      for (const artistSlug of slugs) {
        const artist = await prisma.artist.findUnique({
          where: { slug: artistSlug }
        })
        if (!artist) {
          console.warn(`Artist not found: ${artistSlug}`)
          continue
        }
        await prisma.albumArtist.upsert({
          where: {
            albumId_artistId: { albumId: album.id, artistId: artist.id }
          },
          create: { albumId: album.id, artistId: artist.id },
          update: {}
        })
      }
    }
  }
}
```

---

## Query — all albums for an artist including sub-units

```typescript
// "하스노소라 앨범 전체" = hasunosora + all sub-units

async function getAlbumsForArtist(artistId: bigint) {
  // Get artist and all direct sub-units
  const artistAndSubunits = await prisma.artist.findMany({
    where: {
      OR: [
        { id: artistId },
        { parentArtistId: artistId }
      ]
    },
    select: { id: true }
  })

  const artistIds = artistAndSubunits.map(a => a.id)

  return prisma.album.findMany({
    where: {
      artists: {
        some: {
          artistId: { in: artistIds }
        }
      }
    },
    include: {
      artists: {
        include: {
          artist: { include: { translations: true } }
        }
      },
      translations: true,
    },
    orderBy: { releaseDate: 'desc' }
  })
}
```

---

## Steps for ClaudeCode

1. Remove `artistId BigInt?` field from `Album` model
2. Remove `artist Artist? @relation(...)` from `Album` model
3. Add `artists AlbumArtist[]` relation to `Album` model
4. Add `AlbumArtist` model
5. Add `albums AlbumArtist[]` relation to `Artist` model
6. Run `npx prisma db push`
7. Run `npx prisma generate`
8. Update `src/lib/csv-import.ts`:
   - Replace `artist_slug` column parsing with `artist_slugs`
   - Parse space-separated slugs
   - Create `AlbumArtist` rows for each slug
9. Update `getAlbumsForArtist()` query to use AlbumArtist junction
10. Verify: `npm run dev` → /api/health → { status: "ok", db: "connected" }
