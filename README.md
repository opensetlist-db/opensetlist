# OpenSetlist

Crowdsourced setlist database for East Asian live music — K-POP, J-POP, C-POP, anime, game, and beyond.

동아시아 라이브 음악(K-POP·J-POP·C-POP·애니메이션·게임 등)을 위한 크라우드소싱 세트리스트 데이터베이스.

[opensetlist.com](https://opensetlist.com)

## What it does

- **Per-event setlists** with per-song unit/member credits — the thing setlist.fm doesn't model.
- **Artist hierarchy** for groups, sub-units, and solo acts; stage identities (characters / personas) kept separate from voice actors so VA changes don't rewrite history.
- **Real-time setlist polling** during ongoing events with a pulsing LIVE badge.
- **One-line impressions** ("한줄감상") per event with on-demand translation between viewer locales.
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

### v0.9.10 (2026-05-04)
- **F19 — slug-generator unification + KO transliteration.** Per-entity slug generators (Artist / Song / Event / EventSeries / StageIdentity) were separately implemented; the Day-1 launch hit empty-slug-on-JP-only-title (`ペレニアル` → `""` → unique-constraint collision against existing empty-slug rows), got hotpatched on the Song path only via PR #247. The unification refactor was held out of the launch window for safety and lands now (#248) ahead of the 5/23 Kobe Phase-1C user-registration window — after Phase 1C ships, every slug path will be hit by user-supplied JP/KO/EN titles, so the per-route inconsistency would have become user-visible. Three shared helpers in `src/lib/slug.ts` — `validateCanonicalSlug` (sync round-trip check, returns `null` on non-canonical so callers map to a 400 with no silent rewriting), `deriveSlug` (async pipeline: ASCII strip → `es-hangul.romanize` if Hangul detected → kuroshiro romaji → `""`), `resolveCanonicalSlug` (combined entry point, three-way classification of `rawSlug`: absent → auto-path, non-string → 400 invalid input, non-canonical string → 400, canonical string → pass-through). Replaces per-route `resolveAdminSlug` across every admin POST route plus the slug-generator preview tool. `next.config.ts` extends kuromoji dict tracing from `songs/**` only to `slug-generator`, `artists`, `events`, `event-series`, and `artists/[id]/stage-identities` — the slug-generator preview was silently producing `""` on Vercel for JP names because its lambda bundle had no kuromoji dict files, so an operator typing `ペレニアル` into the preview saw `(변환 실패)` even though saving the song would have worked. **KO transliteration via `es-hangul`** was added on the merge branch (the original task assumed es-hangul was already wired in `slug.ts` but only `josa()` was used elsewhere): `transliterateKoreanToRomanized` is sync (es-hangul is pure-JS, no dict files) so the KO path needs no `next.config.ts` change, and the `/[㄰-㆏가-힣]/` Hangul detection lets pure-KO names skip the kuroshiro init cost. Sample: `테스트아티스트` → `teseuteuatiseuteu`, `페렌` → `peren` — pre-PR these all fell to `${model}-${ts}`. P2002 catch on each route now uses `isSlugUniqueViolation(target)` to distinguish slug from translation-locale-composite or join-table uniques (admin nested creates raise P2002 for many constraints, not just `slug`); songs's existing P2002 retry loop preserved + bails on non-slug P2002 so it doesn't burn its 3 attempts re-rolling slugs against an unrelated constraint. Stage-identity form's sequential POST loop tracks completed indices so a mid-list failure prunes saved items from the retry list — fixes the duplicate-create bug where a randomUUID-suffixed stage-identity got re-saved on every retry. Three admin forms (Artist / Event / EventSeries) gain the same `try/catch/finally` + `body.error`-surfacing pattern SongForm got in #247. Day-1 Song-path hotpatch absorbed into the unified helper.
- **F15-RC — OG image cold-start hardening.** The Day-1 launch tweet (and Day-2's separate-URL tweet) failed to render their OG cards on Twitter; T-2h smoke tests via Twitterbot UA passed both days but reproduced on the actual tweets anyway (#259). Two days of separate-URL reproductions ruled out the Twitter-side-transient hypothesis (A2′) and confirmed cold-start lambda crash (A2): `loadOgFonts()` was throwing on Vercel's lambda cold start when one of the eight Noto Sans subset WOFFs hit transient I/O failure, taking the whole `/api/og/*` route 5xx with it — Twitter then negative-caches the scrape failure for ~7 days, so a single cold-start I/O blip translates to a week of broken share previews on the affected URL. Fix replaces the bare-`readFile` chain with per-file `AbortController` + 5s timeout: ENOENT / EACCES / AbortError all resolve to `null` instead of throwing, partial loads emit `Sentry.captureMessage("og.fonts.partial_load", { extra: { loaded, expected, missing } })` for production observability, and the loaded subset is cached. With zero fonts loaded `@vercel/og` falls back to the `Geist-Regular.ttf` Next bundles inside its compiled `@vercel/og` copy — bare OPENSETLIST card still produces a valid 200/PNG, blocking Twitter's negative-cache trap at the source. Path A (per-`readFile` timeout + partial tolerance) chosen over Path B (module-init hoist) because Path B doesn't actually fix the failure mode (if init fails, the lambda still 5xxes; Vercel doesn't auto-retry init). CR-driven follow-ups: kept plain `setTimeout` (not `AbortSignal.timeout()`) for Vitest fake-timer compatibility; switched from `Promise.race` to `AbortController` so the I/O is actually cancelled instead of letting Node keep buffering after timeout; clarified inline that the fallback font is `Geist-Regular.ttf` from Next's compiled `@vercel/og` copy (not the standalone npm package's Noto Sans). Live A2 confirmation will come from `og.fonts.partial_load` Sentry messages firing on cold starts post-deploy. F15-CI (preview-deploy smoke job + nft-trace assertion) is now unblocked as a follow-up.
- **F20 — Event Detail page TTFB cut from ~4.0s to ~0.83s warm (−79%).** Day-2 launch surfaced operator-quote-worthy slowness on the event detail page ("'잘못됐나' 의문이 들 정도"). Combined fix across five PRs: **#260** wraps `getEvent` in `react.cache()` so the duplicate call across `generateMetadata` + page-component collapses to one DB roundtrip per request, and filters every nested `translations` block in the include to `{ locale: { in: [locale, "ja"] } }` — most rows previously fetched were translation rows that got filtered to a single locale at render time. Display helpers cascade through the parent's `originalName`/`originalShortName` columns when no translation matches, so the filtered shape never renders blank; the `"ja"` half backs `displayOriginalName`'s sub-line cascade for the canonical-original safety net. `~4.0s → ~2.7s` (−33%). **#261** parallelizes `getEvent` with the i18n + per-event helper batch (both only need `eventId` from the URL, no dependency forcing serial execution) and collapses `getTrendingSongs.q2`'s 4-statement Prisma fan-out into one statement via `$queryRaw` with a LATERAL JOIN. Trending stays serial-and-conditional because the skip-when-ongoing semantics need `event.status` from `getEvent` first; always-launching trending in the batch would reintroduce ~940ms of pure DB waste during live shows. `~2.7s → ~2.28s` (−17% additional). **#262** enables Prisma's `relationJoins` preview feature (`previewFeatures = ["relationJoins"]` in `prisma/schema.prisma`'s generator config — Prisma 7.7, preview since 5.7 ~Dec 2024). Switches the default relation-load strategy from per-relation SELECTs (DataLoader-style fan-out) to a single LATERAL JOIN with JSONB aggregation. Per-request SQL statement count drops 35 → 9; the 9 remaining are unavoidable `Promise.all` branches (`getEvent`, `reactionCounts`, `impressions` main+count, trending q1/q2/q3, helper joins). `~2.28s → ~0.83s` (−64% additional, −79% cumulative). Local Postgres planner verified — no query-plan regressions on the LATERAL JOIN + `JSONB_AGG` shape. **#263** drops the `$queryRaw` block from #261 — `relationJoins` makes the same flattening automatic, so the original `prisma.setlistItem.findMany` shape is now equivalent on the wire (~70 fewer lines, Prisma-generated types instead of hand-rolled column-name types). **#264** adds a non-blocking GitHub Actions job (`.github/workflows/event-detail-perf.yml`) that polls the Vercel preview for the PR's head SHA, measures warm TTFB across 6 (locale × event) combos × 2 passes vs the latest successful base-branch deployment, and posts a delta as a PR comment + commit status `perf/event-detail-ttfb`. Deliberately non-blocking (status check not in branch-protection's required list): wall-clock TTFB is too flaky to gate merges on, but the comment surfaces drift so reviewers can decide intentional vs regression. F16 (N+1 query on setlist endpoint) and F21 (connection-acquisition timeouts at audience ramp) likely auto-resolve as side effects of the include-shape rework — verify post-tag via 24h Sentry watch.

### v0.9.9 (2026-05-02)
- **F14 Day-2 mitigation — Supabase pooler EMAXCONN at peak polling × audience.** Day-1 launch (2026-05-02 KST) hit `DriverAdapterError: max client connections reached, limit: 200` twice within the first 11 minutes (T+5, T+11) at the audience-arrival ramp (#253). 5-second polling × concurrent viewers × per-request connection acquisition saturated the Supabase free-tier 200-client PgBouncer ceiling. Two complementary code-only levers: **(A) asymmetric polling cadence** — `useImpressionPolling` default cadence 5 s → 30 s; setlist + reactions intentionally stay at 5 s (reactions ride on `/api/setlist`'s response, so setlist cadence governs reaction freshness — the live-show experience must not regress). Impressions are conversational; ≤ 33 s cross-user freshness is fine, and the submitter's own UX is unaffected because `EventImpressions.handleSubmit` merges the POST response synchronously. Translation is on-demand via 🌐 click, not polled. Per-viewer poll rate 0.40 → 0.233 polls/sec. **(B) `PrismaPg max: 3`** — without `max` set, pg defaults to 10 connections per pool, which combined with the 200-client ceiling means EMAXCONN at just 20 concurrent warm Vercel lambdas (matches the Day-1 ramp). Pinning `max: 3` aligns the per-lambda budget to the actual peak concurrent DB-touching query count on user-facing pages (event detail's render-time `Promise.all` peaks at 3: 1 `getReactionCounts` + 2 internal to `getEventImpressions`'s findMany/count fan-out). Other user pages peak at ≤ 2; admin dashboard fans to 8 but is operator-only. Zero latency penalty on user pages; raises ceiling to ~66 concurrent warm lambdas. Combined headroom A + B: ~113 concurrent viewers before saturation (~5–6× Day 1). Also set `idleTimeoutMillis: 20_000` and `connectionTimeoutMillis: 10_000`. Verifications already done (no code change): `DATABASE_URL` confirmed on transaction pooler (port 6543), Prisma singleton in `src/lib/prisma.ts` matches the canonical Vercel pattern. Out-of-scope escalation levers if Day-2 still saturates: drop `max: 1` (serializes parallel queries, +30 ms penalty, ceiling 200 lambdas), push impression cadence to 60 s, Supabase Pro upgrade. Phase 1C Realtime cutover (5/23 Kobe target unchanged) is the structural fix this patches around.
- **F13 Day-2 mitigation — translator returns `[]` on short Korean inputs without glossary matches.** Reproducible in `/admin/translation-debug` for inputs like `시작한다`: OpenAI raw response was the literal `[]` (empty array), `parseMultilingualResponse` correctly rejected "no object entry", route returned 502, fan saw the `translateFailed` toast (#254). Root cause: the Hasunosora system prompt is structurally a glossary — Section [1] (고유명사 사전) consumes ~95 % of the 1073-token prompt; only the opener and format-rule line carry the translation framing. `gpt-4o-mini` reads the prompt as "extract glossary entries from input" on inputs with zero glossary matches → finds none → returns `[]`. Length correlation is statistical (short inputs are likelier to lack glossary entries), not a real threshold. Editing the system prompt would break the > 1024-token implicit-cache invariant ([[v0.8.11 release notes]]), so the fix lives on the **user turn**: explicit `task: translate ... into ko, ja, and en` framing plus an "always return one JSON object inside an array" clause that forecloses the empty-array failure mode. Also adds a redacted Sentry breadcrumb at the route's translator-failure catch (provider / locale / error name / text length / `targetLocale` — never content) so future regressions surface with metadata for triage. Defensive optional-chain on `impression?.content?.length` future-proofs the breadcrumb against catch-widening. The originally-recommended min-length guard would have masked this without identifying the framing flip.
- **F13 follow-up — pair the Sentry breadcrumb with `Sentry.captureMessage`.** CR caught that a breadcrumb alone is dead weight — it only attaches to events captured later in the same scope, and the translator-failure catch returns 502 immediately, so the failure was being recorded in `console.error` but never reaching Sentry, defeating the visibility goal that motivated the breadcrumb in the first place (#257). Pair the existing breadcrumb with `Sentry.captureMessage("translator.translate_failed", { level: "error", tags, extra })`. Deliberately **not** `captureException(err)` — that would re-leak `err.message` / `err.cause` / `err.stack`, which provider SDK errors are known to populate with the user's impression text. Same metadata-only redaction discipline as the breadcrumb (`provider` / `sourceLocale` / `targetLocale` / `errorName` as searchable tags; `textLength` as extra) — no content fields anywhere. Shipped to main via PR #257 ahead of the v0.9.9 tag; back-ported into the v0.9.9 release annotation so the two stay aligned.

### v0.9.8 (2026-05-02)
- **Admin song create — production hotfix for Japanese-titled songs.** `POST /api/admin/songs` was 500ing with `PrismaClientKnownRequestError P2002 (slug)` when the operator tried to add a Japanese-titled song (#247). Two root causes that compounded: `generateSlug("ハナムスビ")` strips all non-ASCII to `""`, so the first Japanese song to claim the empty slug won the `Song.slug @unique` constraint and every subsequent one collided; song variants legitimately share `originalTitle` (`"Dream Believers"` + `"Dream Believers (SAKURA Ver.)"` both produce `dream-believers`) and would have collided on the ASCII path too. Migrate the route to `generateUniqueSlug` (kuroshiro transliteration → `"hanamusubi"`, `-2`/`-3` suffix on existence check, `song-${Date.now()}` fallback if both inputs are empty) — the same pattern artists / events / event-series already used. Admin-supplied slug is accepted verbatim, validated via a `generateSlug` round-trip (input must already be canonical lowercase-alphanumeric-with-hyphens), 400 with a Korean format hint on non-canonical input — no silent normalization. P2002 from concurrent auto-gen requests retries with a fresh slug up to 3 times before returning 409 (the existence-check-then-insert window is racy; a loser used to get 409 instead of `hanamusubi-2`). Admin-supplied slug collision still returns 409 immediately since the operator's intent was specific. `SongForm` rewritten with `try/catch/finally` so `setLoading(false)` always fires (incl. fetch reject — the prior code locked the submit button until refresh on a network blip), and the alert now reads `body.error` from the response so the operator sees the actual reason ("슬러그 'hanamusubi'가 이미 사용 중입니다", or "URL-safe 형식이어야 합니다") instead of bouncing every failure through a generic `저장에 실패했습니다.`.
- **Vercel kuromoji dict tracing.** First Japanese-titled song attempt on Vercel dev produced slug `song-1777697087979` instead of the expected `pereniaru` (#250). Kuroshiro init was throwing at runtime because `node_modules/kuromoji/dict/*.dat.gz` (the IPADIC binaries) weren't being traced into the deployed function bundle — `serverExternalPackages: ["kuromoji"]` in `next.config.ts` keeps the JS module out of the Next bundle but doesn't carry the data files alongside, and the analyzer loads them via a runtime path the file tracer can't see. Same shape of issue the `@vercel/og` font tracing fix in v0.7.1 documented. Add `./node_modules/kuromoji/dict/*.dat.gz` to `outputFileTracingIncludes` for `/api/admin/songs/**` (~17 MB compressed, scoped to the only route that uses `generateUniqueSlug` today). Replace the bare `catch {}` in `transliterateToRomaji` with `Sentry.captureException` (lazy-imported so the module stays safe in tests/scripts) — the silent catch is exactly what hid this bug until a real song hit it; future regressions will surface in Sentry tagged `source: transliterateToRomaji` with the failing input.
- **Admin sidebar — link to 슬러그 생성기.** `/admin/slug-generator` already existed but had no nav entry; operators had to type the URL by hand (#249). Drop a link next to the other utility entries (CSV 가져오기, 번역 디버그). Verbatim label match to the page heading.

### v0.9.7 (2026-05-01)
- Replace `src/app/favicon.ico` — the white-triangle-in-black-circle Vercel scaffold default committed at project init (`1b6e3e3`) — with a brand-rendered ICO sourced from `src/app/icon.svg` (#244). New `scripts/generate-favicon.mjs` rasterizes the SVG once at 256 px via `sharp`, downsamples for the smaller layers, and writes the ICO container by hand with **PNG-encoded layers** at 16 / 32 / 48 / 256 — the format every modern browser (incl. iOS Safari since ~2007) decodes natively. The 256 layer is what iOS Chrome on a Retina iPhone picks for the address-bar indicator (effective render is 32–48 logical px = 64–96 device px); without it the browser falls back to the "gray globe" no-favicon placeholder. Why a manual encoder: an earlier iteration with `to-ico` produced an all-BMP file that iOS WebKit silently rejected — the scaffold default worked specifically because it shipped a 256 PNG layer alongside its BMP layers. `sharp` added as a devDep (~30 MB on disk, runtime bundle untouched). Run via `npm run generate-favicon` after editing `icon.svg`. Caveat: Vercel preview deployments are SSO-gated, so `/favicon.ico` returns auth-challenge HTML to iOS Chrome's tab fetch (which doesn't carry the cookie) — favicon work can only be reliably tested on dev preview with protection disabled or post-merge on prod.
- Impression report confirm modal + 🚨 / 🌐 emojis on the report and translate actions (#243). Tapping 🚨 used to delete-report immediately with no confirmation; a slip would auto-hide a comment after three reports without recourse. New modal explains the report consequence and offers Cancel/Report. Full a11y polish in CR-driven follow-ups: dialog ARIA refs (`role="dialog"`, `aria-modal`, labelled-by/described-by), Escape-to-close, Tab-focus trap inside the modal, initial focus on Cancel (the safer default), and focus restored to the trigger button on close. Mobile and keyboard-only flows behave the same.

### v0.9.6 (2026-05-01)
- Live event page sidebar now ticks from the same poll cycle as the setlist itself (#237). The three sidebar cards (`EventHeader` counts, `UnitsCard`, `PerformersCard`) used to render once at SSR and stay frozen for the rest of the session — adding a song mid-show didn't bump the songs-count pill, didn't surface the new performer's pill, didn't show the new unit row. Lift `useSetlistPolling` from `<LiveSetlist>` into a new `<LiveEventLayout>` wrapper that sits above both columns; re-derive the four sidebar values from each poll tick. The ~230 lines of guest-set + unit/performer walks moved into pure helpers in `src/lib/sidebarDerivations.ts` so the same code runs server-side at SSR and client-side on every poll. Setlist UI types lifted to `src/lib/types/setlist.ts` to keep `lib/` from importing across into `components/`. CR-flagged hydration-mismatch risk fixed by gating the client recompute on `lastUpdated !== null` — first paint reuses the SSR-pre-formatted compact-number string until the first poll lands. `/api/setlist`'s include shape now carries `stageIdentity.artistLinks` so a poll-introduced performer can render under their unit (mid-event guest changes remain unsupported).
- Event OG card: drop city + venue from the subtitle (the event name typically already encodes the venue, e.g. `Day 2 · Marine Messe Fukuoka` — no room to say it twice on a 1200×630), and add an optional `?s=<status>` pin via `&s=${getEventStatus(event)}` in the page metadata's og:image URL (#238). When the OG route receives a valid pin, it overrides the clock-derived status and serves with a long cache (1 h + 24 h SWR); when missing or unrecognized, behavior is byte-for-byte unchanged. Why: social platforms cache OG unfurls aggressively (X/Slack ≈ 7 d, Discord ≈ 1 d, Facebook indefinite) — independently of our `Cache-Control` — so a link shared at T-2 h would otherwise freeze its "upcoming" pill in chat long after the event went live. Pinning the status into the URL means freshly-shared links are self-describing forever; pre-existing shares (no `&s=`) keep clock-derived behavior. `RESOLVED_EVENT_STATUSES` tuple promoted to `src/lib/eventStatus.ts` so the `?s=` validator and the `ResolvedEventStatus` type derive from a single source.
- Trending Top-3 card on the event detail page: switch the title cascade from translation-only to original-primary (#235). Every other song listing on the surface (main setlist row, song detail header, member/series history) uses `displayOriginalTitle` to put the original-language title primary with the localized translation as a muted sub-line; the trending card was the lone outlier rendering only the localized title. `TrendingSong` payload now carries `mainTitle` / `subTitle` / `variantLabel`; `<TrendingSongs>` renders the same shape as `<SetlistRow>`'s `SongTitleBlock` — original primary, localized title in muted text alongside, variant in parens — on one truncating line. Both the SSR helper (`getTrendingSongs`) and the client derivation (`deriveTrendingSongs`) updated.
- Impressions: cursor-paginated "see older" with a polling hot-path optimization (#239). The list previously fetched the latest 50 in one shot with no way to page further; older comments were unreachable. New `before=<cursor>` query param + a "see older" CTA on the impressions card; cursor-encoding helper extracted to `src/lib/impressionCursor.ts`. Page-size constant lifted out so SSR seed + client load-older + tests share one number. `/api/impressions` now returns `{ items, total? }` with `total` only computed when `?includeTotal=1` — the polling tick (every 5 s during ongoing events) skips the `count()` round-trip entirely; `useImpressionPolling` only requests the total on the initial fetch. Cuts the per-tick query time on busy events and keeps the count fresh enough for the visible "총 N" badge.
- Soft-deleted-item exclusion in home/events-list song count (#234). The badge that previously read "12 songs" on the home upcoming card and the `/events` list was double-counting: it didn't filter `isDeleted=false` on the setlist-items rollup, so retracted rows kept inflating the number, and it counted non-song row types (MC / video / interval). Fix scopes the count to `type === "song"` items with `songs.some({})`; constraints centralized as a `SONG_COUNT_WHERE` Prisma filter in `src/lib/setlistCounts.ts` and reused by both surfaces.
- Admin SetlistBuilder: new SetlistItem performers default to the event's full performer roster (#236) so the operator doesn't have to re-tick every member on every row. The previous empty-default required ~7 clicks per setlist item on a 9-member roster.

### v0.9.5 (2026-04-30)
- Home upcoming card now refines D-0 into a live "X hours left" / "X mins left" badge once the next event is < 24 h away. Server bucketing runs on UTC day boundaries, so D-0 covered anything from a few minutes to ~23 h 59 m — too coarse at this range. `UpcomingCard` overrides D-N client-side and ticks every 30 s; initial state stays `null` so SSR + first hydration still emit the server-rendered label (no flash, no hydration mismatch). Plural-aware copy added for ko / ja / en (`#시간 남음` / `あと#時間` / `# hours left`, with min variants).
- Sentry: filter Next.js control-flow throws in `onRequestError`. Sentry's `captureRequestError` was forwarding every digest from `notFound()` and `redirect()` as an unhandled exception, so each bot/crawler probe (`apple-touch-icon`, `.well-known/*`, random `.php` scrapers) opened a Sentry alert. Inline digest check for `NEXT_NOT_FOUND`, `NEXT_HTTP_ERROR_FALLBACK;404`, and `NEXT_REDIRECT;*` short-circuits before SDK capture; genuine exceptions still flow through. 404-rate monitoring belongs in Vercel analytics, not the exception tracker.

### v0.9.4 (2026-04-30)
- Admin sidebar stacks above main on mobile so data-entry forms get the full viewport width. The `flex` body + `w-52` (208 px) fixed-width sidebar consumed 55–65 % of a 320–375 px screen, leaving the form column ~110–170 px — too narrow for artist edit, song edit, the CSV import textarea, or the event setlist builder. Pure className swap on `src/app/admin/layout.tsx`: `flex-col lg:flex-row` body, `w-full` sidebar that collapses to an `overflow-x-auto` horizontal nav strip on mobile, `border-b` instead of `border-r`. Desktop layout (lg+ ≥ 1024 px) is byte-for-byte unchanged. Operator-only surface per CLAUDE.md's admin-scope exemption — no drawer, no client component, no redesign.
- Misc: `apple-touch-icon.png` + `apple-touch-icon-precomposed.png` (180×180, rendered from `src/app/icon.svg`) added to `public/` to silence Sentry 404 alerts triggered by iOS Safari / crawler probes. Shipped to main via hotfix #226 ahead of the v0.9.4 tag; back-ported to dev via #228 so the two branches stay aligned.

### v0.9.3 (2026-04-30)
- Member-page data-correctness fix: `getMember`'s `performances` and `eventPerformers` includes had no soft-delete `where` filter, so junction rows (`SetlistItemMember`, `SetlistItemSong`, `EventPerformer`) attached to soft-deleted parents still leaked into the songs / history aggregations. Symptom in prod: a variant song that had never been performed live surfaced on a member's 자주 부른 곡 list with `timesPerformed: 1` because the only `SetlistItemSong` row referencing it sat under a retracted (soft-deleted) `SetlistItem`. Three-tier filter added on `performances` (`setlistItem.isDeleted=false` + `event.isDeleted=false` + `songs.song.isDeleted=false`) plus matching `event.isDeleted=false` on `eventPerformers`. Other detail pages (artist / song / series) already filtered correctly — leak was isolated to `getMember`.

### v0.9.2 (2026-04-30)
- Mobile horizontal-overflow fix on the four detail pages (artist / member / song / series). Their sidebar+main wrapper was `grid lg:grid-cols-[280px_1fr]`, which on mobile fell back to implicit `grid-auto-columns: auto` and grew the track to fit the widest nowrap descendant's `min-content`. Long song titles, series subtitles, or event names therefore stretched the cards wider than the viewport while `<main>`'s `bgPage` only painted to the viewport edge — visible as a colored gutter beside every card and horizontal page scroll. Adding `grid-cols-1` clamps the mobile track to `minmax(0, 1fr)` so cards fit the viewport and the existing ellipsis truncation engages as designed. Event detail page already used `lg:grid` (block on mobile) and was unaffected.

### v0.9.1 (2026-04-29)
- Avatar-initial overhaul: member-page hero character avatar + artist list rows + member chips on the artist detail page now source the round/square glyph from the curated short name (canonical-script for the member hero, locale-primary for artist surfaces) instead of the full name's first character. VA avatar deliberately retained on the full-name first character (operator preference). New `resolveOriginalShortLabel` helper extracted to `src/lib/display.ts` with focused tests pinning the fallback order.
- Vibrant fallback palette for color-pending unit-type artists — Tailwind 400-500 family replaces the muted Material 700 set; preserves length + hash + per-slug determinism, no semantic-color collisions. New `Artist.color` column wired into the artists CSV admin import (preserve-on-missing semantics — column omitted from header keeps existing color, empty cell clears it).
- Reaction column re-tuned: 4 buttons no longer wrap on Windows / Segoe UI Emoji (260 → 280px reactions column on the desktop setlist grid). Polling race fix so a poll mid-mutation no longer overwrites the optimistic count — `pendingPollCounts` stash drains when `loading` returns to null.
- UI polish across home, history, songs, series, member, and song surfaces: home always renders upcoming + recent boxes (no full-empty state); history badge centered + trailing column shrunk + status column widened for badge breathing room; song-count cells consistent on member + series (single-line, digit-aligned); series-songs rows clickable to song detail; song-page `?tab=variations` clamps to history when no variations; desktop event-row date format includes year.
- i18n: 한줄평 → 한줄감상 (less old-fashioned register; postpositions preserved by ㅇ받침-final endings). Home upcoming wording fixed (앞으로, not 최근). En "show" → "event" for clarity.
- Schema + code hygiene: `SetlistItem.note` hidden from the public event view (Japanese-only data, both SSR and `/api/setlist` polling); `displayName*` helpers unified with full-by-default; admin import wraps `ArtistGroup` replace in `prisma.$transaction` so a partial-failure batch can no longer orphan multiple artists from their groups.

### v0.9.0 (2026-04-29)
- Top-to-bottom UI redesign across home, events list, event detail, artist list/detail, song detail, member detail, series detail, and legal pages — all rebuilt on a new shared-component system (`<InfoCard>`, `<TabBar>`, `<SectionLabel>`, `<StatusBadge>`, `<Breadcrumb>`, `<PerformanceGroup>`, `<LegCard>`, `<ColorStripe>`, etc.). 53 PRs since v0.8.17.
- Phase 1A ad-hoc unit + guest handling: operator-typed `SetlistItem.unitName` hidden from public surfaces (no per-locale translations); generic `<FallbackUnitBadge>` "유닛" / "ユニット" / "Unit" for unit-stage rows without backed Artist credit; guest performers + guest units carry "· 게스트" / "· ゲスト" / "· Guest" suffix; Pass-2 unit→members building skips guests so stale `artistLinks` from returning graduates don't pollute host-unit member sublists.
- Cross-page consistency: `LIVE` badge unified across all surfaces, shared `HISTORY_ROW_DATE_FORMAT` between event list and every detail-page history tab, `<SectionLabel>` adopted on previously-inline section headers, stats grid sub-labels uppercased + letter-spaced for English.
- Translation-primary identity names: `displayOriginalName` flipped — viewer's locale name is the headline (`main`), original-language name reads as the secondary `sub` line. Song / album titles kept original-primary (artwork identity).
- Schema: `Group.slug` (`@unique`, CSV upsert key), `Artist.color`, `Artist.category`, `Artist.isMainUnit`. `GroupCategory` enum reshape: `anime` + `game` merged into `animegame`, added `others` as catch-all. Two-stage prod migration (Prisma's AlterEnum + AddColumn ordering required a transient superset enum push first; details in the v0.9.0 deploy log).
- i18n: 세트리스트 spelling standardized across all surfaces, new `Common.home` noun for breadcrumb hierarchy crumbs (was the `backToHome` CTA), new `Event.guestLabel` key, `tourOngoingLabel` spacing fixed.

### v0.8.17 (2026-04-26)
- Reaction counts + trending TOP3 propagate via the existing 5s polling (F12 launch-blocker from rehearsal #2). `<ReactionButtons>` re-syncs when polling delivers a fresh map reference (prev-prop tracking idiom). Trending TOP3 rendered inside `<LiveSetlist>` and derived from the same `reactionCounts` driving per-item counts (single source of truth).
- `REACTION_TYPES` + `EMOJI_MAP` consolidated to `src/lib/reactions.ts` (previously duplicated across three files).
- SSR `getTrendingSongs()` (3 Prisma queries) skipped when `isOngoing` — `<LiveSetlist>` derives client-side on first paint anyway.

### v0.8.16 (2026-04-26)
- `SetlistItem.note` hidden from the public event view. Notes had Japanese-only data that read poorly for ko / en / zh visitors. Both SSR rendering and `/api/setlist` polling use Prisma `omit: { note: true }`. Admin SetlistBuilder unchanged — 메모 input still editable; saved data preserved.
- Per-locale `Meta.description` + `Home.description` rewritten from anime / game-specific to multilingual "open setlist database for live events (JP/EN/KR)" positioning, with natural translations in en / ko / ja.
- `<link rel="alternate" hreflang="…">` for ko / ja / en plus `x-default` → `/en` on the homepage. Languages derived from `routing.locales` (single source of truth); URLs built via `new URL()` for trailing-slash safety. Scoped to the homepage only — a layout-level canonical would tell Google to deprioritize translated content on every child page.

### v0.8.15 (2026-04-25)
- Soft-deleted `SetlistItem` rows no longer permanently hold their `(eventId, position)` slot — partial unique `WHERE isDeleted = false` in `post-deploy.sql`. Position auto-suggests `max + 1` for new items.
- `<EventStatusTicker>` auto-refreshes at status boundaries via a single `setTimeout(() => router.refresh())` at the next transition (`upcoming` → `ongoing` at `startTime`; `ongoing` → `completed` at `startTime + 12h`). Mounted on the event detail header and per-card in `<EventRow>`.
- Impression polling endpoints flipped to `private, no-store` + client hooks fetch with `cache: "no-store"`. Drops the SSR-seed remount clobber that was discarding fresh polled data on hydration.

### v0.8.14 (2026-04-25)
- JP OG cards no longer tofu out symbols like `～ ／ ★ ☆ ♡ ♥ ♪ ♫ ♬ ❀ ✿`. Eight numbered Noto Sans JP subset WOFFs registered as fallbacks in `OG_FONT_STACK` (~120 KB additional traced into the `/api/og/*` function bundle).
- `titleFontSize()` with CJK-weighted scoring shrinks long JP / KR titles (60/72 → as low as 30/32 px) before they hit the 2-line clamp, instead of mid-word clipping. Tier table + 31 boundary tests at scores 20 / 35 / 55 / 80 / 110 for both base=60 (event) and base=72 (artist / song). Wave-dash `〜` extended into the wide-char regex.

### v0.8.13 (2026-04-23)
- Admin dashboard `/admin` gains a 한줄평 card between 세트리스트 항목 and 감정 태그. Counts head non-deleted impressions; hidden rows (auto-hidden by `reportCount ≥ 3`) stay in the total so the dashboard reflects moderation backlog. Links to `/admin/impressions`.
- Vercel Speed Insights mounted in `[locale]/layout.tsx`. Real-user LCP / INP / CLS / TTFB alongside existing Sentry + GA4. SDK auto-detects `VERCEL_ENV` and no-ops locally. Admin area intentionally skipped to keep the RUM dataset focused on end-user experience.

### v0.8.12 (2026-04-23)
- Mobile fix: long series names now wrap instead of overflowing the viewport. `<EventGroup>` h3 and `<EventRow>` title / subtitle switched from `truncate` to `break-words`. Long Hasunosora series names ("러브라이브! 하스노소라 여학원 스쿨 아이돌 클럽 6th Live Dream Bloom Garden Party Stage") were spilling past the right edge at ~360 px on the home card variant + standalone `/ko/events` heading. Wrapping preserves full info across 2-3 lines.
- Language switcher uses "English" instead of the short code "EN", matching the native-name style of the other two options (한국어, 日本語).

### v0.8.11 (2026-04-23)
- Translation implicit-cache rewrite. The per-event glossary + placeholder substitution pipeline replaced with a 1074-token hardcoded Hasunosora system prompt that embeds the ko / ja / en glossary inline. One LLM call now returns all three locales — both non-source target rows cache per round-trip, cutting ja + en fanout from two calls to one. The stable prompt prefix sits over the 1024-token implicit-cache threshold on both Gemini 2.5+ and OpenAI.
- `Translator.translate(text, sourceLocale, signal?)` returns `{ ko, ja, en }` instead of a single target.
- Read-only admin monitoring page for emotion tags at `/admin/reactions`. Prisma select objects renamed to `eventSelect` / `setlistItemSelect` for clarity.

### v0.8.10 (2026-04-22)
- React `set-state-in-effect` cleanup: 8 violations across 5 files cleared. `<Header>` drops the pathname-change `useEffect` (mobile `<Link>`s close menu via `onClick`). `<EventDateTime>` + new `src/hooks/useMounted.ts` replace the `useState` / `useEffect` mount gate with `useSyncExternalStore`. `useSetlistPolling` + `useImpressionPolling` use the `useState`-pair prev-prop tracking idiom to re-sync only on actual ID change rather than every fresh array reference (the load-bearing thrash bug).
- CI gains a Lint step so future regressions can't land silently.

### v0.8.9 (2026-04-22)
- Server-side dedup for reactions + impressions via `opensetlist_anon_id` cookie. Schema: `anonId String? @db.VarChar(64)` on `SetlistItemReaction` and `EventImpression`. Two partial unique indexes in `post-deploy.sql`: `(setlistItemId, reactionType, anonId) WHERE anonId IS NOT NULL` for reactions; `(rootImpressionId, anonId) WHERE anonId IS NOT NULL AND supersededAt IS NULL` (head-only) for impressions, so the supersede transaction can re-insert the same `anonId` on a new head row without P2002.
- Closes the reactions-idempotency bug (`POST /api/reactions` creating a new row on every double-click → inflated counts → skewed Phase 1A trending signal). Closes impression chain hijacking (any caller could mutate any chain by ID). Pre-builds the merge anchor for Phase 2 account signup — future signup handler claims anon-keyed rows and rewrites them to `userId` ownership.

### v0.8.8 (2026-04-22)
- Phase 1A translation glossary: auto-derived proper-noun pipeline for impression translation. New `src/lib/glossary.ts` — types + `buildArtistTerms` + cached `getArtistTerms` (1h module-scope TTL) + `assemblePairs` + `getGlossaryForEvent` (multi-artist union including guests) + `applyGlossary` / `restoreGlossary` placeholder helpers. Translate route wires glossary application around the LLM call. Fail-open: glossary fetch errors translate raw content rather than 502.
- Admin debug page `/admin/translation-debug` for inspecting the glossary pipeline. Shows all 4 stages — pairs, substituted input, raw LLM output, restored final. Bypasses both the artist-terms cache and the `ImpressionTranslation` cache.

### v0.8.7 (2026-04-21)
- CSV import override columns for parent-level `original*` fields (`originalName`, `originalShortName`, `originalCity`, `originalVenue`, `originalBio`, `originalDescription`, `originalStageName`, `originalLanguage`). New `buildOriginals` helper centralizes the precedence rule: explicit override > `<originalLanguage>_<field>` translation > preserve existing.
- `RealPersonTranslation.shortName` + `RealPerson.originalShortName` schema additions (prerequisite for the Phase 1A translation glossary). Plumbed through `post-deploy.sql` backfill, CSV import (`va_*_shortName` / `va_originalShortName`), admin form VA block.
- Admin import UI lists parent-level `original*` override columns with Korean precedence-rule notes.

### v0.8.6 (2026-04-21)
- `originalName` flipped from nullable to NOT NULL on `Artist`, `Group`, `EventSeries`, `Event`, `StageIdentity`, `RealPerson`. Locks in the parent-level identity field that v0.8.4 added and v0.8.5 wired admin forms to write — every translation-backed parent now has a guaranteed identity string for the bleed-safe display fallback chain.
- Secondary `original*` fields (`originalShortName`, `originalBio`, `originalDescription`, `originalCity`, `originalVenue`, `originalStageName`) stay nullable because their translation-table counterparts are nullable — a real event may have no short name; a real person may have no stage name.
- Import-route create branches reworked: `requireOriginalSource()` narrows the source variable to non-null at the create site; pre-computed spread variables replaced with explicit field assignments to satisfy the new NOT NULL column.

### v0.8.5 (2026-04-21)
- Admin form scaffolding for parent-level `original*` fields. POST / PUT routes for `Artist` (incl. nested `StageIdentity` + `RealPerson`), `EventSeries`, `Event`, `Group` write parent `original*` + `originalLanguage`. Sets up v0.8.6 to flip `originalName` to NOT NULL once prod data is fully backfilled.
- Defense-in-depth on admin POST / PUT: `parseJsonBody` normalizes malformed JSON to 400, typed validators replace `as`-casts (`enumValue`, `nullableEnumValue`, `nullableString`, `nullableBigIntId` w/ `Number.isSafeInteger`, `nullableBoolean`, `nullableStringArray`). `resolveAdminSlug` trims and normalizes admin-supplied slugs with a `prefix-{timestamp}` fallback. Stage-identity slugs append `randomUUID().slice(0,8)` to avoid unique-constraint collisions; `va-{siSlug}` inherits the suffix. Atomic transactions for delete + update flows; blank-string rejection on `performerIds` / `guestIds` / `stageIdentityId`.

### v0.8.4 (2026-04-21)
- Schema: `originalName` / `originalShortName` / `originalBio` / `originalDescription` / `originalCity` / `originalVenue` (per entity) + `originalLanguage` added to `Artist`, `Group`, `EventSeries`, `Event`, `StageIdentity`, `RealPerson`. `post-deploy.sql` backfills from the matching-locale translation row. `Album.originalLanguage` normalized (`jp` → `ja`) + `originalTitle` backfilled, plus an orphan-guard that raises a Postgres `WARNING` (never an error) for any parent row still missing its identity field.
- New `displayOriginalName`, `displayNameWithFallback`, `resolveLocalizedField` helpers replace ~60 strict-`pickTranslation` call sites across event / artist / series / member / song pages, OG routes, and components. A ja viewer with no ja translation row now sees the parent `original*` values instead of a ko or en bleed-through.

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
