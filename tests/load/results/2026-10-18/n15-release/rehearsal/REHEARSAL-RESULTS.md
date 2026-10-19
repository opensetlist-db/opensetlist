# n15 Fes fan board — dev Preview rehearsal results

Run: 2026-10-19T04:07:19.583Z → 2026-10-19T04:09:38.948Z (UTC) against https://opensetlist-gzwu0qdmq-opensetlist-projects.vercel.app, event 109 only (110 read-only).

Aggregate `asOf` before: `2026-10-19T04:03:23.404Z` · after: `2026-10-19T04:09:23.252Z` (the TTL recompute at 04:07:19Z happened on the script's first read, before any write, so it still showed 0 submissions; the next recompute ~120 s later carried every write — consistent with the TTL-only, no-write-invalidation design).

## Results

| # | step | expectation | observed status / body | latency (ms) | result |
|---|---|---|---|---|---|
| 1 | 1 pick add | 201 new pick (group 1, song 69) | 201 {"id":"ebe9fd7d-6b8e-4556-906b-a3cc09a7c3db","groupId":"1","songId":"69","createdAt":"2026-10-19T04:07:19.768Z"} | 269 | PASS |
| 2 | 1 pick add | 201 new pick (group 1, song 374) | 201 {"id":"36d41080-b2d1-45c5-a124-e1a91afc09c9","groupId":"1","songId":"374","createdAt":"2026-10-19T04:07:20.047Z"} | 273 | PASS |
| 3 | 1 pick add | 201 new pick (group 1, song 4600) | 201 {"id":"1a750dcf-119a-47db-9111-e57442504332","groupId":"1","songId":"4600","createdAt":"2026-10-19T04:07:20.296Z"} | 250 | PASS |
| 4 | 1 pick 4th | 409 cap_reached | 409 {"error":"cap_reached"} | 262 | PASS |
| 5 | 1 pick re-add | 200 idempotent, same id ebe9fd7d-6b8e-4556-906b-a3cc09a7c3db | 200 {"id":"ebe9fd7d-6b8e-4556-906b-a3cc09a7c3db","groupId":"1","songId":"69","createdAt":"2026-10-19T04:07:19.768Z"} | 274 | PASS |
| 6 | 1 pick same song other group | 409 group_conflict (route doc; task said 'reassign') | 409 {"error":"group_conflict"} | 229 | PASS |
| 7 | 1 pick song outside group | 400 song_outside_group | 400 {"error":"song_outside_group"} | 195 | PASS |
| 8 | 1 pick missing anonId | 400 invalid_anon_id | 400 {"error":"invalid_anon_id"} | 167 | PASS |
| 9 | 1 pick empty anonId | 400 invalid_anon_id | 400 {"error":"invalid_anon_id"} | 176 | PASS |
| 10 | 1 pick unknown event | 404 not_found | 404 {"error":"not_found"} | 172 | PASS |
| 11 | 1 pick group not on board | 400 invalid_group | 400 {"error":"invalid_group"} | 188 | PASS |
| 12 | 1 pick malformed group | 400 invalid_group | 400 {"error":"invalid_group"} | 171 | PASS |
| 13 | 2 wish add | 201 new wish (group 24, song 573) | 201 {"id":"78a8471d-9992-42ec-b8b7-639d02484e0c","groupId":"24","songId":"573","createdAt":"2026-10-19T04:07:22.396Z"} | 258 | PASS |
| 14 | 2 wish add | 201 new wish (group 24, song 652) | 201 {"id":"7e4da872-056c-4140-bbc8-58655b9bfb9e","groupId":"24","songId":"652","createdAt":"2026-10-19T04:07:22.689Z"} | 292 | PASS |
| 15 | 2 wish add | 201 new wish (group 24, song 744) | 201 {"id":"f832fc24-519c-49e5-a8b2-4d0b65b15904","groupId":"24","songId":"744","createdAt":"2026-10-19T04:07:22.927Z"} | 238 | PASS |
| 16 | 2 wish 4th | 409 cap_reached | 409 {"error":"cap_reached"} | 221 | PASS |
| 17 | 2 wish duplicate | 200 idempotent, same id 78a8471d-9992-42ec-b8b7-639d02484e0c | 200 {"id":"78a8471d-9992-42ec-b8b7-639d02484e0c","groupId":"24","songId":"573","createdAt":"2026-10-19T04:07:22.396Z"} | 225 | PASS |
| 18 | 2 wish without anonId | 400 invalid_anon_id | 400 {"error":"invalid_anon_id"} | 157 | PASS |
| 19 | 2 wish without groupId | 400 invalid_group | 400 {"error":"invalid_group"} | 179 | PASS |
| 20 | 2 wish legacy body {songId} | 400 (board event refuses legacy shape) | 400 {"error":"invalid_anon_id"} | 274 | PASS |
| 21 | 3 mine A | exactly picks ["1a750dcf-119a-47db-9111-e57442504332","36d41080-b2d1-45c5-a124-e1a91afc09c9","ebe9fd7d-6b8e-4556-906b-a3cc09a7c3db"] and wishes ["78a8471d-9992-42ec-b8b7-639d02484e0c","7e4da872-056c-4140-bbc8-58655b9bfb9e","f832fc24-519c-49e5-a8b2-4d0b65b15904"] | 200 picks=[["1","69","365 Days"],["1","374","37.5℃のファンタジー"],["1","4600","Bring the LOVE！"]] wishes=[["24","573","☆ワンダーランド☆"],["24","652","4 SEASONS"],["24","744","5201314"]] | 215 | PASS |
| 22 | 3 mine B | 200 { picks: [], wishes: [] } | 200 {"picks":[],"wishes":[]} | 179 | PASS |
| 23 | 3 mine anonId in query | 400 anon_in_query | 400 {"error":"anon_in_query"} | 168 | PASS |
| 24 | 4 delete A's pick as B | 403 not_owner | 403 {"error":"not_owner"} | 223 | PASS |
| 25 | 4 delete A's pick as A | 200 { id: 36d41080-b2d1-45c5-a124-e1a91afc09c9 } | 200 {"id":"36d41080-b2d1-45c5-a124-e1a91afc09c9"} | 190 | PASS |
| 26 | 4 mine A after delete | 2 picks (songs 69, 4600), 3 wishes | 200 picks=["69","4600"] wishes=3 | 213 | PASS |
| 27 | 4 delete again (retry) | 404 pick_not_found | 404 {"error":"pick_not_found"} | 211 | PASS |
| 28 | 5 publish set1 (2 groups, 2+3 songs) | 200 with 5 picks | 200 [["1","69"],["24","652"],["1","10"],["24","573"],["24","744"]] | 272 | PASS |
| 29 | 5 publish set2 (changed) | 200, 3 picks; 69 & 573 keep id+createdAt; 10/652/744 gone; 2503 new | 200 [["1","69","retained","2026-10-19T04:07:25.675Z"],["24","573","retained","2026-10-19T04:07:25.675Z"],["78","2503","new","2026-10-19T04:07:27.198Z"]] | 309 | PASS |
| 30 | 5 mine B after set2 | same 3 rows, retained createdAt | 200 [["1","69","2026-10-19T04:07:25.675Z"],["24","573","2026-10-19T04:07:25.675Z"],["78","2503","2026-10-19T04:07:27.198Z"]] | 189 | PASS |
| 31 | 5 publish duplicate entry | 400 duplicate_song (nothing written) | 400 {"error":"duplicate_song"} | 169 | PASS |
| 32 | 5 publish same song two groups | 400 duplicate_song | 400 {"error":"duplicate_song"} | 204 | PASS |
| 33 | 5 publish 4 in one group | 409 cap_reached | 409 {"error":"cap_reached"} | 215 | PASS |
| 34 | 5 mine B unchanged after refused publishes | still 3 picks | 200 3 picks | 182 | PASS |
| 35 | 5 publish [] clears | 200 { picks: [] } | 200 {"picks":[]} | 203 | PASS |
| 36 | 5 mine B after clear | empty | 200 {"picks":[],"wishes":[]} | 161 | PASS |
| 37 | 7 dataset writes | 30 × 201 | 30/30 created | 221–319 (avg 246) | PASS |
| 38 | 6 aggregate asOf advanced | asOf > 2026-10-19T04:03:23.404Z | asOf 2026-10-19T04:09:23.252Z | 231 | PASS |
| 39 | 6 group 1 蓮ノ空 expects | top {"69":3,"374":2}, submissions 7, participants 3, label early | top [["69","365 Days",3],["374","37.5℃のファンタジー",2],["4600","Bring the LOVE！",1]], submissions 7, participants 3, label early | 231 | PASS |
| 40 | 6 group 1 蓮ノ空 wishes | top {"10":3,"374":1,"420":2}, submissions 6, participants 3, label early | top [["10","AWOKE",3],["420","A出るノート",2],["374","37.5℃のファンタジー",1]], submissions 6, participants 3, label early | 231 | PASS |
| 41 | 6 group 24 虹ヶ咲 expects | top {"587":2,"616":3,"5124":1}, submissions 6, participants 3, label early | top [["616","Awakening Promise",3],["587","Beautiful Moonlight",2],["5124","Bitter Blue",1]], submissions 6, participants 3, label early | 231 | PASS |
| 42 | 6 group 24 虹ヶ咲 wishes | top {"573":3,"652":2,"744":1}, submissions 6, participants 3, label early | top [["573","☆ワンダーランド☆",3],["652","4 SEASONS",2],["744","5201314",1]], submissions 6, participants 3, label early | 231 | PASS |
| 43 | 6 group 78 Aqours expects | top {"2503":3,"2568":1,"2691":2}, submissions 6, participants 3, label early | top [["2503","“MY LIST” to you!",3],["2691","1STAR",2],["2568","Amazing Travel DNA",1]], submissions 6, participants 3, label early | 231 | PASS |
| 44 | 6 group 78 Aqours wishes | top {"2503":1,"2573":3}, submissions 4, participants 3, label early | top [["2573","Aqours Pirates Desire",3],["2503","“MY LIST” to you!",1]], submissions 4, participants 3, label early | 231 | PASS |
| 45 | 6 group 44 いきづらい部！ untouched | both columns operator, 0 submissions, starters present | expects operator/0, wishes operator/0, starters 3 | 231 | PASS |
| 46 | 6 group 94 μ's untouched | both columns operator, 0 submissions, starters present | expects operator/0, wishes operator/0, starters 3 | 231 | PASS |
| 47 | 6 group 62 Liella! untouched | both columns operator, 0 submissions, starters present | expects operator/0, wishes operator/0, starters 3 | 231 | PASS |
| 48 | 6 group 43 AiScReam untouched | both columns operator, 0 submissions, starters present | expects operator/0, wishes operator/0, starters 2 | 231 | PASS |
| 49 | 6 group 84 GKSS untouched | both columns operator, 0 submissions, starters present | expects operator/0, wishes operator/0, starters 2 | 231 | PASS |
| 50 | 7 dev 110 untouched (read only) | every group operator / 0 submissions | 200 [["24",0,0],["1",0,0],["62",0,0],["44",0,0],["94",0,0],["78",0,0],["43",0,0],["84",0,0]] | 188 | PASS |
| – | 8 screenshots ja | board section visible, expect column rendered, chips, 蓮ノ空 chip clickable | tabs ["虹ヶ咲","蓮ノ空","Liella!","いきづらい部！","μ's","Aqours","AiScReam","GKSS"]; default chip 虹ヶ咲; 蓮ノ空 chip index 1; early badges 2; console/page errors 0 | page→board 2366 | PASS |
| – | 8 copy button ja | present and disabled (fresh browser, zero local picks) | count 1, disabled true, localStorage board keys [] | – | PASS |
| – | 8 bridges ja | explore-group link renders; "full setlist mode" button renders only inside the D-7 Predict window | explore 1 ("虹ヶ咲をのぞいてみる" → /ja/artists/24/nijigasaki; after chip click "蓮ノ空をのぞいてみる"); full-setlist button 0 (expected 0: event is 2026-11-14, outside D-7) | – | PASS |
| – | 8 screenshots ko | board section visible, expect column rendered, chips, 蓮ノ空 chip clickable | tabs ["니지가사키","하스노소라","Liella!","이키즈라이부!","μ's","Aqours","AiScReam","GKSS"]; default chip 니지가사키; 蓮ノ空 chip index 1; early badges 2; console/page errors 0 | page→board 2015 | PASS |
| – | 8 copy button ko | present and disabled (fresh browser, zero local picks) | count 1, disabled true, localStorage board keys [] | – | PASS |
| – | 8 bridges ko | explore-group link renders; "full setlist mode" button renders only inside the D-7 Predict window | explore 1 ("니지가사키 둘러보기" → /ko/artists/24/nijigasaki; after chip click "하스노소라 둘러보기"); full-setlist button 0 (expected 0: event is 2026-11-14, outside D-7) | – | PASS |
| – | 8 screenshots en | board section visible, expect column rendered, chips, 蓮ノ空 chip clickable | tabs ["Nijigasaki","Hasunosora","Liella!","Ikizurai-Bu!","μ's","Aqours","AiScReam","GKSS"]; default chip Nijigasaki; 蓮ノ空 chip index 1; early badges 2; console/page errors 0 | page→board 2901 | PASS |
| – | 8 copy button en | present and disabled (fresh browser, zero local picks) | count 1, disabled true, localStorage board keys [] | – | PASS |
| – | 8 bridges en | explore-group link renders; "full setlist mode" button renders only inside the D-7 Predict window | explore 1 ("Explore Nijigasaki" → /en/artists/24/nijigasaki; after chip click "Explore Hasunosora"); full-setlist button 0 (expected 0: event is 2026-11-14, outside D-7) | – | PASS |

**Summary: 50/50 API checks PASS, 0 FAIL; 9/9 screenshot checks PASS.**

## Contract notes (route doc vs. task wording)

- "Same song under another group": the route doc says 409 `group_conflict` (move = remove + add, never a silent reassign). Observed 409 `group_conflict`. The task text called it "reassign"; the route's own doc wins and the behaviour matches it.
- Unknown event → 404 `not_found`; group not on the board or malformed group id → 400 `invalid_group` (both documented in the POST doc comment).
- Wish POST on a board-enabled event without `groupId` → 400 `invalid_group`; the legacy `{ songId: <number> }` body is refused the same way (the per-group path is mandatory while `boardEnabled`).
- A retried pick DELETE → 404 `pick_not_found` (documented as "already gone").
- `/board/mine` with `anonId` in the query → 400 `anon_in_query` (documented guard).
- Publish refuses a song listed twice even across two groups (400 `duplicate_song`) and >3 per group (409 `cap_reached`) with nothing written — verified via `/mine` afterwards.
- The "Go to full setlist mode" bridge button is not rendered on 109: `LiveSetlist.tsx` passes `onOpenFullSetlist` only when `bridgeOpen` (upcoming AND inside the D-7 Predict window). 109 starts 2026-11-14, 27 days out, so only the explore link is visible. Not a defect; re-check within D-7.

## Dataset left on dev 109 (remove later)

Anon ids: A = `rehearsal-A-mveqgptw`, B = `rehearsal-B-mveqgptw`, C = `rehearsal-C-mveqgptw`, D = `rehearsal-D-mveqgptw`, E = `rehearsal-E-mveqgptw`. B holds no rows (ballot cleared by the empty publish).

### BoardPick rows (19)

| id | anonId | groupArtistId | songId |
|---|---|---|---|
| a7e5a781-5afa-46e8-936d-5e068fba5c8b | rehearsal-C-mveqgptw | 1 | 69 |
| 23919433-3d28-4500-a231-a1409d39b9da | rehearsal-C-mveqgptw | 1 | 374 |
| ca3f4f83-6e45-42ef-9686-0e7ebaa92439 | rehearsal-C-mveqgptw | 1 | 81 |
| 6e507e67-1051-4f43-9c40-2a9780477bfd | rehearsal-D-mveqgptw | 1 | 69 |
| dc4d9eae-5b01-4890-ac85-114246c4c019 | rehearsal-D-mveqgptw | 1 | 374 |
| 21cf61c9-b7dd-4d8a-b02c-e838c92873e3 | rehearsal-C-mveqgptw | 24 | 616 |
| 46fc2a85-6e2d-4d26-9930-47208e527d71 | rehearsal-C-mveqgptw | 24 | 587 |
| 53f30e9f-d48a-45ba-926b-abc405c3a51b | rehearsal-D-mveqgptw | 24 | 616 |
| 092c6f19-3ca6-4e7e-be59-ef8fafff64d0 | rehearsal-E-mveqgptw | 24 | 616 |
| f6a7da72-c78b-4d33-8921-d2aecdfb4c9c | rehearsal-E-mveqgptw | 24 | 587 |
| 64af38e7-41da-4b6e-9bf0-8e88913ed8f3 | rehearsal-E-mveqgptw | 24 | 5124 |
| 967cdaba-8d48-40fa-8436-831992ed7182 | rehearsal-C-mveqgptw | 78 | 2503 |
| 8d57e31c-cf63-42b5-9670-dea3f94abddd | rehearsal-C-mveqgptw | 78 | 2691 |
| f7608d9f-f66c-46a1-ac7e-042d460983b4 | rehearsal-C-mveqgptw | 78 | 2568 |
| a7c56360-c245-48ad-91d7-04bf4357ebd7 | rehearsal-D-mveqgptw | 78 | 2503 |
| 5b7ea515-954f-4214-a7a4-91389d185b25 | rehearsal-D-mveqgptw | 78 | 2691 |
| 32a14ee6-730f-41ca-8b5e-6bbedd828d36 | rehearsal-E-mveqgptw | 78 | 2503 |
| ebe9fd7d-6b8e-4556-906b-a3cc09a7c3db | rehearsal-A-mveqgptw | 1 | 69 |
| 1a750dcf-119a-47db-9111-e57442504332 | rehearsal-A-mveqgptw | 1 | 4600 |

### SongWish rows (16)

| id | anonId | groupArtistId | songId |
|---|---|---|---|
| 47e9bb6e-b201-46ee-9810-4dcd9bceb52f | rehearsal-C-mveqgptw | 1 | 10 |
| 9eb18044-6ee7-4f09-ae73-843fc6e50d48 | rehearsal-C-mveqgptw | 1 | 420 |
| 0a31a7c0-591a-47fe-b95f-de0b0e84e9e1 | rehearsal-D-mveqgptw | 1 | 10 |
| 393130ed-e29e-42f8-8416-0609ad1d0de0 | rehearsal-E-mveqgptw | 1 | 10 |
| 5d72001e-1cf8-4b2b-b1ce-5709a3fa2f70 | rehearsal-E-mveqgptw | 1 | 420 |
| af2aff15-7c40-4452-ada8-4b08817e24b5 | rehearsal-E-mveqgptw | 1 | 374 |
| 0ebef2bd-886f-483b-8d5d-5855901dc3a2 | rehearsal-C-mveqgptw | 24 | 573 |
| 78521e0b-dd62-48de-a6cb-bd31759d72d1 | rehearsal-C-mveqgptw | 24 | 652 |
| 7658d455-73a5-4488-b9a4-d53000d3154e | rehearsal-D-mveqgptw | 24 | 573 |
| 1745dbed-090d-461b-94b0-40ae530cdeae | rehearsal-C-mveqgptw | 78 | 2573 |
| 6d6faf57-6346-4488-9d8b-eb302db25a66 | rehearsal-D-mveqgptw | 78 | 2573 |
| edfe092f-03ed-41c0-88ed-ec268fccc89a | rehearsal-D-mveqgptw | 78 | 2503 |
| 5a2c3293-ae04-4fc8-a745-6e24070b8e90 | rehearsal-E-mveqgptw | 78 | 2573 |
| 78a8471d-9992-42ec-b8b7-639d02484e0c | rehearsal-A-mveqgptw | 24 | 573 |
| 7e4da872-056c-4140-bbc8-58655b9bfb9e | rehearsal-A-mveqgptw | 24 | 652 |
| f832fc24-519c-49e5-a8b2-4d0b65b15904 | rehearsal-A-mveqgptw | 24 | 744 |

Cleanup (dev DB): `DELETE FROM "BoardPick" WHERE "eventId" = 109 AND "anonId" LIKE 'rehearsal-%-mveqgptw'; DELETE FROM "SongWish" WHERE "eventId" = 109 AND "anonId" LIKE 'rehearsal-%-mveqgptw';`

Resulting aggregate (groups 1 / 24 / 78, label `early`, 3 participants each): 蓮ノ空 expects 365 Days 3 · 37.5℃のファンタジー 2 · Bring the LOVE！ 1 (+ AURORA FLOWER 1, below TOP3), wishes AWOKE 3 · A出るノート 2 · 37.5℃ 1; 虹ヶ咲 expects Awakening Promise 3 · Beautiful Moonlight 2 · Bitter Blue 1, wishes ☆ワンダーランド☆ 3 · 4 SEASONS 2 · 5201314 1; Aqours expects “MY LIST” to you! 3 · 1STAR 2 · Amazing Travel DNA 1, wishes Aqours Pirates Desire 3 · “MY LIST” to you! 1. いきづらい部！, μ's, Liella!, AiScReam, GKSS: starters only (`operator`). Dev 110: untouched (every group 0/0).

## Screenshots (375×812, isMobile, DPR 2)

- board-109-ja-375px.png — default chip (虹ヶ咲)
- board-109-ja-hasunosora-375px.png — after clicking the 蓮ノ空 chip
- board-109-ko-375px.png — default chip (니지가사키)
- board-109-ko-hasunosora-375px.png — after clicking the 蓮ノ空 chip
- board-109-en-375px.png — default chip (Nijigasaki)
- board-109-en-hasunosora-375px.png — after clicking the 蓮ノ空 chip

## Files

- `api-log.json` — every request (method, path, body, headers, status, body, latency, timestamp), the result table, and the row ids.
- `board109.json` / `board109-after.json` — the aggregate before and after.
- `catalog109.json` — per-group base-song catalog extracted from the page's `availableSongs` RSC payload (no public catalog endpoint exists; the picks/publish validators use the same `getAvailableSongsCached` catalog).
- `screenshots-report.json` — DOM facts gathered during the screenshot run.