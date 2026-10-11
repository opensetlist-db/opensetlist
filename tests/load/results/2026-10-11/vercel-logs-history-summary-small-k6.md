## Vercel runtime logs — 2026-10-11T05-35-20Z-vercel-logs-history-small-k6.txt

610 entries; requests: /api/setlist 607, other API 3, pages 0; error-level entries 0. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 423)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 695 | 2 | 1 | ja 2 | 58 / 69 | 05:35:39 – 05:35:40 |
| 696 | 421 | 389 | ja 325, ko 66, en 30 | 1682 / 3036 | 05:35:42 – 05:35:43 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 74 | API 74, SSR 0 (74 inside build-failed / writer lines) |
| `[liveSnapshot] build-failed` | 74 | PrismaClientKnownRequestError 74 |
| `[liveSnapshot] rev-read` (repair revision read) | 0 | rev=timeout 0, rev=error 0; ms p50 — / max —; by hint: — |
| `[liveSnapshot] coalesced` | 26 | waiters sum 65, max 6 |
| `[setlist] slow-hit` | 0 | max — ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 400)

Whole capture: satisfied 366, fresh 0, memo 0, deferred 0, none 0, error 34, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 05:35 | 400 | 366 | 0 | 0 | 0 | 0 | 34 | 0 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-delete | 1 | 3 / 3 | 25 / 25 | 0 | — |
| admin-create | 1 | 4 / 4 | 126 / 126 | 0 | — |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 05:35 | 610 | 489 | 423 | 74 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **400** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 05:35:35 | 1 | 1 | 1 | 1 | 0 |
| 05:35:40 | 389 | 400 | 389 | 400 | 0 |

### Other lines

| kind | count |
|---|---|
| untagged: No logs found for opensetlist-projects/opensetlist | 10 |
