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
`;

test("hint outcomes per kind and minute; rev-read split by hint", () => {
  const s = summarise(HINTS);
  assert.equal(s.entries, 5);
  assert.equal(s.hint.total, 6);
  assert.deepEqual(s.hint.counts, { satisfied: 1, fresh: 1, memo: 1, deferred: 1, none: 0, other: 2 });
  assert.deepEqual(
    s.hint.perMinute.map((m) => [m.minute, m.total, m.satisfied, m.fresh, m.memo, m.deferred, m.other]),
    [[14 * 60, 3, 1, 1, 1, 0, 0], [14 * 60 + 1, 3, 0, 0, 0, 1, 2]],
  );
  assert.equal(s.revRead.total, 3);
  assert.equal(s.revRead.timeouts, 1);
  assert.deepEqual(s.revRead.byHint, { 1: 2, 0: 1 });
  // hint-fetch lines are typed, not "other lines".
  assert.equal(s.other.length, 0);
  const md = toMarkdown(s);
  assert.match(md, /### Hint outcomes \(`\[setlist\] hint-fetch` lines: 6\)/);
  assert.match(md, /\| 14:00 \| 3 \| 1 \| 1 \| 1 \| 0 \| 0 \| 0 \|/);
  assert.match(md, /\| 14:01 \| 3 \| 0 \| 0 \| 0 \| 1 \| 0 \| 2 \|/);
  assert.match(md, /by hint: hint=1 2, hint=0 1/);
});
