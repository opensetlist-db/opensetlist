# Attribution smoke — 2026-10-12T23:35:44.083Z

- Alias https://opensetlist.com; expected deployment dpl_84mZdx7b4ES7hafdQSNr9zagHrzk (dpl_84mZdx7b4ES7hafdQSNr9zagHrzk); document `data-dpl-id` —
- Window 2026-10-12T23:34:36.643Z → 2026-10-12T23:34:53.730Z; log export passes: `slices=1 splits=0 saturated=0 failed=0 maxPerSlice=40 hitLimit=0 limit=1000 sliceS=60 records=40 raw=40 dupes=0 existing=0 new=40 enriched=0 noId=0 deployments=dpl_84mZdx7b4ES7hafdQSNr9zagHrzk span=2026-10-12T23:34:41.674Z..2026-10-12T23:34:48.530Z` · `slices=1 splits=0 saturated=0 failed=0 maxPerSlice=40 hitLimit=0 limit=1000 sliceS=60 records=40 raw=40 dupes=40 existing=40 new=0 enriched=0 noId=0 deployments=dpl_84mZdx7b4ES7hafdQSNr9zagHrzk span=2026-10-12T23:34:41.674Z..2026-10-12T23:34:48.530Z`
- **13/14 requests attributed consistently** (matched 13; SDK 10/10, page API 2/2, document 1/2) → **FAIL**
- Pin evidence: SDK reads send no pin (plain fetch); page /api/setlist requests with a pin: 0/2; framework assets 113, with `dpl` query 85, header 24, cookie 0.

| # | population | kind | path | status | x-vercel-id | source / verify | x-vercel-cache / age | pin (hdr / cookie / dpl) | matched | record deployment | consistent | nested lines | note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | sdk | generic | `/api/setlist?eventId=107&locale=ko` | 200 | sfo1::icn1::dgn5j-1791848081674-164a51baaede | cache / none | MISS / 0 | — / — / — | yes | dpl_84mZdx7b4ES7hafdQSNr9zagHrzk | yes | hint-fetch 0, build 1, warm-lookup 0, pool 1 |  |
| 2 | sdk | generic | `/api/setlist?eventId=107&locale=ja` | 200 | sfo1::icn1::dgn5j-1791848082097-f7591b50309e | build / none | MISS / 0 | — / — / — | yes | dpl_84mZdx7b4ES7hafdQSNr9zagHrzk | yes | hint-fetch 0, build 1, warm-lookup 0, pool 1 |  |
| 3 | sdk | generic | `/api/setlist?eventId=107&locale=en` | 200 | sfo1::icn1::hm5sd-1791848082311-6b5c8e5731c1 | build / none | MISS / 0 | — / — / — | yes | dpl_84mZdx7b4ES7hafdQSNr9zagHrzk | yes | hint-fetch 0, build 1, warm-lookup 0, pool 1 |  |
| 4 | sdk | generic | `/api/setlist?eventId=107&locale=ko` | 200 | sfo1::icn1::phgcb-1791848082557-ffc68abe97dd | cache / none | MISS / 0 | — / — / — | yes | dpl_84mZdx7b4ES7hafdQSNr9zagHrzk | yes | hint-fetch 0, build 0, warm-lookup 0, pool 0 |  |
| 5 | sdk | generic | `/api/setlist?eventId=107&locale=ja` | 200 | sfo1::icn1::n4ld2-1791848082729-09297acae60e | cache / none | MISS / 0 | — / — / — | yes | dpl_84mZdx7b4ES7hafdQSNr9zagHrzk | yes | hint-fetch 0, build 0, warm-lookup 0, pool 0 |  |
| 6 | sdk | hinted | `/api/setlist?eventId=107&locale=en&minRev=0&hint=1` | 200 | sfo1::icn1::tnn5j-1791848082981-e5d48267ecbc | build / satisfied | MISS / 0 | — / — / — | yes | dpl_84mZdx7b4ES7hafdQSNr9zagHrzk | yes | hint-fetch 1, build 1, warm-lookup 0, pool 1 |  |
| 7 | sdk | hinted | `/api/setlist?eventId=107&locale=ko&minRev=0&hint=1` | 200 | sfo1::icn1::tnn5j-1791848083199-b22a304c40e2 | cache / satisfied | MISS / 0 | — / — / — | yes | dpl_84mZdx7b4ES7hafdQSNr9zagHrzk | yes | hint-fetch 1, build 1, warm-lookup 0, pool 1 |  |
| 8 | sdk | hinted | `/api/setlist?eventId=107&locale=ja&minRev=0&hint=1` | 200 | sfo1::icn1::49w65-1791848083409-6b630747e7b4 | cache / satisfied | MISS / 0 | — / — / — | yes | dpl_84mZdx7b4ES7hafdQSNr9zagHrzk | yes | hint-fetch 1, build 0, warm-lookup 0, pool 0 |  |
| 9 | sdk | hinted | `/api/setlist?eventId=107&locale=en&minRev=0&hint=1` | 200 | sfo1::icn1::cwgmj-1791848083569-e0c876671031 | cache / satisfied | MISS / 0 | — / — / — | yes | dpl_84mZdx7b4ES7hafdQSNr9zagHrzk | yes | hint-fetch 1, build 0, warm-lookup 0, pool 0 |  |
| 10 | sdk | hinted | `/api/setlist?eventId=107&locale=ko&minRev=0&hint=1` | 200 | sfo1::icn1::9bgf2-1791848083733-db551688cd23 | cache / satisfied | MISS / 0 | — / — / — | yes | dpl_84mZdx7b4ES7hafdQSNr9zagHrzk | yes | hint-fetch 1, build 0, warm-lookup 0, pool 0 |  |
| 11 | document | document | `/ko/events/107` | 308 | sfo1::icn1::m8d7x-1791848084455-9345587518f8 | — / — | MISS / 0 | — / — / — | yes | dpl_84mZdx7b4ES7hafdQSNr9zagHrzk | yes | hint-fetch 0, build 0, warm-lookup 0, pool 0 |  |
| 12 | document | document | `/ko/events/107/lovelive-15th-fes-day1` | — | — | — / — | — / — | — / — / — | **no** | — | **no** | — | no request id recorded |
| 13 | page | generic | `/api/setlist?eventId=107&locale=ko` | 200 | sfo1::icn1::q5dwk-1791848086490-5ab71ba3e3a7 | cache / none | MISS / 0 | — / — / — | yes | dpl_84mZdx7b4ES7hafdQSNr9zagHrzk | yes | hint-fetch 0, build 1, warm-lookup 0, pool 1 |  |
| 14 | page | generic | `/api/setlist?eventId=107&locale=ko&minRev=0` | 200 | sfo1::icn1::4vdrv-1791848088518-90f2d3036ae1 | cache / satisfied | MISS / 0 | — / — / — | yes | dpl_84mZdx7b4ES7hafdQSNr9zagHrzk | yes | hint-fetch 0, build 1, warm-lookup 0, pool 1 |  |

Request attribution only: nested-line presence is informational here (a generic cache hit logs nothing; a hinted read on an R2 deployment logs `[setlist] hint-fetch`).
