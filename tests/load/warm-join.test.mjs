// node --test tests/load/warm-join.test.mjs
//
// One save (rev 20) whose warm job ran ko / ja / en on 2 workers in a
// history-mode log (every line stamped with the PUT's start), plus a
// browsers-JSON `warm` section with the first hinted fetches.
import test from "node:test";
import assert from "node:assert/strict";
import { join, localeOffsets, toMarkdown } from "./warm-join.mjs";

const LOG = `14:10:00.00  opensetlist-x.vercel.app  info     PUT /api/admin/setlist-items/5
[liveWriter] route=update acquireMs=3 execMs=50 rev=20 ok=true instance=w1
[liveWarm] start event=111 rev=20 instance=w1
[liveSnapshot] build event=111 locale=ko rev=20 items=24 ms=100 instance=w1
[liveSnapshot] build event=111 locale=ja rev=20 items=24 ms=120 instance=w1
[liveWarm] set event=111 locale=ko atLeastRev=20 rev=20 bytes=80000 buildMs=100 setMs=10 ok=true instance=w1
[liveWarm] set event=111 locale=ja atLeastRev=20 rev=20 bytes=81000 buildMs=120 setMs=10 ok=true instance=w1
[liveSnapshot] build event=111 locale=en rev=20 items=24 ms=90 instance=w1
[liveWarm] set event=111 locale=en atLeastRev=20 rev=20 bytes=79000 buildMs=90 setMs=20 ok=true instance=w1
[liveWarm] done event=111 rev=20 ms=260 instance=w1

14:10:00.40  opensetlist-x.vercel.app  info   λ GET /api/setlist
[setlist] warm-lookup event=111 locale=ko minRev=20 result=hit ms=6 instance=r2
[setlist] hint-fetch event=111 locale=ko minRev=20 verify=satisfied instance=r2
`;

const putStart = Date.UTC(2026, 9, 11, 14, 10, 0, 300);
const JSON_IN = {
  warm: {
    saves: [{
      k: 1, rev: 20, putStart, putMs: 200, putEnd: putStart + 200, putEndIso: new Date(putStart + 200).toISOString(),
      // [idx, locale, send − commit, end − commit, source, verify, minRev]
      sdk: [
        [0, "ko", 50, 80, "build", "satisfied", 20],
        [1, "ko", 200, 210, "warm", "satisfied", 20],
        [2, "ja", 300, 305, "warm", "satisfied", 20],
        [3, "en", 100, 400, "build", "satisfied", 20],
        [4, "en", 150, 300, "build", "satisfied", 21],
      ],
      pages: [[0, "ja", 140, 160, "cache", "satisfied", 20]],
    }],
  },
};

test("rebuilt per-locale offsets: 2 workers over ko, ja, en", () => {
  const j = join(JSON_IN, LOG);
  const s = j.saves[0];
  assert.equal(s.how, "rebuilt");
  // ko 0→110 (w0), ja 0→130 (w1), en 110→220 (w0); done 260 → 40 unaccounted.
  assert.deepEqual(s.rows.map((r) => [r.locale, r.complete]), [["ko", 110], ["ja", 130], ["en", 220]]);
  assert.equal(s.unaccounted, 40);
  // A job with nothing logged yet still yields an (empty) offset set.
  assert.deepEqual(localeOffsets({ sets: [], skips: [], start: null, done: null }), { offsets: {}, how: "rebuilt", unaccounted: null });
  // Sanity column: log writer entry 14:10:00.00 vs harness PUT start 14:10:00.300.
  assert.equal(s.skewMs, -300);
  assert.deepEqual(s.logLookups, { lookups: 1, hits: 1, hinted: 1, reader: 0, warm: 3 });
});

test("arrivals split at warm-complete; other minRev kept apart", () => {
  const j = join(JSON_IN, LOG);
  // ko: 50 before (miss), 200 after (hit); ja: 300 after (hit); en: 100
  // before (miss), and one with minRev 21 (another key).
  assert.deepEqual(j.sdk, { n: 5, after: 2, afterHits: 2, before: 2, beforeHits: 0, hits: 2, otherKey: 1 });
  assert.deepEqual(j.pages, { n: 1, after: 1, afterHits: 0, before: 0, beforeHits: 0, hits: 0, otherKey: 0 });
  const md = toMarkdown(j);
  assert.match(md, /\*\*SDK\*\*: first hinted fetches 5; arrived after warm-complete 2\/4 \(50 %\); hit rate after 2\/2 \(100 %\), before 0\/2 \(0 %\)/);
  assert.match(md, /\| ko \| stored \| 110 \|/);
});

test("flag off: no warm job → every hinted fetch is 'before', no entry", () => {
  const j = join(JSON_IN, LOG.split("\n").filter((l) => !l.startsWith("[liveWarm]")).join("\n"));
  assert.equal(j.jobsInLogs, 0);
  assert.equal(j.saves[0].job, null);
  assert.deepEqual([j.sdk.after, j.sdk.before], [0, 4]);
  assert.match(toMarkdown(j), /none in the logs/);
});
