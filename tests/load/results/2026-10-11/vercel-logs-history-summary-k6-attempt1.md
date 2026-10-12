## Vercel runtime logs — 2026-10-11T03-54-40Z-vercel-logs-history-k6.txt

611 entries; requests: /api/setlist 608, other API 3, pages 0; error-level entries 0. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 222)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 510 | 2 | 1 | ja 2 | 53 / 55 | 03:55:32 – 03:55:34 |
| 511 | 220 | 189 | ja 140, ko 48, en 32 | 1119 / 1880 | 03:55:35 – 03:55:36 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 246 | API 246, SSR 0 (246 inside build-failed / writer lines) |
| `[liveSnapshot] build-failed` | 246 | g 246 |
| `[liveSnapshot] rev-read` (repair revision read) | 0 | rev=timeout 0, rev=error 0; ms p50 — / max —; by hint: — |
| `[liveSnapshot] coalesced` | 29 | waiters sum 64, max 3 |
| `[setlist] slow-hit` | 0 | max — ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 399)

Whole capture: satisfied 211, fresh 0, memo 0, deferred 0, none 0, error 188, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 03:55 | 399 | 211 | 0 | 0 | 0 | 0 | 188 | 0 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-delete | 1 | 3 / 3 | 25 / 25 | 0 | — |
| admin-create | 1 | 3 / 3 | 52 / 52 | 0 | — |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 03:55 | 611 | 479 | 222 | 246 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **199** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 03:55:30 | 1 | 1 | 1 | 1 | 0 |
| 03:55:35 | 189 | 199 | 189 | 199 | 0 |

### Other lines

| kind | count |
|---|---|
| untagged: No logs found for opensetlist-projects/opensetlist | 7 |
