# JSON log export check — `vercel-logs-json.sh` (n14 step 6)

- Deployment: the dev alias's current deployment `dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5`
  (`https://opensetlist-6l87uqc8o-opensetlist-projects.vercel.app`, from
  `vercel inspect` of the alias), Vercel CLI 63.1.2, run from a git worktree
  without `.vercel/` (hence `--project opensetlist`).
- CLI facts verified on the way: the banner / progress (`Resolving deployment …`,
  `Fetching logs...`) is on STDERR, JSON Lines on STDOUT; `--since` and `--until`
  are both inclusive at ms precision; when a window holds more than `--limit`
  records the CLI returns the NEWEST ones; one record per request id (`id` = the
  `<reqid>` suffix of `X-Vercel-Id`), API requests as `source: serverless`, page
  requests as `source: serverless-middleware` (same id as the document's
  `X-Vercel-Id`); top-level `message` = the first nested `logs[]` line.

| run | window (UTC) | limit | coverage line | exit |
|---|---|---|---|---|
| 1 | 15:20:00 → 15:22:00 (2 min, a few manual reads) | 1000 | `slices=2 splits=0 saturated=0 maxPerSlice=4 hitLimit=0 records=4 raw=4 dupes=0 new=4` | 0 |
| 2 | same | 3 | `slices=4 splits=1 saturated=0 maxPerSlice=3 hitLimit=1 records=4 raw=7 dupes=3 new=4` — the saturated 60 s slice was split and re-fetched; same 4 records | 0 |
| 3 | same, merged into run 2's file (second pass) | 1000 | `records=4 raw=4 dupes=4 existing=4 new=0 enriched=0` — idempotent | 0 |
| 4 | 15:33:00 → 15:35:00 (2 min, the attribution smoke) | 1000 | `slices=2 splits=0 saturated=0 maxPerSlice=57 hitLimit=0 records=57 raw=57 dupes=0 new=57` | 0 |
| 5 | same | 20 | `slices=14 splits=6 saturated=0 maxPerSlice=20 hitLimit=6 records=57 raw=177 dupes=120 new=57` — **the same 57 ids as run 4** (set compared) | 0 |
| 6 | run 4 again into its own file (second pass) | 1000 | `records=57 raw=57 dupes=57 existing=57 new=0 enriched=0` | 0 |
| 7 | unknown deployment `dpl_doesnotexist` | 1000 | 3 attempts, CLI stderr tail printed (`Deployment not found`), `failed=1`, export flagged INCOMPLETE | 3 |

Run 5 is the point of the tool: with a limit the window overflows, a single CLI
call would have silently returned only the newest 20 of 57 records; the
recursive split recovered all 57.
