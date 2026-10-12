# Attribution smoke — 2026-10-12T15:43:22.312Z

- Alias https://opensetlist-git-dev-opensetlist-projects.vercel.app; expected deployment dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 (https://opensetlist-6l87uqc8o-opensetlist-projects.vercel.app); document `data-dpl-id` dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5
- Window 2026-10-12T15:42:35.845Z → 2026-10-12T15:42:53.516Z; log export passes: `slices=1 splits=0 saturated=0 failed=0 maxPerSlice=58 hitLimit=0 limit=1000 sliceS=60 records=58 raw=58 dupes=0 existing=0 new=58 enriched=0 noId=0 deployments=dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 span=2026-10-12T15:42:40.896Z..2026-10-12T15:42:51.276Z`
- **13/13 requests attributed consistently** (matched 13; SDK 10/10, page API 2/2, document 1/1) → **PASS**
- Pin evidence: SDK reads send no pin (plain fetch); page /api/setlist requests with a pin: 0/2; framework assets 104, with `dpl` query 58, header 44, cookie 0.

| # | population | kind | path | status | x-vercel-id | source / verify | x-vercel-cache / age | pin (hdr / cookie / dpl) | matched | record deployment | consistent | nested lines | note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | sdk | generic | `/api/setlist?eventId=111&locale=ko` | 200 | sfo1::icn1::shzq4-1791819760896-4dd2099eb5eb | cache / none | MISS / 0 | — / — / — | yes | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | yes | hint-fetch 0, build 1, warm-lookup 0, pool 1 |  |
| 2 | sdk | generic | `/api/setlist?eventId=111&locale=ja` | 200 | sfo1::icn1::44kj9-1791819762947-86e2d196be10 | cache / none | MISS / 0 | — / — / — | yes | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | yes | hint-fetch 0, build 1, warm-lookup 0, pool 1 |  |
| 3 | sdk | generic | `/api/setlist?eventId=111&locale=en` | 200 | sfo1::icn1::44kj9-1791819763273-2c96978e226c | cache / none | MISS / 0 | — / — / — | yes | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | yes | hint-fetch 0, build 1, warm-lookup 0, pool 1 |  |
| 4 | sdk | generic | `/api/setlist?eventId=111&locale=ko` | 200 | sfo1::icn1::44kj9-1791819763501-6faa68fd0eed | cache / none | MISS / 0 | — / — / — | yes | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | yes | hint-fetch 0, build 0, warm-lookup 0, pool 0 |  |
| 5 | sdk | generic | `/api/setlist?eventId=111&locale=ja` | 200 | sfo1::icn1::shzq4-1791819763683-e53ddc250d26 | cache / none | MISS / 0 | — / — / — | yes | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | yes | hint-fetch 0, build 1, warm-lookup 0, pool 1 |  |
| 6 | sdk | hinted | `/api/setlist?eventId=111&locale=en&minRev=1687&hint=1` | 200 | sfo1::icn1::shzq4-1791819763893-85176ed8cfc2 | cache / satisfied | MISS / 0 | — / — / — | yes | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | yes | hint-fetch 1, build 0, warm-lookup 1, pool 0 |  |
| 7 | sdk | hinted | `/api/setlist?eventId=111&locale=ko&minRev=1687&hint=1` | 200 | sfo1::icn1::shzq4-1791819764073-3fe80f963f4e | cache / satisfied | MISS / 0 | — / — / — | yes | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | yes | hint-fetch 1, build 1, warm-lookup 1, pool 1 |  |
| 8 | sdk | hinted | `/api/setlist?eventId=111&locale=ja&minRev=1687&hint=1` | 200 | sfo1::icn1::v42sl-1791819764307-996d16aa8bbc | cache / satisfied | MISS / 0 | — / — / — | yes | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | yes | hint-fetch 1, build 1, warm-lookup 1, pool 1 |  |
| 9 | sdk | hinted | `/api/setlist?eventId=111&locale=en&minRev=1687&hint=1` | 200 | sfo1::icn1::2mjnl-1791819764535-d7d389003c45 | cache / satisfied | MISS / 0 | — / — / — | yes | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | yes | hint-fetch 1, build 0, warm-lookup 1, pool 0 |  |
| 10 | sdk | hinted | `/api/setlist?eventId=111&locale=ko&minRev=1687&hint=1` | 200 | sfo1::icn1::2mjnl-1791819764721-bfdbcd720a51 | cache / satisfied | MISS / 0 | — / — / — | yes | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | yes | hint-fetch 1, build 1, warm-lookup 1, pool 1 |  |
| 11 | document | document | `/ko/events/111/rehearsal-lovelive-fes-2020-day1` | 200 | sfo1::icn1::rj79s-1791819765740-befd259551f5 | — / — | MISS / 0 | — / — / — | yes | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | yes | hint-fetch 0, build 1, warm-lookup 0, pool 1 |  |
| 12 | page | generic | `/api/setlist?eventId=111&locale=ko&minRev=1687` | 200 | sfo1::icn1::rj79s-1791819767925-bcc8d7045b8d | cache / satisfied | MISS / 0 | — / — / — | yes | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | yes | hint-fetch 0, build 1, warm-lookup 0, pool 1 |  |
| 13 | page | generic | `/api/setlist?eventId=111&locale=ko&minRev=1687` | 200 | sfo1::icn1::vbcdc-1791819768301-ce8821398347 | cache / satisfied | MISS / 0 | — / — / — | yes | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | yes | hint-fetch 0, build 0, warm-lookup 0, pool 0 |  |

Request attribution only: nested-line presence is informational here (a generic cache hit logs nothing; a hinted read on an R2 deployment logs `[setlist] hint-fetch`).
