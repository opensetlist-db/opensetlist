# n15 release checkpoint — step A (dev verification), 2026-10-18

Dev head commit f34884e1 (origin/dev; origin/main 3352231d = v0.20.0). Preview deployment of the dev head: https://opensetlist-gzwu0qdmq-opensetlist-projects.vercel.app (deployment id dpl_7okCfZ32KBwatuqkeCci81Bke31B). Checklist: wiki `output/n15-tickets/07-release-p1-and-first-promo.md`, section A. Compiled from the logs in this folder; verdicts are PASS / FAIL / PARTIAL / NOT EXERCISED.

## Checklist

| Check | Verdict | Evidence |
|---|---|---|
| A1 unit suite | PASS | Local run: Test Files 2 failed / 167 passed (169); Tests 4 failed / 2407 passed (2411), 83 s. All 4 failures are in `src/__tests__/unit/slug.test.ts` (katakana input returns ""). Rerun of `slug.test.ts` alone: 4 failed / 37 passed (41) in 1.7 s, so not the known timeout. Environmental: this worktree's `node_modules` lacks `kuromoji` and `kuroshiro-analyzer-kuromoji` (the main checkout has both). CI on the same commit f34884e1 (run 39163886311) passed: Test Files 169 passed (169), `slug.test.ts` 41 tests passed. See `unit-tests.txt`. |
| A1 integration suite | PASS | `vitest run -c vitest.integration.config.ts` against dev Supabase: Test Files 6 passed (6), Tests 63 passed (63), 339 s, exit 0. See `itest.txt`. |
| A2 `/api/setlist` 200 on dev 109 | PASS | GET `/api/setlist?eventId=109&locale=ja`, three times: HTTP 200, `X-Snapshot-Source: cache`, total 0.392 s / 0.216 s / 0.247 s. |
| A2 broadcast save visible | PASS | Dev event 111 smoke (`broadcast-smoke-111.log`, the n14 rehearsal fixture, status ongoing). save1 POST `/api/admin/setlist-items` 201 (MC row, id 3055) in 345 ms gave rev 1915; rev 1915 received on Realtime channel `event:111` +392 ms after save start. save2 DELETE 200 in 336 ms gave rev 1916; received +389 ms after delete start. Fixture back to its 23 rows. |
| A2 warm cache hit | PASS | Hinted GET `?minRev=1915&hint=1`: 200 in 182 ms, `x-snapshot-source=warm`, `x-snapshot-verify=satisfied`, items 24. Repeat hinted GET: 200 in 178 ms, warm / satisfied. Final GET after the delete: warm / satisfied, rev 1916, items 23 (baseline 23). |
| A3a board data-cache reuse | PASS | Dev event 109 `boardEnabled` set to true (see "Dev state" below). Burst of 3 GETs within 1 s right after enabling, from 3 instances: `asOf` 20:44:38.923Z / 20:44:39.428Z / 20:44:39.899Z (cold concurrent fill). Spaced check, 5 GETs 4 s apart across 5 different lambda instances: all HTTP 200, 0.25 / 0.25 / 0.23 / 0.24 / 0.24 s, `asOf` 2026-10-18T20:44:39.899Z on all five, so one computation served from the shared data cache. `Cache-Control: no-store` on every answer. Vercel logs not read (no CLI login in this session). |
| A3b `/mine` header-only, `?anonId` 400 | PASS | GET `/api/events/109/board/mine?locale=ja` with the `OpenSetlist-Anon-Token` header: 200 `{"picks":[],"wishes":[]}`, `Cache-Control: private, no-store`, 0.24 s. Without the header: 400 `{"error":"invalid_anon_id"}`. With `?anonId=` in the URL (and the header): 400 `{"error":"anon_in_query"}`. |
| A3c 375 px readability | PASS | Playwright Chromium, 375×812, isMobile, ja, `/ja/events/109/lovelive-15th-fes-day1`: HTTP 200, no page-level horizontal overflow. Chips container scrolls horizontally inside itself (scrollWidth 609 > clientWidth 341, `overflow-x: auto`, 8 chips). Columns stacked: want y 2951.9, expect y 3071.9, same x 31, width 313. Exactly one board request (`/api/events/109/board?locale=ja`). Screenshots `n15-release-A3c-board-375px-section.png` / `-viewport.png`. See `mobile-check.log`. |
| A3d ongoing page issues no board request | PASS | `/ja/events/111` (ongoing dev event 111): board requests 0, board section mounted 0, `/api` requests = `/api/setlist?eventId=111&locale=ja&minRev=1916` (a second load also listed `/api/impressions?eventId=111`); still no board request. See `mobile-check.log`. |
| A3d board-disabled event shows today's wishlist | NOT EXERCISED | Board-disabled upcoming dev event 110: board requests 0, board section mounted 0, only setlist `/api` requests; the wishlist heading 「この公演で聴きたい曲」 is not visible. Reason: dev 110 has no `engagementOpensAt` override and the show is 28 days out, so the D-7 pre-show window is closed on dev (the widget collapses exactly as before n15). Opening it would be a dev DB write, which this session's permission classifier denied. Exercisable on prod 107/108 after deploy (window open since 10/10) in the read-only smoke, or on dev by setting `engagementOpensAt` on 110. |
| A4 GA4 custom dimensions | NOT EXERCISED | Note for the owner: `event_id` and `group_id` must be registered as GA4 custom dimensions by the operator; not attempted in this checkpoint. |

## Timings

| Measurement | Value | Source |
|---|---|---|
| GET `/api/setlist` dev 109, cache (3 requests) | 0.392 s / 0.216 s / 0.247 s | A2 |
| GET `/api/setlist` dev 111 baseline, source=cache, rev 1914 | 282 ms | `broadcast-smoke-111.log` |
| POST save1 (MC row), 201, rev 1915 | 345 ms | `broadcast-smoke-111.log` |
| Broadcast rev 1915 arrival | +392 ms after save start | `broadcast-smoke-111.log` |
| Hinted GET (`?minRev=1915&hint=1`), warm / satisfied | 182 ms | `broadcast-smoke-111.log` |
| Hinted GET #2, warm / satisfied | 178 ms | `broadcast-smoke-111.log` |
| DELETE save2, 200, rev 1916 | 336 ms | `broadcast-smoke-111.log` |
| Broadcast rev 1916 arrival | +389 ms after delete start | `broadcast-smoke-111.log` |
| Board GET dev 109, spaced check (5 requests, 5 instances) | 0.25 / 0.25 / 0.23 / 0.24 / 0.24 s | A3a |
| GET `/api/events/109/board/mine` (header) | 0.24 s | A3b |
| Event page loads at 375 px (109 / 111 / 110, networkidle) | 4.1 s / 3.4 s / 4.6 s | `mobile-check.log` |

## Dev state changed by this run

- `boardEnabled` set to true on dev event 109 via `PATCH /api/admin/events/109/board` on the Preview (dev DB, 20:44:38Z). Left enabled.
- Smoke MC row on dev event 111 inserted (save1, id 3055) and then deleted (save2). Event 111 rev 1914 → 1916.
- Nothing else. No production resource was touched.

## Notes

- The `opensetlist-git-dev-opensetlist-projects.vercel.app` alias serves an older deployment (dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q) with no `/api/events/[id]/board` route (404). All Preview evidence uses the immutable dev-head URL above.
- Vercel logs were not read (no vercel CLI login in this session); the A3a verdict rests on the identical `asOf` across instances.
- A dev DB write was denied by the permission classifier: opening the wishlist window on dev event 110 (`engagementOpensAt`). This is why the A3d wishlist check is NOT EXERCISED.

## Files

- `n15-release-A3c-board-375px-section.png`: A3c board section at 375 px (dev 109, ja).
- `n15-release-A3c-board-375px-viewport.png`: A3c page viewport at 375 px.
- `n15-release-A3d-ongoing-111-375px.png`: A3d ongoing dev event 111 at 375 px.
- `n15-release-A3d-disabled-110-375px.png`: A3d board-disabled dev event 110 at 375 px.
- `mobile-check.log`: Playwright 375 px checks for events 109, 111 and 110 (A3c, A3d).
- `broadcast-smoke-111.log`: timestamped broadcast save/delete smoke on dev event 111 (A2).
- `broadcast-smoke.mjs`, `mobile-check.mjs`: the scripts that produced the two logs (dev Preview only; the smoke refuses any Supabase project other than dev).
