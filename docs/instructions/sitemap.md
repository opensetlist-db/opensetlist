# sitemap.md — Next.js Sitemap Implementation

> Add sitemap.xml for Google Search Console and Naver Search Advisor.
> Next.js App Router generates /sitemap.xml automatically from app/sitemap.ts.

---

## Create app/sitemap.ts

```typescript
import { MetadataRoute } from 'next'
import { prisma } from '@/lib/prisma'
import { BASE_URL } from '@/lib/config'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: `${BASE_URL}/ko`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
  ]

  // Events
  const events = await prisma.event.findMany({
    where: { isDeleted: false },
    include: { translations: true },
    orderBy: { date: 'desc' },
  })

  const eventPages: MetadataRoute.Sitemap = events.map(event => ({
    url: `${BASE_URL}/ko/events/${event.id}/${event.slug}`,
    lastModified: event.createdAt,
    changeFrequency: 'weekly' as const,
    priority: 0.9,
  }))

  // EventSeries
  const series = await prisma.eventSeries.findMany({
    where: { isDeleted: false },
  })

  const seriesPages: MetadataRoute.Sitemap = series.map(s => ({
    url: `${BASE_URL}/ko/series/${s.id}/${s.slug}`,
    lastModified: s.createdAt,
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }))

  // Artists
  const artists = await prisma.artist.findMany({
    where: { isDeleted: false },
  })

  const artistPages: MetadataRoute.Sitemap = artists.map(artist => ({
    url: `${BASE_URL}/ko/artists/${artist.id}/${artist.slug}`,
    lastModified: artist.createdAt,
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }))

  // Songs
  const songs = await prisma.song.findMany({
    where: { isDeleted: false },
  })

  const songPages: MetadataRoute.Sitemap = songs.map(song => ({
    url: `${BASE_URL}/ko/songs/${song.id}/${song.slug}`,
    lastModified: song.createdAt,
    changeFrequency: 'monthly' as const,
    priority: 0.6,
  }))

  return [
    ...staticPages,
    ...eventPages,
    ...seriesPages,
    ...artistPages,
    ...songPages,
  ]
}
```

---

## Create app/robots.ts

```typescript
import { MetadataRoute } from 'next'
import { BASE_URL } from '@/lib/config'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin/', '/api/'],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  }
}
```

---

## Verify after deploy

```
# Check sitemap is generated
open https://opensetlist.vercel.app/sitemap.xml

# Check robots.txt
open https://opensetlist.vercel.app/robots.txt
```

Both should return valid content.

---

## Submit to search engines

### Google Search Console
1. search.google.com/search-console
2. Select opensetlist.com property
3. Left menu → Sitemaps
4. Enter: sitemap.xml → Submit

### Naver Search Advisor
1. searchadvisor.naver.com
2. 사이트 등록 → opensetlist.com
3. 소유확인 (DNS TXT 또는 HTML 파일)
4. 요청 → 사이트맵 제출
5. 입력: https://opensetlist.vercel.app/sitemap.xml

---

## Steps for ClaudeCode

1. Create `app/sitemap.ts`
2. Create `app/robots.ts`
3. Deploy
4. Verify `/sitemap.xml` and `/robots.txt` return correct content
