# og-cards.md — OG Card Implementation

> Implement Open Graph meta tags and dynamic OG images for Event, Song, and Artist pages.
> OG cards appear when links are shared on Twitter/X, KakaoTalk, Discord, etc.

---

## Overview

Two parts:
1. `generateMetadata()` — meta tags in each page's `<head>`
2. `/api/og/[type]/[id]` — dynamic OG image (1200×630px)

---

## Part 1 — generateMetadata()

Add to each page file. Do NOT replace existing page logic — add alongside it.

### Event page
`app/[locale]/events/[id]/[[...slug]]/page.tsx`

```typescript
import { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { getTranslation } from '@/lib/i18n'
import { displayName } from '@/lib/display'

export async function generateMetadata({
  params
}: {
  params: { id: string; locale: string; slug?: string[] }
}): Promise<Metadata> {
  const event = await prisma.event.findUnique({
    where: { id: BigInt(params.id) },
    include: {
      translations: true,
      eventSeries: { include: { translations: true } }
    }
  })

  if (!event) return {}

  const t = getTranslation(event.translations, params.locale)
  const seriesT = getTranslation(event.eventSeries?.translations ?? [], params.locale)

  const title = `${displayName(t)} 셋리스트 | OpenSetlist`
  const description = [
    event.date
      ? new Date(event.date).toLocaleDateString('ko-KR', {
          year: 'numeric', month: 'long', day: 'numeric'
        })
      : '',
    t?.city,
    t?.venue,
  ].filter(Boolean).join(' · ')

  const ogImage = `https://opensetlist.com/api/og/event/${params.id}`
  const pageUrl = `https://opensetlist.com/${params.locale}/events/${params.id}/${event.slug}`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: pageUrl,
      siteName: 'OpenSetlist',
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
      locale: params.locale,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
      site: '@opensetlistdb',
    },
  }
}
```

### Song page
`app/[locale]/songs/[id]/[[...slug]]/page.tsx`

```typescript
export async function generateMetadata({
  params
}: {
  params: { id: string; locale: string }
}): Promise<Metadata> {
  const song = await prisma.song.findUnique({
    where: { id: BigInt(params.id) },
    include: {
      translations: true,
      artists: { include: { artist: { include: { translations: true } } } }
    }
  })

  if (!song) return {}

  const t = getTranslation(song.translations, params.locale)
  const artistT = song.artists[0]
    ? getTranslation(song.artists[0].artist.translations, params.locale)
    : null

  const title = `${t?.title ?? song.originalTitle} | OpenSetlist`
  const description = artistT
    ? `${displayName(artistT)} · 공연 이력 및 셋리스트`
    : '공연 이력 및 셋리스트'

  const ogImage = `https://opensetlist.com/api/og/song/${params.id}`
  const pageUrl = `https://opensetlist.com/${params.locale}/songs/${params.id}/${song.slug}`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: pageUrl,
      siteName: 'OpenSetlist',
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
      locale: params.locale,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
      site: '@opensetlistdb',
    },
  }
}
```

### Artist page
`app/[locale]/artists/[id]/[[...slug]]/page.tsx`

```typescript
export async function generateMetadata({
  params
}: {
  params: { id: string; locale: string }
}): Promise<Metadata> {
  const artist = await prisma.artist.findUnique({
    where: { id: BigInt(params.id) },
    include: { translations: true }
  })

  if (!artist) return {}

  const t = getTranslation(artist.translations, params.locale)

  const title = `${displayName(t, 'full')} | OpenSetlist`
  const description = `${displayName(t)} 공연 셋리스트 데이터베이스`

  const ogImage = `https://opensetlist.com/api/og/artist/${params.id}`
  const pageUrl = `https://opensetlist.com/${params.locale}/artists/${params.id}/${artist.slug}`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: pageUrl,
      siteName: 'OpenSetlist',
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
      locale: params.locale,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
      site: '@opensetlistdb',
    },
  }
}
```

---

## Part 2 — Dynamic OG Images

### Event OG image
`app/api/og/event/[id]/route.tsx`

```typescript
import { ImageResponse } from 'next/og'
import { prisma } from '@/lib/prisma'
import { getTranslation } from '@/lib/i18n'
import { displayName } from '@/lib/display'

export const runtime = 'edge'

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const event = await prisma.event.findUnique({
    where: { id: BigInt(params.id) },
    include: {
      translations: true,
      eventSeries: { include: { translations: true } }
    }
  })

  if (!event) return new Response('Not found', { status: 404 })

  const t = getTranslation(event.translations, 'ko')
  const seriesT = getTranslation(event.eventSeries?.translations ?? [], 'ko')

  const dateStr = event.date
    ? new Date(event.date).toLocaleDateString('ko-KR', {
        year: 'numeric', month: 'long', day: 'numeric'
      })
    : ''

  const subtitle = [dateStr, t?.city, t?.venue]
    .filter(Boolean)
    .join(' · ')

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          background: 'linear-gradient(135deg, #0f0f1a 0%, #1a1a3e 60%, #2d1b4e 100%)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '70px 90px',
          fontFamily: 'sans-serif',
          color: 'white',
          position: 'relative',
        }}
      >
        {/* Left accent line */}
        <div style={{
          position: 'absolute',
          left: '0',
          top: '0',
          bottom: '0',
          width: '6px',
          background: 'linear-gradient(180deg, #FB8A9B 0%, #9b8afb 100%)',
        }} />

        {/* Series name */}
        <div style={{
          fontSize: '26px',
          color: '#FB8A9B',
          marginBottom: '20px',
          letterSpacing: '0.03em',
        }}>
          {displayName(seriesT)}
        </div>

        {/* Event name */}
        <div style={{
          fontSize: '56px',
          fontWeight: 'bold',
          marginBottom: '32px',
          lineHeight: 1.2,
          letterSpacing: '-0.01em',
        }}>
          {displayName(t)}
        </div>

        {/* Date · City · Venue */}
        <div style={{
          fontSize: '26px',
          color: '#9999bb',
        }}>
          {subtitle}
        </div>

        {/* Site name */}
        <div style={{
          position: 'absolute',
          bottom: '44px',
          right: '90px',
          fontSize: '22px',
          color: '#444466',
          letterSpacing: '0.05em',
        }}>
          opensetlist.com
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  )
}
```

### Song OG image
`app/api/og/song/[id]/route.tsx`

```typescript
import { ImageResponse } from 'next/og'
import { prisma } from '@/lib/prisma'
import { getTranslation } from '@/lib/i18n'
import { displayName } from '@/lib/display'

export const runtime = 'edge'

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const song = await prisma.song.findUnique({
    where: { id: BigInt(params.id) },
    include: {
      translations: true,
      artists: { include: { artist: { include: { translations: true } } } }
    }
  })

  if (!song) return new Response('Not found', { status: 404 })

  const t = getTranslation(song.translations, 'ko')
  const artistT = song.artists[0]
    ? getTranslation(song.artists[0].artist.translations, 'ko')
    : null

  const songTitle = t?.title ?? song.originalTitle
  const artistName = artistT ? displayName(artistT) : ''

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          background: 'linear-gradient(135deg, #0f0f1a 0%, #1a1a3e 60%, #2d1b4e 100%)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '70px 90px',
          fontFamily: 'sans-serif',
          color: 'white',
          position: 'relative',
        }}
      >
        {/* Left accent line */}
        <div style={{
          position: 'absolute',
          left: '0',
          top: '0',
          bottom: '0',
          width: '6px',
          background: 'linear-gradient(180deg, #FB8A9B 0%, #9b8afb 100%)',
        }} />

        {/* Label */}
        <div style={{
          fontSize: '24px',
          color: '#FB8A9B',
          marginBottom: '20px',
          letterSpacing: '0.05em',
        }}>
          SONG
        </div>

        {/* Song title */}
        <div style={{
          fontSize: '64px',
          fontWeight: 'bold',
          marginBottom: '24px',
          lineHeight: 1.15,
        }}>
          {songTitle}
        </div>

        {/* Artist name */}
        {artistName && (
          <div style={{
            fontSize: '30px',
            color: '#9999bb',
          }}>
            {artistName}
          </div>
        )}

        {/* Site name */}
        <div style={{
          position: 'absolute',
          bottom: '44px',
          right: '90px',
          fontSize: '22px',
          color: '#444466',
          letterSpacing: '0.05em',
        }}>
          opensetlist.com
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  )
}
```

---

## Testing

After deploying, verify:

```bash
# 1. Check OG image renders correctly
open https://opensetlist.com/api/og/event/1
open https://opensetlist.com/api/og/song/1

# 2. Check meta tags in browser
# DevTools → Elements → <head> → look for og:* and twitter:* tags

# 3. Twitter card validator
# https://cards-dev.twitter.com/validator
# Paste event URL → should show summary_large_image card

# 4. Kakao share preview
# Share any event URL in KakaoTalk → should show title + image
```

---

## Notes

- `export const runtime = 'edge'` on OG image routes for faster cold starts
- OG images are cached by Twitter/Kakao after first fetch — no repeated DB calls
- Artist OG image not included — implement same pattern as Song if needed
- Base URL is `https://opensetlist.com` — update if using different domain
