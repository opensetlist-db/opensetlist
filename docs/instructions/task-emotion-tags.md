# Task: Implement Emotion Tags (Reaction Buttons + Trending Songs)

> Pass this file to a Claude Code session working on the opensetlist codebase.
> This is a self-contained task spec with all context needed for implementation.

---

## Context

**Project:** OpenSetlist — a setlist database for anime/game live events.
**Stack:** Next.js 14 (App Router), TypeScript, Prisma 7, PostgreSQL (Supabase), next-intl for i18n.
**Prisma client import:** `import { prisma } from '@/lib/prisma'` (singleton in `src/lib/prisma.ts`)
**Generated client path:** `src/generated/prisma`
**IDs are BigInt** throughout the schema. All existing tables use `BigInt @id @default(autoincrement())`.
**Locale routing:** All pages are under `app/[locale]/`. The locale param is always available.
**i18n:** Uses next-intl. Translation files at `messages/ko.json`, `messages/ja.json`, `messages/en.json`.

---

## What to Build

Reaction buttons on each SetlistItem (each song in a concert setlist). Four emoji reactions that users can toggle on/off without logging in. Aggregate reactions into a "trending songs" display at the top of each event page.

---

## 1. Schema

Add to `prisma/schema.prisma`:

```prisma
model SetlistItemReaction {
  id            BigInt   @id @default(autoincrement())
  setlistItemId BigInt
  reactionType  String   // "waiting" | "best" | "surprise" | "moved"
  createdAt     DateTime @default(now())

  setlistItem   SetlistItem @relation(fields: [setlistItemId], references: [id])

  @@index([setlistItemId, reactionType])
}
```

Then add the relation to the existing `SetlistItem` model:

```prisma
model SetlistItem {
  // ...existing fields...
  reactions SetlistItemReaction[]
}
```

**Important:** No `ipHash`, no `userId`, no user identifier of any kind. Each row is one anonymous reaction. Dedup is client-side only (localStorage).

After adding the schema, run:
```bash
npx prisma generate
npx prisma db push
```

(`db push` does NOT auto-run `generate` in Prisma 7 — must run both.)

---

## 2. Reaction Types

| Key | Emoji | ko | ja | en |
|---|---|---|---|---|
| `waiting` | 😭 | 기다렸어 | 待ってた | Finally! |
| `best` | 🔥 | 최고 | 最高 | Amazing |
| `surprise` | 😱 | 깜짝 | サプライズ | Surprise |
| `moved` | 🩷 | 감동 | 感動 | Emotional |

---

## 3. i18n Keys

Add to each locale's message file:

```json
{
  "reaction": {
    "waiting": "기다렸어",
    "best": "최고",
    "surprise": "깜짝",
    "moved": "감동",
    "trending": "이번 공연 화제의 곡"
  }
}
```

```json
{
  "reaction": {
    "waiting": "待ってた",
    "best": "最高",
    "surprise": "サプライズ",
    "moved": "感動",
    "trending": "この公演の話題曲"
  }
}
```

```json
{
  "reaction": {
    "waiting": "Finally!",
    "best": "Amazing",
    "surprise": "Surprise",
    "moved": "Emotional",
    "trending": "Trending songs"
  }
}
```

---

## 4. API Routes

### POST /api/reactions — Add a reaction

```typescript
// app/api/reactions/route.ts

import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

const VALID_TYPES = ['waiting', 'best', 'surprise', 'moved']

export async function POST(req: NextRequest) {
  const { setlistItemId, reactionType } = await req.json()

  if (!setlistItemId || !VALID_TYPES.includes(reactionType)) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const reaction = await prisma.setlistItemReaction.create({
    data: {
      setlistItemId: BigInt(setlistItemId),
      reactionType,
    },
  })

  // Return updated counts for this setlist item
  const counts = await getReactionCounts(BigInt(setlistItemId))
  return NextResponse.json({ reactionId: reaction.id.toString(), counts })
}

export async function DELETE(req: NextRequest) {
  const { reactionId } = await req.json()

  if (!reactionId) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  await prisma.setlistItemReaction.delete({
    where: { id: BigInt(reactionId) },
  })

  return NextResponse.json({ ok: true })
}

async function getReactionCounts(setlistItemId: bigint) {
  const groups = await prisma.setlistItemReaction.groupBy({
    by: ['reactionType'],
    where: { setlistItemId },
    _count: true,
  })

  const counts: Record<string, number> = {}
  for (const g of groups) {
    counts[g.reactionType] = g._count
  }
  return counts
}
```

### GET /api/reactions?eventId=N — Get all counts for an event

```typescript
// app/api/reactions/route.ts (add GET handler)

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get('eventId')
  if (!eventId) {
    return NextResponse.json({ error: 'eventId required' }, { status: 400 })
  }

  // Get counts grouped by setlistItemId and reactionType
  const groups = await prisma.setlistItemReaction.groupBy({
    by: ['setlistItemId', 'reactionType'],
    where: {
      setlistItem: { eventId: BigInt(eventId), isDeleted: false },
    },
    _count: true,
  })

  // Shape: { [setlistItemId]: { waiting: N, best: N, ... } }
  const result: Record<string, Record<string, number>> = {}
  for (const g of groups) {
    const key = g.setlistItemId.toString()
    if (!result[key]) result[key] = {}
    result[key][g.reactionType] = g._count
  }

  return NextResponse.json(result)
}
```

**Note on BigInt serialization:** BigInt cannot be serialized to JSON natively. When returning BigInt values, convert to string with `.toString()`. If you hit serialization errors, add a BigInt JSON serializer or convert before returning.

---

## 5. localStorage Structure

```typescript
// Key: `reactions-{setlistItemId}`
// Value: { [reactionType]: reactionId }
//
// Example:
// localStorage['reactions-42'] = '{"waiting":"1001","moved":"1003"}'
//
// reactionId is the server-side row ID (as string).
// Used for DELETE requests when toggling off.
// If a key exists for a reactionType, that reaction is "active" for this user.
```

---

## 6. React Component

```typescript
// components/ReactionButtons.tsx

'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

const REACTIONS = [
  { type: 'waiting', emoji: '😭' },
  { type: 'best', emoji: '🔥' },
  { type: 'surprise', emoji: '😱' },
  { type: 'moved', emoji: '🩷' },
] as const

interface Props {
  setlistItemId: string  // BigInt as string
  initialCounts: Record<string, number>  // { waiting: 5, best: 3, ... }
}

export function ReactionButtons({ setlistItemId, initialCounts }: Props) {
  const t = useTranslations('reaction')
  const [counts, setCounts] = useState(initialCounts)
  const [myReactions, setMyReactions] = useState<Record<string, string>>({})
  // myReactions: { reactionType: reactionId } — tracks active reactions

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(`reactions-${setlistItemId}`)
    if (saved) {
      try { setMyReactions(JSON.parse(saved)) } catch {}
    }
  }, [setlistItemId])

  // Save to localStorage on change
  useEffect(() => {
    localStorage.setItem(
      `reactions-${setlistItemId}`,
      JSON.stringify(myReactions)
    )
  }, [myReactions, setlistItemId])

  const handleToggle = async (reactionType: string) => {
    const existingId = myReactions[reactionType]

    if (existingId) {
      // Remove reaction
      await fetch('/api/reactions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reactionId: existingId }),
      })
      setMyReactions(prev => {
        const next = { ...prev }
        delete next[reactionType]
        return next
      })
      setCounts(prev => ({
        ...prev,
        [reactionType]: Math.max(0, (prev[reactionType] ?? 0) - 1),
      }))
    } else {
      // Add reaction
      const res = await fetch('/api/reactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setlistItemId, reactionType }),
      })
      const { reactionId, counts: newCounts } = await res.json()
      setMyReactions(prev => ({ ...prev, [reactionType]: reactionId }))
      setCounts(newCounts)
    }
  }

  return (
    <div className="flex gap-2">
      {REACTIONS.map(({ type, emoji }) => {
        const isActive = !!myReactions[type]
        const count = counts[type] ?? 0
        return (
          <button
            key={type}
            onClick={() => handleToggle(type)}
            className={isActive ? 'opacity-100' : 'opacity-50'}
            title={t(type)}
          >
            {emoji} {count > 0 && count}
          </button>
        )
      })}
    </div>
  )
}
```

**Styling note:** This is a skeleton — adapt to the existing design system / CSS approach in the codebase. The key UX: active reactions are full opacity, inactive are dimmed. Always show emoji + label. Show count only if > 0.

---

## 7. Trending Songs Component

Display TOP3 most-reacted songs at the top of the event page.

```typescript
// components/TrendingSongs.tsx

'use client'

import { useTranslations } from 'next-intl'

interface TrendingSong {
  setlistItemId: string
  songTitle: string        // display title in current locale
  totalReactions: number
  topReaction: { type: string; emoji: string; count: number }
}

interface Props {
  songs: TrendingSong[]  // already sorted, max 3
}

const EMOJI_MAP: Record<string, string> = {
  waiting: '😭', best: '🔥', surprise: '😱', moved: '🩷',
}

const MEDALS = ['🥇', '🥈', '🥉']

export function TrendingSongs({ songs }: Props) {
  const t = useTranslations('reaction')

  if (songs.length === 0) return null

  return (
    <section>
      <h3>{t('trending')}</h3>
      <ul>
        {songs.map((song, i) => (
          <li key={song.setlistItemId}>
            {MEDALS[i]} {song.songTitle}{' '}
            {EMOJI_MAP[song.topReaction.type]}{song.topReaction.count}
          </li>
        ))}
      </ul>
    </section>
  )
}
```

### Server-side data for trending songs

In the event page server component, compute trending songs:

```typescript
// In the event page server component or a helper function

async function getTrendingSongs(eventId: bigint, locale: string) {
  // Get reaction counts per setlist item
  const groups = await prisma.setlistItemReaction.groupBy({
    by: ['setlistItemId'],
    where: {
      setlistItem: { eventId, isDeleted: false },
    },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 3,
  })

  if (groups.length === 0) return []

  // Fetch setlist items with song info for the top 3
  const itemIds = groups.map(g => g.setlistItemId)
  const items = await prisma.setlistItem.findMany({
    where: { id: { in: itemIds } },
    include: {
      songs: {
        include: {
          song: { include: { translations: true } }
        },
        orderBy: { order: 'asc' },
        take: 1,
      },
    },
  })

  // Get per-type breakdown for top items
  const typeBreakdown = await prisma.setlistItemReaction.groupBy({
    by: ['setlistItemId', 'reactionType'],
    where: { setlistItemId: { in: itemIds } },
    _count: true,
  })

  // Assemble result
  // (combine groups, items, and typeBreakdown into TrendingSong[])
  // Return sorted by total reaction count desc
}
```

---

## 8. Integration Points

### Event page (`app/[locale]/events/[id]/[[...slug]]/page.tsx`)

1. **Server component:** Fetch reaction counts for all setlist items in this event (single query). Compute trending songs TOP3. Pass both as props.
2. **Setlist list:** Render `<ReactionButtons>` under each SetlistItem row, passing `setlistItemId` and `initialCounts`.
3. **Top of page:** Render `<TrendingSongs>` above the setlist if any reactions exist.

### Existing SetlistItem display

The setlist is already rendered with member/unit info. Add `<ReactionButtons>` below each item. Do not change the existing layout — just append.

---

## 9. Rules & Constraints

- **No IP collection.** No `ipHash`, no `x-forwarded-for` reading, no user fingerprinting.
- **No login required.** Reactions work for all visitors.
- **Multiple tags per song:** A user can react with 😭 AND 🔥 on the same song.
- **No time limit:** Past events are always open for reactions.
- **Toggle behavior:** Tapping an active reaction removes it (DELETE the server row).
- **SetlistItem IDs are BigInt.** Always convert with `BigInt()` in API routes.
- **Soft delete awareness:** Filter `isDeleted: false` when querying SetlistItems.
- **BigInt JSON serialization:** Convert BigInt to string before JSON.stringify. This is a known Prisma/JS issue — handle it in API responses.

---

## 10. Testing Checklist

```
[ ] Schema migration succeeds (prisma generate + db push)
[ ] POST /api/reactions creates a row, returns counts
[ ] DELETE /api/reactions removes the row
[ ] GET /api/reactions?eventId=N returns grouped counts
[ ] ReactionButtons renders 4 buttons with counts
[ ] Clicking a reaction toggles it (active/inactive state)
[ ] localStorage persists reaction state across page reloads
[ ] Clicking same reaction again removes it (DELETE + localStorage update)
[ ] Multiple reactions on same song work (e.g. 😭 + 🔥)
[ ] Trending songs TOP3 displays correctly on event page
[ ] Trending section hidden when no reactions exist
[ ] Works in all 3 locales (ko/ja/en labels correct)
[ ] Mobile layout works (buttons fit on small screens)
[ ] BigInt serialization doesn't cause errors in API responses
```
