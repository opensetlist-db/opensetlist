// node --test tests/load/vercel-logs-summary.test.mjs
//
// Fixture: the committed capture of the 500-viewer k6 run's first minute
// (results/2026-10-10/vercel-runtime-logs-19-03-k6-full.txt), whose
// numbers were counted by hand for the run report: the cold burst (rev
// 231) built 249 times on 142 instances, and 45 requests died on EMAXCONN
// (39 on /api/setlist, 6 on the SSR event page). The synthetic cases
// cover the line kinds that capture predates.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarise, toMarkdown } from "./vercel-logs-summary.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "results", "2026-10-10", "vercel-runtime-logs-19-03-k6-full.txt");

test("run #2 k6-full capture: builds per rev, instances, EMAXCONN split", () => {
  const s = summarise(fs.readFileSync(FIXTURE, "utf8"));
  const rev = (r) => s.builds.find((b) => b.rev === r);
  assert.equal(s.entries, 1946);
  assert.equal(s.buildTotal, 571);
  assert.deepEqual([rev("231").builds, rev("231").instances], [249, 142]);
  assert.deepEqual([rev("232").builds, rev("232").instances], [191, 5]);
  assert.deepEqual([rev("233").builds, rev("233").instances], [125, 32]);
  assert.equal(rev("231").maxMs, 1100);
  assert.deepEqual(s.emaxconn, { total: 45, api: 39, ssr: 6, inTypedLines: 0 });
  assert.equal(s.perMinute.length, 1);
  assert.equal(s.perMinute[0].instances, 144);
  assert.equal(s.poolBuckets.length, 0);
  assert.equal(s.other.length, 0);
  assert.match(toMarkdown(s), /\| 231 \| 249 \| 142 \|/);
});

// --follow shape, two overlapping segments (the second repeats the first
// entry), plus the server's newer line kinds and one unknown line.
const SYNTH = `### capture segment start 2026-10-10T21:00:00.000Z
Vercel CLI 63.1.2 (Node.js 24.14.0)
Streaming logs for deployment dpl_x starting from 14:00:00.00

waiting for new logs...
14:00:01.00  ℹ️  GET  ---  opensetlist-x.vercel.app     /api/setlist
-----------------------------------------------------------------------------------------------
[liveSnapshot] build event=111 locale=ja rev=10 items=23 ms=100 instance=aa
[prisma] pool total=2 idle=0 waiting=1 instance=aa

### capture segment start 2026-10-10T21:04:40.000Z
14:00:01.00  ℹ️  GET  ---  opensetlist-x.vercel.app     /api/setlist
-----------------------------------------------------------------------------------------------
[liveSnapshot] build event=111 locale=ja rev=10 items=23 ms=100 instance=aa
[prisma] pool total=2 idle=0 waiting=1 instance=aa

14:00:02.00  ℹ️  GET  ---  opensetlist-x.vercel.app     /api/setlist
-----------------------------------------------------------------------------------------------
[liveSnapshot] build-failed event=111 locale=ko ms=5000 err=DriverAdapterError:(EMAXCONN) max client connections reached instance=bb
[liveSnapshot] rev-read event=111 rev=timeout ms=1500 instance=bb
[liveSnapshot] rev-read event=111 rev=11 ms=40 instance=bb
[liveSnapshot] coalesced waiters=7 event=111 locale=ja instance=bb
[prisma] pool total=2 idle=1 waiting=0 instance=bb

14:00:03.00  ℹ️  PUT  ---  opensetlist-x.vercel.app     /api/admin/setlist-items/5
-----------------------------------------------------------------------------------------------
[liveWriter] route=update acquireMs=12 execMs=80 rev=11 ok=true instance=cc
[liveWriter] route=update acquireMs=900 execMs=- rev=- ok=false instance=cc
[setlist] slow-hit ms=1800 event=111 locale=ja instance=bb
[someNewThing] hello

14:00:12.00  ℹ️  GET  ---  opensetlist-x.vercel.app     /api/setlist
-----------------------------------------------------------------------------------------------
[prisma] pool total=1 idle=1 waiting=0 instance=bb
`;

test("follow-mode capture: overlap dedupe and the newer line kinds", () => {
  const s = summarise(SYNTH, { bucketS: 5, carryS: 5 });
  assert.equal(s.duplicates, 1);
  assert.equal(s.entries, 4);
  assert.equal(s.buildTotal, 1);
  assert.deepEqual(s.buildFailed, { total: 1, byErr: { DriverAdapterError: 1 } });
  assert.equal(s.emaxconn.total, 1);
  assert.equal(s.emaxconn.api, 1);
  assert.equal(s.emaxconn.inTypedLines, 1);
  assert.equal(s.revRead.total, 2);
  assert.equal(s.revRead.timeouts, 1);
  // These rev-read lines predate the `hint=` field.
  assert.deepEqual(s.revRead.byHint, { "—": 2 });
  assert.equal(s.hint.total, 0);
  assert.deepEqual([s.coalesced.lines, s.coalesced.waitersMax], [1, 7]);
  assert.deepEqual(s.slowHit, { total: 1, maxMs: 1800 });
  const w = s.writers.find((x) => x.route === "update");
  assert.deepEqual([w.n, w.failed, w.acquireP95, w.execP50], [2, 1, 900, 80]);
  // 14:00:00–05: aa=2 and bb=2 reported → 4. 14:00:05–10: nobody logs;
  // bb's last line is 3 s before the bucket start (carried), aa's 4 s
  // (carried) → 4. 14:00:10–15: bb reports 1; aa's last line is 9 s old
  // (> carry 5 s) → 1.
  const sums = s.poolBuckets.map((b) => [b.reported, b.carried]);
  assert.deepEqual(sums, [[4, 4], [0, 4], [1, 1]]);
  assert.equal(s.poolPeak, 4);
  assert.deepEqual(s.other, [["[someNewThing] hello", 1]]);
});

// History-mode shape with the R2 server's lines: `[setlist] hint-fetch`
// (one per hint=1 request, every verify shape plus an unknown and an
// absent one) and `rev-read … hint=<0|1>`, across two minutes.
const HINTS = `14:00:58.10  opensetlist-x.vercel.app  info   λ GET /api/setlist
[setlist] hint-fetch event=111 locale=ja minRev=12 verify=satisfied instance=aa

14:00:58.20  opensetlist-x.vercel.app  info   λ GET /api/setlist
[liveSnapshot] rev-read event=111 rev=11 ms=30 hint=1 instance=bb
[setlist] hint-fetch event=111 locale=ko minRev=12 verify=fresh=11 instance=bb

14:00:59.00  opensetlist-x.vercel.app  info   λ GET /api/setlist
[setlist] hint-fetch event=111 locale=ja minRev=12 verify=memo=11;age=420 instance=cc

14:01:00.50  opensetlist-x.vercel.app  info   λ GET /api/setlist
[liveSnapshot] rev-read event=111 rev=timeout ms=1500 hint=1 instance=dd
[setlist] hint-fetch event=111 locale=en minRev=13 verify=deferred instance=dd

14:01:01.00  opensetlist-x.vercel.app  info   λ GET /api/setlist
[liveSnapshot] rev-read event=111 rev=13 ms=25 hint=0 instance=aa
[setlist] hint-fetch event=111 locale=ja minRev=13 verify=bogus instance=aa
[setlist] hint-fetch event=111 locale=ja minRev=13 instance=aa
[setlist] hint-fetch event=111 locale=ko minRev=13 verify=error instance=aa
`;

test("hint outcomes per kind and minute; rev-read split by hint", () => {
  const s = summarise(HINTS);
  assert.equal(s.entries, 5);
  assert.equal(s.hint.total, 7);
  assert.deepEqual(s.hint.counts, { satisfied: 1, fresh: 1, memo: 1, deferred: 1, none: 0, error: 1, other: 2 });
  assert.deepEqual(
    s.hint.perMinute.map((m) => [m.minute, m.total, m.satisfied, m.fresh, m.memo, m.deferred, m.error, m.other]),
    [[14 * 60, 3, 1, 1, 1, 0, 0, 0], [14 * 60 + 1, 4, 0, 0, 0, 1, 1, 2]],
  );
  assert.equal(s.revRead.total, 3);
  assert.equal(s.revRead.timeouts, 1);
  assert.deepEqual(s.revRead.byHint, { 1: 2, 0: 1 });
  // hint-fetch lines are typed, not "other lines".
  assert.equal(s.other.length, 0);
  const md = toMarkdown(s);
  assert.match(md, /### Hint outcomes \(`\[setlist\] hint-fetch` lines: 7\)/);
  // columns: total | satisfied | fresh | memo | deferred | none | error | other
  assert.match(md, /\| 14:00 \| 3 \| 1 \| 1 \| 1 \| 0 \| 0 \| 0 \| 0 \|/);
  assert.match(md, /\| 14:01 \| 4 \| 0 \| 0 \| 0 \| 1 \| 0 \| 1 \| 2 \|/);
  assert.match(md, /by hint: hint=1 2, hint=0 1/);
});

// History-mode shape with the writer-warming lines (LIVE_WARM_ENTRIES=1).
// The warm job runs in the save request's `after()`, so its lines (and
// its builds) sit in the PUT's entry with the PUT's start time; reader
// builds of the same rev on the SAME instance (entry 2) must stay reader
// builds. Job 21 stores rev 22 for en (a later save committed before
// its build), skips ko on a build error and ja as oversize.
const WARM = `14:10:00.00  opensetlist-x.vercel.app  info     PUT /api/admin/setlist-items/5
[liveWriter] route=update acquireMs=3 execMs=50 rev=20 ok=true instance=w1
[liveWarm] start event=111 rev=20 instance=w1
[liveSnapshot] build event=111 locale=ko rev=20 items=24 ms=60 instance=w1
[liveSnapshot] build event=111 locale=ja rev=20 items=24 ms=70 instance=w1
[liveWarm] set event=111 locale=ko atLeastRev=20 rev=20 bytes=80000 buildMs=61 setMs=12 ok=true instance=w1
[liveWarm] set event=111 locale=ja atLeastRev=20 rev=20 bytes=81000 buildMs=71 setMs=15 ok=true instance=w1
[liveSnapshot] build event=111 locale=en rev=20 items=24 ms=50 instance=w1
[liveWarm] set-error event=111 locale=en atLeastRev=20 err=Error:boom
[liveWarm] set event=111 locale=en atLeastRev=20 rev=20 bytes=79000 buildMs=50 setMs=300 ok=false instance=w1
[liveWarm] done event=111 rev=20 ms=420 instance=w1

14:10:00.30  opensetlist-x.vercel.app  info   λ GET /api/setlist
[setlist] warm-lookup event=111 locale=ja minRev=20 result=miss ms=4 instance=w1
[liveSnapshot] build event=111 locale=ja rev=20 items=24 ms=80 instance=w1
[setlist] hint-fetch event=111 locale=ja minRev=20 verify=satisfied instance=w1

14:10:00.60  opensetlist-x.vercel.app  info   λ GET /api/setlist
[setlist] warm-lookup event=111 locale=ko minRev=20 result=hit ms=6 instance=r2
[setlist] hint-fetch event=111 locale=ko minRev=20 verify=satisfied instance=r2

14:10:00.70  opensetlist-x.vercel.app  info   λ GET /api/setlist
[setlist] warm-lookup event=111 locale=ja minRev=20 result=hit ms=8 instance=r3
[setlist] hint-fetch event=111 locale=ja minRev=20 verify=satisfied instance=r3

14:10:01.00  opensetlist-x.vercel.app  info   λ GET /api/setlist
[setlist] warm-lookup event=111 locale=en minRev=20 result=timeout ms=301 instance=r4
[liveSnapshot] build event=111 locale=en rev=20 items=24 ms=90 instance=r4
[setlist] hint-fetch event=111 locale=en minRev=20 verify=satisfied instance=r4

14:11:05.00  opensetlist-x.vercel.app  info     PUT /api/admin/setlist-items/6
[liveWriter] route=update acquireMs=2 execMs=40 rev=21 ok=true instance=w2
[liveWarm] start event=111 rev=21 instance=w2
[liveSnapshot] build-failed event=111 locale=ko ms=12 err=Error:x instance=w2
[liveWarm] skip event=111 locale=ko atLeastRev=21 reason=build-error rev=- bytes=- buildMs=12 instance=w2
[liveSnapshot] build event=111 locale=ja rev=21 items=24 ms=70 instance=w2
[liveWarm] skip event=111 locale=ja atLeastRev=21 reason=oversize rev=21 bytes=1200000 buildMs=71 instance=w2
[liveSnapshot] build event=111 locale=en rev=22 items=25 ms=65 instance=w2
[liveWarm] set event=111 locale=en atLeastRev=21 rev=22 bytes=82000 buildMs=66 setMs=10 ok=true instance=w2
[liveWarm] done event=111 rev=21 ms=900 instance=w2

14:11:05.40  opensetlist-x.vercel.app  info     PUT /api/admin/setlist-items/6
[liveWriter] route=update acquireMs=2 execMs=40 rev=22 ok=true instance=w3
[liveWarm] schedule-failed event=111 rev=22 err=Error:outside instance=w3

14:11:06.00  opensetlist-x.vercel.app  info   λ GET /api/setlist
[setlist] warm-lookup event=111 locale=ja minRev=21 result=stale ms=5 instance=r5
[setlist] warm-lookup event=111 locale=ja minRev=21 result=bogus ms=5 instance=r5
[liveWarm] lookup-error err=Error:down
[setlist] hint-fetch event=111 locale=ja minRev=21 verify=satisfied instance=r5
[setlist] hint-fetch event=111 locale=ja minRev=none verify=none instance=r5
`;

test("warming: jobs, warm vs reader builds, lookups per kind / minute / rev", () => {
  const s = summarise(WARM);
  const w = s.warm;
  assert.equal(s.other.length, 0, JSON.stringify(s.other));
  assert.equal(w.jobs.length, 2);
  const [j20, j21] = w.jobs;
  assert.deepEqual([j20.rev, j20.instance, j20.done.ms, j20.sets.length, j20.warmBuilds, j20.unmatched], ["20", "w1", 420, 3, 3, 0]);
  assert.deepEqual([j21.rev, j21.done.ms, j21.warmBuilds, j21.unmatched], ["21", 900, 2, 0]);
  assert.deepEqual(j21.warmBuildRevs, { 21: 1, 22: 1 });
  assert.deepEqual(w.skipsByReason, { "build-error": 1, oversize: 1 });
  assert.deepEqual([w.setNotOk, w.setErrorLines, w.jobFailed, w.lookupErrorLines], [1, 1, 0, 1]);
  assert.deepEqual(w.scheduleFailed.map((x) => [x.rev, x.err]), [["22", "Error"]]);
  // 5 hinted fetches with a numeric minRev (the `minRev=none` one is not).
  assert.equal(w.hinted, 5);
  assert.deepEqual(w.lookups.counts, { hit: 2, miss: 1, stale: 1, invalid: 0, error: 0, timeout: 1, other: 1 });
  assert.equal(w.hitRate, 2 / 5);
  assert.deepEqual(w.lookups.msByResult.hit, { n: 2, p50: 6, p95: 8 });
  assert.deepEqual(w.lookups.perMinute.map((m) => [m.minute, m.total, m.hit, m.stale]), [[14 * 60 + 10, 4, 2, 0], [14 * 60 + 11, 2, 0, 1]]);
  const rev = (r) => w.perRev.find((x) => x.rev === r);
  // rev 20: 3 warm builds on w1 + the reader builds on w1 (entry 2) and r4.
  assert.deepEqual([rev("20").builds, rev("20").warmBuilds, rev("20").readerBuilds, rev("20").hinted, rev("20").lookups], [5, 3, 2, 4, 4]);
  assert.equal(rev("20").hitRate, 0.5);
  assert.deepEqual([rev("21").builds, rev("21").warmBuilds, rev("21").readerBuilds, rev("21").results.stale, rev("21").results.other], [1, 1, 0, 1, 1]);
  // rev 22 only exists as job 21's en build — it still gets a row.
  assert.deepEqual([rev("22").builds, rev("22").warmBuilds, rev("22").readerBuilds, rev("22").jobs], [1, 1, 0, 0]);
  const md = toMarkdown(s);
  assert.match(md, /### Warming \(`\[liveWarm\]` jobs: 2; `\[setlist\] warm-lookup` lines: 6\)/);
  assert.match(md, /warm hit rate = hits ÷ hinted fetches = 2 \/ 5 = 40\.0 %/);
  // save rev | jobs | done | builds | warm | reader | hinted | lookups |
  // hit miss stale invalid error timeout other | lookup ms | hit rate
  assert.match(md, /\| 20 \| 1 \| 420 \| 5 \| 3 \| 2 \| 4 \| 4 \| 2 \| 1 \| 0 \| 0 \| 0 \| 1 \| 0 \| 6 \/ 301 \| 50\.0 % \|/);
});

// Follow mode stamps every line on its own entry: the warm build is
// matched by instance + locale + rev inside the job window, and a later
// reader build of the same rev on the same instance (outside it) is not.
const WARM_FOLLOW = `### capture segment start 2026-10-10T21:00:00.000Z
14:00:00.00  ℹ️  PUT  ---  opensetlist-x.vercel.app     /api/admin/setlist-items/5
-----------------------------------------------------------------------------------------------
[liveWarm] start event=111 rev=30 instance=w1

14:00:00.10  ℹ️  PUT  ---  opensetlist-x.vercel.app     /api/admin/setlist-items/5
-----------------------------------------------------------------------------------------------
[liveSnapshot] build event=111 locale=ja rev=30 items=24 ms=70 instance=w1

14:00:00.15  ℹ️  PUT  ---  opensetlist-x.vercel.app     /api/admin/setlist-items/5
-----------------------------------------------------------------------------------------------
[liveWarm] set event=111 locale=ja atLeastRev=30 rev=30 bytes=80000 buildMs=71 setMs=9 ok=true instance=w1

14:00:00.20  ℹ️  PUT  ---  opensetlist-x.vercel.app     /api/admin/setlist-items/5
-----------------------------------------------------------------------------------------------
[liveWarm] done event=111 rev=30 ms=200 instance=w1

14:00:09.00  ℹ️  GET  ---  opensetlist-x.vercel.app     /api/setlist
-----------------------------------------------------------------------------------------------
[liveSnapshot] build event=111 locale=ja rev=30 items=24 ms=70 instance=w1
`;

test("warming in follow mode: warm build matched by the job window; flag-off capture", () => {
  const w = summarise(WARM_FOLLOW).warm;
  assert.deepEqual([w.jobs.length, w.warmBuilds, w.unmatched], [1, 1, 0]);
  const r = w.perRev.find((x) => x.rev === "30");
  assert.deepEqual([r.builds, r.warmBuilds, r.readerBuilds], [2, 1, 1]);
  // A flag-off capture has no warming lines and says so, but still
  // prints the run-level hit-rate line (0 of the 7 hinted fetches).
  const off = summarise(HINTS);
  assert.equal(off.warm.seen, false);
  const md = toMarkdown(off);
  assert.match(md, /warm hit rate = hits ÷ hinted fetches = 0 \/ 7 = 0\.0 %/);
  assert.match(md, /No warming lines in this capture/);
});
