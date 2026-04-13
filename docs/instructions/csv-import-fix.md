# csv-import-fix.md — Song multi-album import fix

> A song can appear on multiple albums (e.g. DEEPNESS on both dollchestra-1st and split-1st).
> songs.csv supports multiple rows with the same slug.
> Each row creates/updates the Song (upsert) and adds a new AlbumTrack.

---

## Problem

```
Current behavior:
  Second row with same slug → overwrites first AlbumTrack
  → Song only linked to last album in CSV

Expected behavior:
  Second row with same slug → Song upsert (no change) + new AlbumTrack added
  → Song linked to both albums
```

---

## Example songs.csv

```csv
slug,originalTitle,originalLanguage,artist_slugs,releaseDate,
variantLabel,baseVersion_slug,ko_title,en_title,sourceNote,
album_slug,disc_number,track_number

# DEEPNESS appears on two albums — two rows, same slug
deepness,DEEPNESS,en,dollchestra,2023-05-10,
,,,,,
dollchestra-1st,,1

deepness,DEEPNESS,en,dollchestra,2023-05-10,
,,,,,
split-1st,,3
```

Same slug = same Song. Each row adds one AlbumTrack.

---

## Updated import logic

```typescript
// src/lib/csv-import.ts

async function importSongs(rows: SongRow[]) {
  for (const row of rows) {
    // 1. Upsert Song (idempotent — same slug = update, not duplicate)
    const song = await prisma.song.upsert({
      where: { slug: row.slug },
      create: {
        slug: row.slug,
        originalTitle: row.originalTitle,
        originalLanguage: row.originalLanguage || 'ja',
        variantLabel: row.variantLabel || null,
        releaseDate: row.releaseDate ? new Date(row.releaseDate) : null,
        sourceNote: row.sourceNote || null,
      },
      update: {
        originalTitle: row.originalTitle,
        originalLanguage: row.originalLanguage || 'ja',
        variantLabel: row.variantLabel || null,
        releaseDate: row.releaseDate ? new Date(row.releaseDate) : null,
        sourceNote: row.sourceNote || null,
      }
    })

    // 2. Upsert SongTranslations
    const translations = [
      row.ko_title && { locale: 'ko', title: row.ko_title },
      row.ja_title && { locale: 'ja', title: row.ja_title },
      row.en_title && { locale: 'en', title: row.en_title },
    ].filter(Boolean)

    for (const t of translations) {
      await prisma.songTranslation.upsert({
        where: { songId_locale: { songId: song.id, locale: t.locale } },
        create: { songId: song.id, locale: t.locale, title: t.title },
        update: { title: t.title }
      })
    }

    // 3. Upsert SongArtist links
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
        await prisma.songArtist.upsert({
          where: { songId_artistId: { songId: song.id, artistId: artist.id } },
          create: { songId: song.id, artistId: artist.id },
          update: {}
        })
      }
    }

    // 4. Upsert baseVersion link
    if (row.baseVersion_slug) {
      const baseVersion = await prisma.song.findUnique({
        where: { slug: row.baseVersion_slug }
      })
      if (baseVersion) {
        await prisma.song.update({
          where: { id: song.id },
          data: { baseVersionId: baseVersion.id }
        })
      } else {
        console.warn(`Base version not found: ${row.baseVersion_slug}`)
      }
    }

    // 5. Upsert AlbumTrack — ADD, not replace
    //    Same song can appear on multiple albums.
    //    Each row with album_slug creates one AlbumTrack.
    if (row.album_slug && row.track_number) {
      const album = await prisma.album.findUnique({
        where: { slug: row.album_slug }
      })
      if (!album) {
        console.warn(`Album not found: ${row.album_slug}`)
      } else {
        const discNumber = row.disc_number ? parseInt(row.disc_number) : 1
        const trackNumber = parseInt(row.track_number)

        await prisma.albumTrack.upsert({
          where: {
            albumId_discNumber_trackNumber: {
              albumId: album.id,
              discNumber,
              trackNumber,
            }
          },
          create: {
            albumId: album.id,
            songId: song.id,
            discNumber,
            trackNumber,
          },
          update: {
            songId: song.id,
          }
        })
      }
    }
  }
}
```

---

## Key point

```
Song upsert: WHERE slug = row.slug
  → Same slug = update existing Song (no duplicate)
  → Different slug = create new Song

AlbumTrack upsert: WHERE albumId + discNumber + trackNumber
  → Each album gets its own AlbumTrack row
  → Same song can link to N albums
  → Running import twice is safe (idempotent)
```

---

## Verify

After importing songs.csv with DEEPNESS on two albums:

```sql
-- Should return 2 rows
SELECT a.slug, at.track_number
FROM "AlbumTrack" at
JOIN "Album" a ON at."albumId" = a.id
JOIN "Song" s ON at."songId" = s.id
WHERE s.slug = 'deepness';

-- Expected:
-- dollchestra-1st | 1
-- split-1st       | 3
```

---

## Steps for ClaudeCode

1. Update `importSongs()` in `src/lib/csv-import.ts`
   with the logic above
2. Ensure Song upsert does NOT clear existing AlbumTrack rows
   when the same slug appears again
3. Ensure AlbumTrack upsert uses
   `@@unique([albumId, discNumber, trackNumber])` as the where clause
4. Test with DEEPNESS: import twice → still 2 AlbumTrack rows, not 4
