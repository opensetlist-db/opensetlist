# TESTING.md — OpenSetlist Test Strategy

> This file defines the testing strategy for OpenSetlist.
> Read this before writing any tests.
> Tests live in `src/__tests__/` (unit/integration) and `e2e/` (E2E).

---

## Test Stack

```
Unit + Integration: Vitest
E2E:                Playwright
```

### Install

```bash
# Vitest
npm install -D vitest @vitest/ui @vitejs/plugin-react

# Playwright
npm install -D @playwright/test
npx playwright install
```

### vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

### package.json scripts

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui"
  }
}
```

---

## Folder Structure

```
src/
  __tests__/
    setup.ts              ← global test setup (DB connection etc.)
    unit/
      display.test.ts     ← displayName() helper
      translation.test.ts ← shouldShowTranslateButton()
      rollup.test.ts      ← computeRollup() logic
      csv.test.ts         ← CSV parsing + validation
    integration/
      import.test.ts      ← CSV import upsert
      comment.test.ts     ← comment creation + rollup ancestry
      fallback.test.ts    ← getTranslation() locale fallback
    api/
      health.test.ts      ← GET /api/health
      import-route.test.ts← POST /api/import validation
e2e/
  setlist.spec.ts         ← setlist page loads
  admin.spec.ts           ← admin setlist entry
  auth.spec.ts            ← login flow (Phase 1B)
```

---

## Priority — What to Test First

**"If this breaks, the site is broken."**

```
Priority 1 — test immediately:
  displayName() fallback
  shouldShowTranslateButton()
  /api/health

Priority 2 — before 후쿠오카 Day1 (2026-05-02):
  CSV import upsert (idempotency)
  setlist page E2E

Priority 3 — before Sprint 3 (rollup feature):
  computeRollup() — most critical, core differentiator
  comment creation + rollup ancestry integration test

Priority 4 — ongoing:
  getTranslation() locale fallback
  Report auto-hide threshold
  DictionaryTerm applyDictionary() substitution
```

---

## Unit Tests

### src/__tests__/unit/display.test.ts

```typescript
import { describe, it, expect } from 'vitest'
import { displayName } from '@/lib/display'

describe('displayName', () => {
  it('returns shortName when available', () => {
    expect(displayName({
      name: '蓮ノ空女学院スクールアイドルクラブ',
      shortName: '蓮ノ空'
    })).toBe('蓮ノ空')
  })

  it('falls back to name when shortName is null', () => {
    expect(displayName({
      name: '蓮ノ空女学院スクールアイドルクラブ',
      shortName: null
    })).toBe('蓮ノ空女学院スクールアイドルクラブ')
  })

  it('falls back to name when shortName is undefined', () => {
    expect(displayName({
      name: '蓮ノ空女学院スクールアイドルクラブ',
    })).toBe('蓮ノ空女学院スクールアイドルクラブ')
  })

  it('returns full name in full mode even when shortName exists', () => {
    expect(displayName({
      name: '蓮ノ空女学院スクールアイドルクラブ',
      shortName: '蓮ノ空'
    }, 'full')).toBe('蓮ノ空女学院スクールアイドルクラブ')
  })
})
```

### src/__tests__/unit/translation.test.ts

```typescript
import { describe, it, expect } from 'vitest'
import { shouldShowTranslateButton } from '@/lib/translation'

describe('shouldShowTranslateButton', () => {
  it('returns false for known locale', () => {
    expect(shouldShowTranslateButton('ja', ['ko', 'ja', 'en'])).toBe(false)
  })

  it('returns true for unknown locale', () => {
    expect(shouldShowTranslateButton('zh-CN', ['ko', 'ja'])).toBe(true)
  })

  it('returns false for preferred locale', () => {
    expect(shouldShowTranslateButton('ko', ['ko'])).toBe(false)
  })

  it('returns false when detectedLocale is null', () => {
    expect(shouldShowTranslateButton(null, ['ko'])).toBe(false)
  })

  it('returns false when detectedLocale is undefined', () => {
    expect(shouldShowTranslateButton(undefined, ['ko'])).toBe(false)
  })
})
```

### src/__tests__/unit/csv.test.ts

```typescript
import { describe, it, expect } from 'vitest'
import { parseArtistCSV, validateArtistRow } from '@/lib/csv'

describe('parseArtistCSV', () => {
  it('parses valid artist CSV', () => {
    const csv = `slug,type,parentArtist_slug,ja_name,ja_shortName,ko_name,ko_shortName
hasunosora,group,,蓮ノ空女学院スクールアイドルクラブ,蓮ノ空,하스노소라여학원,하스노소라`

    const rows = parseArtistCSV(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].slug).toBe('hasunosora')
    expect(rows[0].ja_shortName).toBe('蓮ノ空')
  })

  it('handles empty imageUrl column', () => {
    const csv = `slug,type,parentArtist_slug,ja_name,ja_shortName,ko_name,ko_shortName,imageUrl
hasunosora,group,,蓮ノ空,蓮ノ空,하스노소라,하스노소라,`

    const rows = parseArtistCSV(csv)
    expect(rows[0].imageUrl).toBeNull()
  })
})

describe('validateArtistRow', () => {
  it('returns error for invalid type', () => {
    const result = validateArtistRow({ slug: 'test', type: 'invalid' })
    expect(result.errors).toContain('invalid type')
  })

  it('returns error for missing slug', () => {
    const result = validateArtistRow({ type: 'group' })
    expect(result.errors).toContain('slug is required')
  })

  it('passes for valid row', () => {
    const result = validateArtistRow({
      slug: 'hasunosora',
      type: 'group',
      ja_name: '蓮ノ空',
    })
    expect(result.errors).toHaveLength(0)
  })
})
```

### src/__tests__/unit/rollup.test.ts

```typescript
import { describe, it, expect } from 'vitest'
import { computeRollup } from '@/lib/rollup'

// computeRollup takes a setlistItem with its relations loaded
// and returns the 6 rollup arrays

describe('computeRollup', () => {
  it('includes song IDs from setlist item songs', () => {
    const result = computeRollup({
      songs: [{ songId: 'song-1' }, { songId: 'song-2' }],
      event: mockEvent,
    })
    expect(result.rollupSongIds).toContain('song-1')
    expect(result.rollupSongIds).toContain('song-2')
  })

  it('includes leaf event and all ancestor event IDs', () => {
    // Event hierarchy: saitama-day1 → saitama-leg → 6th-bgp-series
    const result = computeRollup({
      songs: [],
      event: {
        id: 'saitama-day1',
        parentEvent: {
          id: 'saitama-leg',
          parentEvent: null,
        },
        eventSeries: { id: '6th-bgp' },
      },
    })
    expect(result.rollupEventIds).toContain('saitama-day1')
    expect(result.rollupEventIds).toContain('saitama-leg')
  })

  it('includes direct artist and all parent artists', () => {
    // Cerise Bouquet → 蓮ノ空
    const result = computeRollup({
      songs: [],
      event: mockEventWithArtists([
        { id: 'cerise-bouquet', parentArtist: { id: 'hasunosora' } }
      ]),
    })
    expect(result.rollupArtistIds).toContain('cerise-bouquet')
    expect(result.rollupArtistIds).toContain('hasunosora')
  })

  it('only includes groups where hasBoard=true in rollupGroupIds', () => {
    const result = computeRollup({
      songs: [],
      event: mockEventWithGroups([
        { id: 'lovelive-group', hasBoard: true },
        { id: 'some-label', hasBoard: false },
      ]),
    })
    expect(result.rollupGroupIds).toContain('lovelive-group')
    expect(result.rollupGroupIds).not.toContain('some-label')
  })
})
```

---

## Integration Tests

### src/__tests__/setup.ts

```typescript
import { prisma } from '@/lib/prisma'
import { afterAll, beforeAll } from 'vitest'

// Use a separate test database
// Set TEST_DATABASE_URL in .env.test

beforeAll(async () => {
  await prisma.$connect()
})

afterAll(async () => {
  await prisma.$disconnect()
})
```

### src/__tests__/integration/import.test.ts

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { importArtistsFromCSV } from '@/lib/csv-import'

const TEST_CSV = `slug,type,parentArtist_slug,ja_name,ja_shortName,ko_name,ko_shortName
hasunosora,group,,蓮ノ空女学院スクールアイドルクラブ,蓮ノ空,하스노소라여학원,하스노소라
cerise-bouquet,unit,hasunosora,Cerise Bouquet,Cerise Bouquet,세리제 부케,세리제`

beforeEach(async () => {
  // Clean test data
  await prisma.artistTranslation.deleteMany()
  await prisma.artist.deleteMany()
})

describe('importArtistsFromCSV', () => {
  it('creates artists from CSV', async () => {
    await importArtistsFromCSV(TEST_CSV)
    const count = await prisma.artist.count()
    expect(count).toBe(2)
  })

  it('is idempotent — running twice does not duplicate', async () => {
    await importArtistsFromCSV(TEST_CSV)
    await importArtistsFromCSV(TEST_CSV)
    const count = await prisma.artist.count()
    expect(count).toBe(2)  // still 2, not 4
  })

  it('creates translations for each locale', async () => {
    await importArtistsFromCSV(TEST_CSV)
    const translations = await prisma.artistTranslation.findMany({
      where: { locale: 'ja' }
    })
    expect(translations).toHaveLength(2)
    expect(translations[0].shortName).toBe('蓮ノ空')
  })

  it('sets parentArtistId correctly for sub-units', async () => {
    await importArtistsFromCSV(TEST_CSV)
    const cerise = await prisma.artist.findFirst({
      include: { parentArtist: true }
    })
    expect(cerise?.parentArtist?.id).toBeDefined()
  })
})
```

### src/__tests__/integration/comment.test.ts

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createCommentWithRollup } from '@/lib/comments'

describe('comment rollup ancestry', () => {
  it('populates all 6 rollup arrays when posted on setlistItem', async () => {
    const comment = await createCommentWithRollup({
      userId: testUserId,
      type: 'comment',
      setlistItemId: testSetlistItemId,
      content: '고베에서 진짜 울었음',
    })

    // rollupSongIds — songs of the setlist item
    expect(comment.rollupSongIds.length).toBeGreaterThan(0)

    // rollupEventIds — leaf event + ancestors
    expect(comment.rollupEventIds).toContain(testEventId)

    // rollupArtistIds — direct + parent artists
    expect(comment.rollupArtistIds).toContain(hasunosoraId)

    // rollupGroupIds — hasBoard=true groups only
    expect(comment.rollupGroupIds).toContain(loveliveGroupId)

    // rollupCategories
    expect(comment.rollupCategories).toContain('anime')
  })

  it('rollup arrays are immutable after creation', async () => {
    const comment = await createCommentWithRollup({
      userId: testUserId,
      type: 'comment',
      setlistItemId: testSetlistItemId,
      content: 'test',
    })

    const originalRollup = [...comment.rollupArtistIds]

    // Even if we update the comment content, rollup should not change
    await prisma.comment.update({
      where: { id: comment.id },
      data: { content: 'updated content' }
    })

    const updated = await prisma.comment.findUnique({
      where: { id: comment.id }
    })

    expect(updated?.rollupArtistIds).toEqual(originalRollup)
  })
})
```

### src/__tests__/integration/fallback.test.ts

```typescript
import { describe, it, expect } from 'vitest'
import { getTranslation } from '@/lib/i18n'

describe('getTranslation locale fallback', () => {
  it('returns ko translation when available', async () => {
    const artist = await prisma.artist.findFirst({
      include: { translations: true }
    })
    const t = getTranslation(artist!.translations, 'ko')
    expect(t?.locale).toBe('ko')
  })

  it('falls back to ja when ko not available', () => {
    const translations = [
      { locale: 'ja', name: '蓮ノ空', shortName: '蓮ノ空' }
    ]
    const t = getTranslation(translations, 'ko')
    expect(t?.locale).toBe('ja')
  })

  it('falls back to first available when neither ko nor ja', () => {
    const translations = [
      { locale: 'en', name: 'Hasunosora', shortName: 'Hasunosora' }
    ]
    const t = getTranslation(translations, 'ko')
    expect(t?.locale).toBe('en')
  })

  it('returns null for empty translations array', () => {
    const t = getTranslation([], 'ko')
    expect(t).toBeNull()
  })
})
```

---

## E2E Tests

### playwright.config.ts

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: process.env.TEST_BASE_URL ?? 'http://localhost:3000',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
})
```

### e2e/setlist.spec.ts

```typescript
import { test, expect } from '@playwright/test'

test.describe('setlist page', () => {
  test('loads event page with setlist', async ({ page }) => {
    await page.goto('/ko/events/1')
    await expect(page.getByRole('heading')).toBeVisible()
    // Setlist items rendered
    await expect(page.locator('[data-testid="setlist-item"]').first()).toBeVisible()
  })

  test('shows upcoming badge for future events', async ({ page }) => {
    await page.goto('/ko/events/1')  // 6th Live 후쿠오카 Day1 (upcoming)
    await expect(page.getByText('예정')).toBeVisible()
  })

  test('song page shows performance history', async ({ page }) => {
    await page.goto('/ko/songs/1')
    await expect(page.getByTestId('performance-history')).toBeVisible()
  })

  test('locale redirect works — US visitor lands on /ko/', async ({ page }) => {
    // Simulate non-Korean browser
    await page.goto('/', { headers: { 'Accept-Language': 'en-US' } })
    await expect(page).toHaveURL(/\/ko\//)
  })
})
```

### e2e/admin.spec.ts

```typescript
import { test, expect } from '@playwright/test'

test.describe('admin setlist entry', () => {
  test.beforeEach(async ({ page }) => {
    // Admin login
    await page.goto('/admin/login')
    await page.fill('[name=password]', process.env.ADMIN_PASSWORD!)
    await page.click('[type=submit]')
  })

  test('can add a setlist item under 30 seconds', async ({ page }) => {
    const start = Date.now()

    await page.goto('/admin/events/1/setlist')
    await page.fill('[name=songSearch]', 'DEEPNESS')
    await page.click('[data-testid="song-option-DEEPNESS"]')
    await page.selectOption('[name=stageType]', 'full_group')
    await page.click('[type=submit]')

    await expect(page.getByText('DEEPNESS')).toBeVisible()

    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(30000)  // under 30 seconds
  })

  test('CSV import page rejects invalid file', async ({ page }) => {
    await page.goto('/admin/import')
    // Upload a bad CSV
    await page.setInputFiles('input[type=file]', {
      name: 'bad.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('invalid,columns\nbad,data')
    })
    await page.click('[data-testid="import-button"]')
    await expect(page.getByTestId('error-message')).toBeVisible()
  })
})
```

---

## Test Database Setup

Use a separate Supabase project or local PostgreSQL for integration tests:

```env
# .env.test
DATABASE_URL="postgresql://postgres:password@localhost:5432/opensetlist_test"
```

```bash
# Create test DB and push schema
DATABASE_URL=<test_url> npx prisma db push
```

Integration tests use `beforeEach` to clean relevant tables.
Never run integration tests against the production database.

---

## Running Tests

```bash
# Unit tests only (fast, no DB needed)
npx vitest run src/__tests__/unit

# All unit + integration tests
npx vitest run

# Watch mode during development
npx vitest

# E2E tests (requires dev server running)
npx playwright test

# E2E with UI
npx playwright test --ui

# Specific test file
npx vitest run src/__tests__/unit/display.test.ts
```

---

## data-testid Convention

Add `data-testid` attributes to key UI elements for E2E test stability:

```tsx
// Use data-testid, not class names or text content
<div data-testid="setlist-item">...</div>
<div data-testid="performance-history">...</div>
<button data-testid="translate-button">번역보기</button>
<div data-testid="comment-section">...</div>
<div data-testid="error-message">...</div>
```

---

## What NOT to Test

```
❌ Prisma model definitions (Prisma tests its own ORM)
❌ Next.js routing (framework responsibility)
❌ Tailwind CSS styling
❌ Third-party API responses (Papago, DeepL) — mock these
❌ 100% code coverage — not the goal
```

---

## Implementation Checklist

```
Sprint 1 (before 2026-05-02):
  [ ] Install Vitest + Playwright
  [ ] vitest.config.ts
  [ ] playwright.config.ts
  [ ] display.test.ts
  [ ] translation.test.ts (shouldShowTranslateButton)
  [ ] csv.test.ts (parsing + validation)
  [ ] import.test.ts (upsert idempotency)
  [ ] setlist.spec.ts (page loads, locale redirect)

Sprint 2 (before 2026-05-30):
  [ ] comment.test.ts (rollup ancestry — most important)
  [ ] fallback.test.ts (locale fallback)
  [ ] admin.spec.ts (setlist entry speed)
  [ ] auth.spec.ts (login flow)

Sprint 3 (before 2026-07-11):
  [ ] rollup.test.ts (unit test for computeRollup)
  [ ] BBS post rollup tests
  [ ] Report auto-hide threshold test
  [ ] DictionaryTerm applyDictionary test
```
