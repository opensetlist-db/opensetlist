# OpenSetlist

Crowdsourced setlist database for East Asian live music — K-POP, J-POP, C-POP, anime, game, and beyond.

동아시아 라이브 음악(K-POP·J-POP·C-POP·애니메이션·게임 등)을 위한 크라우드소싱 셋리스트 데이터베이스.

[opensetlist.com](https://opensetlist.com)

## What it does

- **Per-event setlists** with per-song unit/member credits — the thing setlist.fm doesn't model.
- **Artist hierarchy** for groups, sub-units, and solo acts; stage identities (characters / personas) kept separate from voice actors so VA changes don't rewrite history.
- **Real-time setlist polling** during ongoing events with a pulsing LIVE badge.
- **One-line impressions** ("한줄평") per event with on-demand translation between viewer locales.
- **Dynamic OG cards** with data-derived glassmorphism palettes and self-hosted CJK fonts for Twitter / KakaoTalk / Discord previews.
- **i18n from day one**: Korean (launch), Japanese, English, Simplified Chinese (Phase 3).

## Tech Stack

- **Framework:** Next.js 14 (App Router) + TypeScript (strict)
- **i18n:** next-intl with `/[locale]/` routing
- **ORM & DB:** Prisma 7 + PostgreSQL (Supabase Seoul)
- **Hosting:** Vercel (frontend) + Cloudflare (CDN)
- **Translation:** OpenAI Responses API (prod) / Google Gemini (preview)
- **Observability:** Sentry, GA4

## Contact

help@opensetlist.com

## Release Notes

### v0.8.3 (2026-04-21)
- Event OG card: `EventSeries` short name is now the headline; the specific event name moves to the subtitle (matches page H1 composition).
- OG card overflow: smaller title / subtitle fonts + 2-line clamp (`-webkit-box` + `WebkitLineClamp`) so long KR / JP event names no longer overflow the glass panel.
- New `pickLocaleTranslation` helper (strict locale match, no ko / en fallback) for Song / Album fields that have parent-level `originalTitle` / `variantLabel` — a JP viewer no longer sees a KR `variantLabel` leak through for a JP song with only a ko translation.
- `displayOriginalTitle` rewritten to take the full translations array and do the locale-exact match internally.
- Base-version link on song page renders locale-aware `variantLabel` next to the base title using the same fallback rule.

### v0.8.2 (2026-04-21)
- Phase 1A GA4 custom events wired across the app (setlist_item_click, reaction toggles, etc.) for the 2026-05-02 launch-cohort revisit-rate KPI.
- First-visit cohort cookie identifies launch-day visitors for retention tracking.
- Removed Sentry verification scaffolding (`/api/sentry-example-api`, `/sentry-example-page`, `ENABLE_SENTRY_VERIFICATION_ROUTES` flag) after prod-alert-email confirmation.

### v0.8.1 (2026-04-20)
- Admin impression moderation UI at `/admin/impressions` with 숨김 / 정상 / 삭제 / 전체 filter tabs; default 숨김 tab sorted by `reportCount desc` surfaces auto-hidden chains (reportCount ≥ 3) on top.
- `DeleteImpressionButton` + `RestoreImpressionButton` wire to the existing DELETE / PATCH `/api/admin/impressions/[chainId]` endpoints (replaces prior DevTools-fetch moderation workflow).
- Sidebar nav entry 한줄평 added between 이벤트 and CSV 가져오기.
- Sentry error tracking via `@sentry/nextjs` on Next 16.2.2 with `withSentryConfig(withNextIntl(...))` outer-wrap, prod-only gate, 10% trace sampling, `tunnelRoute: "/monitoring"` to bypass ad-blockers.
- Server `beforeSend` coerces BigInt → string so Prisma results don't crash Sentry's serializer.
- Client uses `NEXT_PUBLIC_VERCEL_ENV` (Next.js does not inline plain `VERCEL_ENV` into the browser bundle).

### v0.8.0 (2026-04-20)
- Per-cell Translate button on impressions — toggles between original and viewer-locale translation, no re-fetch on subsequent toggles.
- `POST /api/impressions/translate` with server-side cache (new `ImpressionTranslation` table keyed on `impressionId + sourceLocale + targetLocale`, naturally per-version against the append-only chain); P2002 race re-SELECTs the winner instead of erroring.
- Provider abstraction (`src/lib/translator`): OpenAI Responses API (gpt-4o-mini) and Google Gemini (gemini-3.1-flash-lite-preview) behind a single `Translator` interface; `TRANSLATION_PROVIDER` selects (Vercel preview = Gemini, prod = OpenAI).
- Hardening: shared JSON-shaped system prompt, max-token truncation detection on both providers, 256-token floor, `AbortSignal.timeout(30s)`, error-payload redaction in logs.
- Schema: new `impression_translations` table with `onDelete: Cascade` FK to `event_impressions`.

### v0.7.1 (2026-04-19)
- **Production hotfix:** `/api/og/*` routes returned 404 on prod after v0.7.0 because neither the self-hosted CJK WOFFs nor the `@vercel/og` runtime assets (`index.node.js`, `resvg.wasm`, `yoga.wasm`, `Geist-Regular.ttf`) were traced into the Vercel function bundle. Fixed by declaring `outputFileTracingIncludes` for `/api/og/**` pointing at Next's compiled `@vercel/og` copy.
- Testing safety net: vitest + jsdom + testing-library scaffold; unit tests pin Phase 1A invariants on impressions, reactions, admin-impressions, and `useSetlistPolling`.
- CI workflow runs lint + typecheck + vitest on every push.
- Semgrep workflow for static analysis.
- `migrate-prod.yml` passes `accept_data_loss` via env (fixes shell-injection finding).

### v0.7.0 (2026-04-19)
- Dynamic OG cards on Event, Song, and Artist pages with data-derived glassmorphism palette (culori OKLCH mesh, 3-branch faithful / harmonized / fallback derivation); self-hosted DM Sans + Noto Sans KR / JP for CJK glyph support on Twitter / KakaoTalk / Discord previews. SHA-256 palette fingerprint in the OG URL doubles as CDN cache-buster.
- `EventImpression` migrated to an append-only, versioned chain model — every edit creates a new row, the head row is the live impression, prior rows carry `supersededAt`. Read APIs filter `supersededAt = null`.
- Realtime impression polling on ongoing events; LIVE badge on the impressions header.
- New `/artists` and `/events` index pages with pagination; home redesigned with ongoing / upcoming / completed sections.
- Admin `EventForm` rewrite with shared validation (`src/app/api/admin/events/_validate.ts`).
- Shared OG helpers extracted: `ogFonts` (module-scope cache + in-flight dedupe), `ogLabels` (locale + status label tables), `ogPalette` (per-entity collectors).
- Cache-Control for the Event OG route now tracks the status pill — max-age capped at seconds-until-next-transition for upcoming / ongoing (no SWR), full hour + SWR for terminal states.
- Error fallback on OG routes serves `no-store` so a transient Prisma / font-load blip can't poison CDN and crawler caches with the generic OPENSETLIST card.

### v0.6.0 (2026-04-19)
- `/[locale]/events` list page grouped by tour; `/[locale]/artists` list page.
- Venue-pinned date + viewer-local time on event cards (`formatToParts`-based).
- Home page narrowed to ±30-day event window (UTC-day-aligned).
- Admin event form parity with CSV import (full event + performer + guest CRUD).
- Mobile viewport meta so `/[locale]` renders at device width; pagination wraps on narrow viewports; stacked date + title in event cards on mobile.
- Admin events API hardening (PR #48 + 5 CR rounds): reject malformed / duplicate translation payloads with 400 instead of 500; validate `eventSeriesId` is digits-only before `BigInt()`; `ensureStageIdentitiesExist` runs inside the same `$transaction` as the FK writes.

### v0.5.3 (2026-04-17)
- Real-time setlist polling: `GET /api/setlist` polled every 5s when event is ongoing; new `useSetlistPolling` hook + `LiveSetlist` client wrapper with pulsing LIVE badge.
- Event one-line impressions ("한줄평"): new `EventImpression` table (UUID id, soft-delete, 3-report auto-hide), public POST / PUT / report routes with 60s edit cooldown, admin soft-delete / restore, ko / ja / en i18n.
- Re-enabled next-intl Accept-Language detection across ko / ja / en.
- Real-time impressions polling on ongoing events.

### v0.5.2 (2026-04-16)
- Privacy / terms refresh: clarified third-party processor language for IP / cookie collection (Vercel, GA4, Cloudflare); removed "anime / game" genre scope from terms; switched contact email to help@opensetlist.com across privacy, terms, footer, README, CLAUDE.md.
- Privacy Section 4 restructured across all 3 locales to align with Section 1's processor framing: operational processors (Vercel / GA / Cloudflare) listed separately from advertising partners (AdSense / AdFit).
- `CONTACT_EMAIL` hoisted into `src/lib/config.ts` as a shared constant.
- Member page & Song page Performance History: series name is now the primary link label with the event title as a parenthetical sub-label, matching the song / event / artist pages. Event link uses canonical `event.slug` so the URL stays locale-independent.

### v0.5.1 (2026-04-16)
- Hero heading replaced across ko / ja / en with the 「みんなでつなぐ、ライブの物語」 variant; subtext line removed.
- Docs: CLAUDE.md hard rule "never merge PRs yourself".

### v0.5.0 (2026-04-16)
- Home page split into ongoing / upcoming / completed sections with per-section pagination, shared `now`, page clamping, boundary alignment with the badge resolver.
- Dropped `Event.parentEventId` self-ref — multi-day shows now use shared `EventSeries` only.
- Flipped `Event.startTime` to NOT NULL; admin `EventForm` appends `Z` to datetime-local values so server parses as UTC.
- Song page promotes series name to primary title.
- Migration: required `accept_data_loss=true` on migrate-prod (drops `parentEventId` column + tightens startTime nullability). Pre-flight on prod: 0 leg containers, 0 null startTimes.

### v0.4.1 (2026-04-16)
- Promote event series name to primary title on event listings, event detail, artist history, and home page. Event name moves to a sub-label when both exist.
- Auto-compute displayed event status from `Event.startTime` with a 12h "ongoing" buffer; admin can still override via DB enum.
- Drop deprecated `upcoming` value from the `EventStatus` enum; DB default is now `scheduled`. Prod data migrated: 9 rows `upcoming → scheduled`.
- Home page computes UTC day-boundary once and shares it across upcoming and recent queries; localize event OG description via `formatDate()`.
- CLAUDE.md: codify UTC-only date handling rule.

### v0.4.0 (2026-04-16)
- New header with OpenSetlist logo, wordmark, and nav (Home / Artists / Events / Tours).
- Mobile hamburger menu with click-outside and route-change auto-close.
- Hero section on home with Josefin Sans heading and visual search bar (Phase 1C wiring).
- Event cards restyled with DM Sans typography.
- Self-hosted Josefin Sans + DM Sans fonts (no Google CDN).

### v0.3.2 (2026-04-16)
- Remove `one_time` from `EventSeriesType` enum.
- Completes three-phase enum migration: v0.3.1 added `standalone`, SQL migrated prod rows, v0.3.2 removed `one_time` from schema.

### v0.3.1 (2026-04-16)
- Emotion tags: reaction buttons (😭🔥😱🩷) on setlist items with localStorage dedup.
- Trending songs section (top 3 most-reacted songs per event).
- `EventSeriesType`: `one_time → standalone` (단독 공연 / 単独公演); legacy `one_time` auto-normalized on CSV import and form edit.
- Import error handling: separate JSON / validation / import errors (no more UI hangs); `ImportValidationError` class for actionable 400 responses.
- Trending songs filtered to song-type items only.
- Request body validation before destructuring.

### v0.3.0 (2026-04-15)
- 3-language UI support (Korean / Japanese / English) with `LanguageSwitcher`.
- Privacy policy and terms of service pages (ko / ja / en).
- Footer component with privacy, terms, contact links.
- Admin setlist builder: reorder (move up / down), insert-after, insert-at-beginning.
- Admin setlist builder: artist names displayed in item rows.
- Input validation on insert-after and swap API routes.

### v0.2.0 (2026-04-14)
- English event translations.
- Google Analytics 4 integration.
- Personal info cleanup from public docs.
- CodeRabbit automated review config.

### v0.1.0 (2026-04-14)
- Initial production release.
- Core read-only pages: Artist, Song, Event, EventSeries.
- Admin UI with CSV import and setlist builder.
- OG cards, SEO, sitemap.
- Hasunosora seed data (224 songs).
