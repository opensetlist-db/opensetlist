# Attribution smoke — 2026-10-12T15:34:53.240Z

- Alias https://opensetlist-git-dev-opensetlist-projects.vercel.app; expected deployment dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 (https://opensetlist-6l87uqc8o-opensetlist-projects.vercel.app); document `data-dpl-id` dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5
- Window 2026-10-12T15:33:58.913Z → 2026-10-12T15:34:21.695Z; log export passes: `slices=1 splits=0 saturated=0 maxPerSlice=57 hitLimit=0 limit=1000 sliceS=60 records=57 raw=57 dupes=0 existing=0 new=57 enriched=0 noId=0 deployments=dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 span=2026-10-12T15:34:03.972Z..2026-10-12T15:34:18.581Z`
- **13/13 requests attributed consistently** (matched 13; SDK 10/10, page API 2/2, document 1/1) → **PASS**
- Pin evidence: SDK reads send no pin (plain fetch); page /api/setlist requests with a pin: 0/2; framework assets 103, with `dpl` query 58, header 44, cookie 0.

| # | population | kind | path | status | x-vercel-id | source / verify | x-vercel-cache / age | pin (hdr / cookie / dpl) | matched | record deployment | consistent | nested lines | note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | sdk | generic | `/api/setlist?eventId=111&locale=ko` | 200 | sfo1::icn1::x4xcg-1791819243972-9881e5cf8219 | cache / none | MISS / 0 | — / — / — | yes | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | yes | hint-fetch 0, build 1, warm-lookup 0, pool 1 |  |
| 2 | sdk | generic | `/api/setlist?eventId=111&locale=ja` | 200 | sfo1::icn1::98tqr-1791819246013-88d8592abf45 | cache / none | MISS / 0 | — / — / — | yes | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | yes | hint-fetch 0, build 1, warm-lookup 0, pool 1 |  |
| 3 | sdk | generic | `/api/setlist?eventId=111&locale=en` | 200 | sfo1::icn1::x4xcg-1791819246243-12a922cca51d | cache / none | MISS / 0 | — / — / — | yes | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | yes | hint-fetch 0, build 1, warm-lookup 0, pool 1 |  |
| 4 | sdk | generic | `/api/setlist?eventId=111&locale=ko` | 200 | sfo1::icn1::lwgbn-1791819246465-0aaf08b5eadf | cache / none | MISS / 0 | — / — / — | yes | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | yes | hint-fetch 0, build 0, warm-lookup 0, pool 0 |  |
| 5 | sdk | generic | `/api/setlist?eventId=111&locale=ja` | 200 | sfo1::icn1::8brf5-1791819246657-2de51eb7e895 | cache / none | MISS / 0 | — / — / — | yes | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | yes | hint-fetch 0, build 0, warm-lookup 0, pool 0 |  |
| 6 | sdk | hinted | `/api/setlist?eventId=111&locale=en&minRev=1687&hint=1` | 200 | sfo1::icn1::r98lr-1791819246833-1359c169349d | cache / satisfied | MISS / 0 | — / — / — | yes | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | yes | hint-fetch 1, build 0, warm-lookup 1, pool 0 |  |
| 7 | sdk | hinted | `/api/setlist?eventId=111&locale=ko&minRev=1687&hint=1` | 200 | sfo1::icn1::gwnpl-1791819247022-de1af3dbafad | cache / satisfied | MISS / 0 | — / — / — | yes | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | yes | hint-fetch 1, build 1, warm-lookup 1, pool 1 |  |
| 8 | sdk | hinted | `/api/setlist?eventId=111&locale=ja&minRev=1687&hint=1` | 200 | sfo1::icn1::gwnpl-1791819247277-4bc0f65d0953 | cache / satisfied | MISS / 0 | — / — / — | yes | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | yes | hint-fetch 1, build 0, warm-lookup 1, pool 0 |  |
| 9 | sdk | hinted | `/api/setlist?eventId=111&locale=en&minRev=1687&hint=1` | 200 | sfo1::icn1::44kj9-1791819247473-ec8b7ffda4c8 | cache / satisfied | MISS / 0 | — / — / — | yes | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | yes | hint-fetch 1, build 1, warm-lookup 1, pool 1 |  |
| 10 | sdk | hinted | `/api/setlist?eventId=111&locale=ko&minRev=1687&hint=1` | 200 | sfo1::icn1::8brf5-1791819247707-86a2d3850ea7 | cache / satisfied | MISS / 0 | — / — / — | yes | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | yes | hint-fetch 1, build 0, warm-lookup 1, pool 0 |  |
| 11 | document | document | `/ko/events/111/rehearsal-lovelive-fes-2020-day1` | 200 | sfo1::icn1::nddxd-1791819249837-93da39b841cb | — / — | MISS / 0 | — / — / — | yes | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | yes | hint-fetch 0, build 1, warm-lookup 0, pool 1 |  |
| 12 | page | generic | `/api/setlist?eventId=111&locale=ko&minRev=1687` | 200 | sfo1::icn1::7mzk5-1791819254141-80131f7ca2cb | cache / satisfied | MISS / 0 | — / — / — | yes | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | yes | hint-fetch 0, build 1, warm-lookup 0, pool 1 |  |
| 13 | page | generic | `/api/setlist?eventId=111&locale=ko&minRev=1687` | 200 | sfo1::icn1::rcbqk-1791819256473-a39d9d93093a | cache / satisfied | MISS / 0 | — / — / — | yes | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | yes | hint-fetch 0, build 1, warm-lookup 0, pool 1 |  |

Request attribution only: nested-line presence is informational here (a generic cache hit logs nothing; a hinted read on an R2 deployment logs `[setlist] hint-fetch`).
