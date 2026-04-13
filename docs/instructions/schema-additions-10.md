# schema-additions-10.md — Song.originalLanguage + Setlist title display

> Add originalLanguage field to Song.
> Update setlist view to show ko_title alongside originalTitle only when different.

---

## Background

```
Problem:
  originalTitle alone doesn't tell us what language it's in.
  "Dream Believers" → English? Japanese romaji?
  "眩耀夜行" → Japanese? Chinese?

  Without knowing the language:
  - Can't decide whether to show ko_title alongside
  - Can't decide whether to show translation button
  - Can't properly index for search

Solution:
  Add Song.originalLanguage field.
  Default "ja" — covers 95%+ of target IPs.
```

---

## Schema change

### Add originalLanguage to Song model

```prisma
model Song {
  id               BigInt            @id @default(autoincrement())
  slug             String            @unique
  originalTitle    String
  originalLanguage String            @default("ja")
  // Language of originalTitle.
  // Values: "ja" | "ko" | "en" | "zh-CN" | "zh-TW"
  // Default "ja" — covers Hasunosora, Uma Musume, Gakumas etc.
  // Set explicitly only when different from "ja".
  baseVersionId    BigInt?
  variantLabel     String?
  releaseDate      DateTime?         @db.Date
  sourceNote       String?
  isDeleted        Boolean           @default(false)
  deletedAt        DateTime?
  createdAt        DateTime          @default(now())

  baseVersion      Song?             @relation("SongVariants", fields: [baseVersionId], references: [id])
  variants         Song[]            @relation("SongVariants")
  artists          SongArtist[]
  translations     SongTranslation[]
  setlistItems     SetlistItemSong[]
  albumTracks      AlbumTrack[]

  @@index([baseVersionId])
  @@index([isDeleted])
}
```

---

## Updated songs.csv

Add `originalLanguage` column. Default "ja" — only fill when different.

```csv
slug,originalTitle,originalLanguage,artist_slug,releaseDate,...

# Japanese titles — originalLanguage can be omitted (default ja)
hanamusubi,ハナムスビ,,cerise-bouquet,2023-05-10,...
mabayuyakou,眩耀夜行,,cerise-bouquet,2023-08-09,...
suisaisekai,水彩世界,,dollchestra,2023-05-10,...

# English titles — set explicitly
dream-believers,Dream Believers,en,hasunosora,2023-06-28,...
birdcage,Birdcage,en,cerise-bouquet,2023-05-10,...
deepness,DEEPNESS,en,dollchestra,2023-05-10,...
on-your-mark,On your mark,en,hasunosora,2024-xx-xx,...

# Mixed — use ja (Japanese song even if title has English)
reflection-in-the-mirror,Reflection in the mirror,en,cerise-bouquet,2023-04-26,...
sparkly-spot,Sparkly Spot,en,dollchestra,2023-04-26,...
```

Note: Many Hasunosora songs have English titles but are Japanese releases.
Use `en` only when the title is genuinely English-language.
When in doubt, use `ja`.

---

## Title display logic

### src/lib/display.ts — add displaySongTitle()

```typescript
interface SongTitleDisplay {
  main: string    // always shown
  sub: string | null  // shown alongside if different from main
}

/**
 * Determines how to display a song title in the UI.
 *
 * Rules:
 *   1. main is always originalTitle
 *   2. sub (ko_title) is shown only when:
 *      - it exists
 *      - it differs from originalTitle
 *      - originalTitle is not already in Korean
 *
 * Examples:
 *   眩耀夜行 / ko: 현요야행  → main: 眩耀夜行, sub: 현요야행
 *   ハナムスビ / ko: (empty) → main: ハナムスビ, sub: null
 *   Dream Believers / ko: Dream Believers → main: Dream Believers, sub: null
 *   Dream Believers / ko: (empty)         → main: Dream Believers, sub: null
 */
export function displaySongTitle(
  song: { originalTitle: string; originalLanguage: string },
  translation: { title: string } | null,
  displayLocale: string = 'ko'
): SongTitleDisplay {
  const main = song.originalTitle

  // If originalTitle is already in the display locale, no sub needed
  if (song.originalLanguage === displayLocale) {
    return { main, sub: null }
  }

  const localeTitle = translation?.title ?? null

  // No translation or same as original → no sub
  if (!localeTitle || localeTitle === main) {
    return { main, sub: null }
  }

  return { main, sub: localeTitle }
}
```

---

## Setlist view — UI changes

### SetlistItem component

```tsx
// components/SetlistItem.tsx (or equivalent)

import { displaySongTitle } from '@/lib/display'

function SetlistItemRow({ item, locale }) {
  const song = item.songs[0]?.song
  const translation = song?.translations.find(t => t.locale === locale)

  if (!song) {
    // MC / video / interval — no song
    return (
      <div className="setlist-item">
        <span className="position">{item.position}</span>
        <span className="item-type">{getItemTypeLabel(item.type, locale)}</span>
        {item.note && <span className="note">{item.note}</span>}
      </div>
    )
  }

  const { main, sub } = displaySongTitle(song, translation ?? null, locale)

  return (
    <div className="setlist-item">
      <span className="position">{item.position}</span>
      <div className="song-title">
        <a href={`/${locale}/songs/${song.id}/${song.slug}`}>
          <span className="main-title">{main}</span>
          {sub && (
            <span className="sub-title"> · {sub}</span>
          )}
        </a>
      </div>
      {/* Artist / unit display */}
      {item.artists.length > 0 && (
        <span className="unit">
          {item.artists.map(a =>
            displayName(getTranslation(a.artist.translations, locale))
          ).join(', ')}
        </span>
      )}
      {/* Performers */}
      {item.performers.length > 0 && (
        <span className="performers">
          {item.performers.map(p =>
            displayName(getTranslation(p.stageIdentity.translations, locale))
          ).join(', ')}
        </span>
      )}
    </div>
  )
}
```

### CSS for sub-title

```css
.main-title {
  font-weight: 500;
}

.sub-title {
  font-size: 0.85em;
  color: var(--text-muted);  /* lighter color */
  margin-left: 4px;
}
```

---

## Translation button logic (Phase 2)

`originalLanguage` also controls when to show the translation button:

```typescript
function shouldShowTranslateButton(
  song: { originalLanguage: string },
  userKnownLocales: string[]
): boolean {
  // Don't show if user already knows the original language
  return !userKnownLocales.includes(song.originalLanguage)
}

// Examples:
// Korean user (knownLocales: ["ko"]), Japanese song → show button ✅
// Korean user, English song → show button ✅ (unless "en" in knownLocales)
// Japanese user, Japanese song → don't show ✅
```

---

## Meilisearch indexing (Phase 3)

When Meilisearch is configured, index all title fields:

```typescript
// All of these should be searchable:
{
  id: song.id,
  originalTitle: song.originalTitle,      // ハナムスビ
  originalLanguage: song.originalLanguage, // ja
  titles: [
    song.originalTitle,                    // ハナムスビ
    ...song.translations.map(t => t.title) // 하나무스비, Hanamusubi (en later)
  ]
}

// searchableAttributes: ['originalTitle', 'titles']
// → "하나무스비" or "ハナムスビ" both hit the same song
```

---

## Examples — before and after

```
Before:
  Setlist shows ko_title always:
  "하나무스비"  ← awkward, fans use Japanese
  "수채세계"    ← OK for Korean fans

After (displaySongTitle):
  ハナムスビ              ← no ko_title (empty) → original only
  水彩世界 · 수채세계    ← ko_title differs → show both
  Dream Believers        ← ko_title same → original only
  眩耀夜行 · 현요야행   ← ko_title differs → show both
  DEEPNESS               ← no ko_title → original only
```

---

## Steps for ClaudeCode

**Schema:**
1. Add `originalLanguage String @default("ja")` to `Song` model (after `originalTitle`)
2. Run `npx prisma db push`
3. Run `npx prisma generate`

**Code:**
4. Add `displaySongTitle()` to `src/lib/display.ts`
5. Update SetlistItem component to use `displaySongTitle()`
   - main title: always shown, linked to song page
   - sub title: shown alongside in muted style when different
6. Update Song page title to also use `displaySongTitle()`
7. Update search results list to use `displaySongTitle()`

**CSV:**
8. Add `originalLanguage` column to songs.csv in Google Sheets
   - Default empty = "ja" (import script uses @default("ja"))
   - Fill "en" for English-titled songs explicitly

**Verify:**
9. Check setlist page: 眩耀夜行 shows "眩耀夜行 · 현요야행"
10. Check setlist page: ハナムスビ shows "ハナムスビ" only
11. Check setlist page: Dream Believers shows "Dream Believers" only
