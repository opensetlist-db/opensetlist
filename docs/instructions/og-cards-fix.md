# og-cards-fix.md — OG Card Base URL Fix

> OG card images are not loading in Twitter/Kakao previews.
> Cause: hardcoded `opensetlist.com` domain not yet connected.
> Fix: use environment variable for base URL.

---

## Problem

```
Current og:image URL in meta tags:
  https://opensetlist.com/api/og/event/1  ← domain not connected yet

Twitter/Kakao tries to fetch this image → no response → card fails
```

---

## Fix — Use NEXT_PUBLIC_BASE_URL environment variable

### Step 1: Add to .env.local

```bash
NEXT_PUBLIC_BASE_URL=https://opensetlist.vercel.app
```

### Step 2: Add to .env.production (for Vercel)

In Vercel dashboard → Settings → Environment Variables:
```
NEXT_PUBLIC_BASE_URL = https://opensetlist.vercel.app
```

Update this to `https://opensetlist.com` after domain is connected.

### Step 3: Create src/lib/config.ts

```typescript
export const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ?? 'https://opensetlist.vercel.app'
```

### Step 4: Update all generateMetadata() calls

Replace hardcoded `https://opensetlist.com` with `BASE_URL`:

```typescript
// Before
const ogImage = `https://opensetlist.com/api/og/event/${params.id}`
const pageUrl = `https://opensetlist.com/${params.locale}/events/${params.id}/${event.slug}`

// After
import { BASE_URL } from '@/lib/config'

const ogImage = `${BASE_URL}/api/og/event/${params.id}`
const pageUrl = `${BASE_URL}/${params.locale}/events/${params.id}/${event.slug}`
```

Apply same fix to:
- Event page generateMetadata()
- Song page generateMetadata()
- Artist page generateMetadata()

### Step 5: Deploy and test

After deploying:
1. Open Twitter Card Validator: https://cards-dev.twitter.com/validator
2. Paste event page URL: https://opensetlist.vercel.app/ko/events/1/...
3. Should show summary_large_image card with OG image

Also test in KakaoTalk:
- Paste event URL in any chat
- Preview card should appear with title + image

---

## TODO before launch (2026-05-02)

- [ ] Apply BASE_URL fix above
- [ ] Verify OG card shows correctly in Twitter validator
- [ ] Verify OG card shows correctly in KakaoTalk
- [ ] **Connect opensetlist.com domain to Vercel**
      Vercel dashboard → Settings → Domains → Add domain
      Add DNS records in Namecheap
- [ ] After domain connected: update NEXT_PUBLIC_BASE_URL to https://opensetlist.com
      in Vercel environment variables → redeploy
- [ ] Submit sitemap to Google Search Console
- [ ] Submit sitemap to Naver Search Advisor
