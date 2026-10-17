// node --test tests/load/spam7-join.test.mjs
//
// Synthetic fixtures for history-fetch.sh's merge logic (history-merge.mjs)
// and the step-7 join (spam7-join.mjs): history text with request records
// and nested lines, saturation, a second pass, reconciliation shortfalls,
// Σ coverage with a silent database instance, and the k6 summary.
//
// Clock: the CLI machine is at UTC−7 (`tz=-0700`), so a record stamped
// 05:00:10.00 local is 12:00:10Z. Measurement window 12:00:00Z → 12:02:00Z;
// spam 12:00:30Z → last send 12:01:30Z.
import test from "node:test";
import assert from "node:assert/strict";
import { splitEntries, countRecords, cliCount, mergeEntries, assemble, parseFetchFile } from "./history-merge.mjs";
import { join, toMarkdown, harnessView, expectedHinted, fetchCompleteness, k6View, k6ConfigFromMd, tzToAddHours, parseCsv } from "./spam7-join.mjs";

const HOST = "opensetlist-x.vercel.app";
const Z = (hms) => Date.parse(`2026-10-12T${hms}Z`);
// Local (UTC−7) header for a UTC time.
const hdr = (utcHms, method = "GET", p = "/api/setlist") => {
  const [h, m, s] = utcHms.split(":");
  const lh = String((Number(h) + 24 - 7) % 24).padStart(2, "0");
  return `${lh}:${m}:${Number(s).toFixed(2).padStart(5, "0")}  ${HOST}  info   λ ${method} ${p}`;
};
const rec = (utcHms, lines = [], method, p) => [hdr(utcHms, method, p), ...lines].join("\n");

// ─── the history: records per slice (a slice = one CLI call) ───
const S = {
  // baseline: one build on instance a.
  base: [
    rec("12:00:10.00", ["[liveSnapshot] build event=111 locale=ko rev=10 items=70 ms=50 instance=a", "[prisma] pool total=1 idle=1 waiting=0 instance=a tag=build"]),
    rec("12:00:12.00"),
  ],
  // first spam minute: hint fetches of every kind, a revision read and its
  // timeout, warm-lookup misses / a timeout, pool waiting on b.
  spam1: [
    rec("12:00:31.00", ["[setlist] hint-fetch event=111 locale=ko minRev=9007199254740991 verify=memo=10;age=200 instance=b"]),
    rec("12:00:31.10", ["[liveSnapshot] rev-read event=111 rev=10 ms=8 hint=1 instance=b", "[setlist] hint-fetch event=111 locale=ko minRev=11 verify=fresh=10 instance=b"]),
    rec("12:00:32.00", ["[liveSnapshot] rev-read event=111 rev=timeout ms=1000 hint=1 instance=b", "[setlist] hint-fetch event=111 locale=ja minRev=11 verify=deferred instance=b"]),
    rec("12:00:33.00", ["[setlist] warm-lookup event=111 locale=ko minRev=11 result=miss ms=4 instance=b", "[setlist] hint-fetch event=111 locale=ko minRev=11 verify=memo=10;age=900 instance=b"]),
    rec("12:00:34.00", ["[setlist] warm-lookup event=111 locale=ko minRev=11 result=timeout ms=150 instance=b", "[liveSnapshot] build event=111 locale=ko rev=10 items=70 ms=80 instance=b", "[prisma] pool total=4 idle=0 waiting=2 instance=b tag=build"]),
    // silent instance c: a revision read (database work) and no pool line.
    rec("12:00:35.00", ["[liveSnapshot] rev-read event=111 rev=10 ms=9 hint=1 instance=c", "[setlist] hint-fetch event=111 locale=en minRev=11 verify=fresh=10 instance=c"]),
  ],
  // the save (PUT) with its writer line and warm job; then a satisfied fetch.
  save: [
    rec("12:00:40.00", [
      `[liveWriter] route=update acquireMs=12 execMs=40 rev=11 ok=true at=${Z("12:00:40.200")} instance=w`,
      `[liveWarm] start event=111 rev=11 at=${Z("12:00:40.210")} instance=w`,
      "[liveSnapshot] build event=111 locale=ko rev=11 items=70 ms=60 instance=w",
      "[prisma] pool total=2 idle=1 waiting=0 instance=w tag=build",
      `[liveWarm] set event=111 locale=ko atLeastRev=11 rev=11 bytes=90000 buildMs=60 setMs=8 ok=true at=${Z("12:00:40.300")} instance=w`,
      `[liveWarm] done event=111 rev=11 ms=100 at=${Z("12:00:40.310")} instance=w`,
    ], "PUT", "/api/admin/setlist-items/5"),
    rec("12:00:41.00", ["[setlist] warm-lookup event=111 locale=ko minRev=11 result=hit ms=3 instance=b", "[setlist] hint-fetch event=111 locale=ko minRev=11 verify=satisfied instance=b"]),
  ],
  // last spam minute: memo answers.
  spam2: [
    rec("12:01:32.00", ["[setlist] hint-fetch event=111 locale=ko minRev=9007199254740991 verify=memo=11;age=100 instance=b"]),
    rec("12:01:34.00", ["[setlist] hint-fetch event=111 locale=ko minRev=9007199254740991 verify=memo=11;age=400 instance=b", "[prisma] pool total=3 idle=3 waiting=0 instance=b tag=build"]),
  ],
  recovery: [rec("12:01:45.00"), rec("12:01:58.00")],
};
const SLICES = [
  ["11:59:50", "12:00:20", S.base],
  ["12:00:20", "12:00:38", S.spam1],
  ["12:00:38", "12:01:00", S.save],
  ["12:01:00", "12:01:40", S.spam2],
  ["12:01:40", "12:02:10", S.recovery],
];
// A slice as the CLI prints it in text mode (everything on stderr, which
// history-fetch.sh captures together with stdout): banner, column header,
// records newest first, the closing count.
const cliText = (records) => [
  "Vercel CLI 63.1.2 (Node.js 24.14.0)",
  `Resolving deployment "${HOST}"`,
  "Fetching logs...",
  "TIME         HOST   LEVEL",
  [...records].reverse().join("\n\n"),
  records.length ? `Fetched ${records.length} logs for opensetlist-projects/opensetlist` : "No logs found for opensetlist-projects/opensetlist",
].join("\n");

function buildHistory({ secondPass = true, limit = 5000, saturateIdx = null, enrichSave = true } = {}) {
  const leaves = SLICES.map(([a, b, records], i) => ({
    fromMs: Z(a), toMs: Z(b), status: i === saturateIdx ? "saturated" : "ok", records: records.length,
    cli: records.length, file: `p1-${i}`, text: cliText(i === 2 && enrichSave ? [records[0].split("\n").slice(0, 2).join("\n"), records[1]] : records),
  }));
  const p1 = assemble({
    leaves, readLeaf: (l) => l.text, target: HOST, since: new Date(Z("11:59:50")).toISOString(),
    until: new Date(Z("12:02:10")).toISOString(), limit, tz: "-0700", now: new Date(Z("12:03:00")),
  });
  if (!secondPass) return p1.text;
  const leaves2 = SLICES.map(([a, b, records], i) => ({
    fromMs: Z(a), toMs: Z(b), status: i === saturateIdx ? "saturated" : "ok", records: records.length, cli: records.length, file: `p2-${i}`, text: cliText(records),
  }));
  return assemble({ existingText: p1.text, leaves: leaves2, readLeaf: (l) => l.text, now: new Date(Z("12:08:00")) }).text;
}

// ─── harness JSON (the shape documented in spam7-join.mjs) ───
function harness({ writes = null, hinted = null } = {}) {
  return {
    config: { label: "fixture", base: "https://x" },
    spam7: {
      phases: { baselineStart: Z("12:00:00"), spamStart: new Date(Z("12:00:30")).toISOString(), lastSend: Z("12:01:35"), recoveryEnd: Z("12:02:00") },
      sends: [{ k: 1, sentAt: Z("12:00:30") }, { k: 2, sentAt: Z("12:01:35") }],
      writes: writes ?? [
        { k: 0, kind: "anchor", rev: 10, putStart: Z("11:59:00"), putEnd: Z("11:59:00.300"), status: 200 },
        { k: 1, label: "put", rev: 11, putStart: Z("12:00:40.000"), putEnd: Z("12:00:40.400"), status: 200 },
      ],
      // Hinted requests: 9 hint-fetch lines in the window (spam1 5, save 1,
      // spam2 2, + the anchor-era none) — the harness saw 9 too.
      hintedStarts: hinted ?? [Z("12:00:31"), Z("12:00:31.1"), Z("12:00:32"), Z("12:00:33"), Z("12:00:35"), Z("12:00:41"), Z("12:01:32"), Z("12:01:34")],
      declaredProcess: { pid: 4242, command: "k6 run viewers.js" },
    },
  };
}
// The anchor (rev 10) was written before the window; the fixture has no
// writer line for it → give it one in a separate early record so the
// complete-evidence case can be built. (Its absence is a test below.)
const ANCHOR_REC = rec("11:59:55.00", [`[liveWriter] route=create acquireMs=5 execMs=30 rev=10 ok=true at=${Z("11:59:55.100")} instance=w`], "POST", "/api/admin/setlist-items");
SLICES[0][2].unshift(ANCHOR_REC);
// Anchor PUT times consistent with the line.
const H_OK = () => {
  const h = harness();
  h.spam7.writes[0].putStart = Z("11:59:55.000");
  h.spam7.writes[0].putEnd = Z("11:59:55.200");
  return h;
};

test("records are counted by header, not by line; the CLI's own count is parsed", () => {
  const t = cliText(S.spam1);
  assert.equal(countRecords(t), 6);
  assert.ok(t.split("\n").length > 12);
  assert.equal(cliCount(t), 6);
  assert.equal(cliCount(cliText([])), 0);
  assert.equal(cliCount("Vercel CLI 63\nFetching logs..."), null);
  // A header-only record is still a record; banner lines are not.
  assert.equal(splitEntries(cliText(S.recovery)).entries.length, 2);
});

test("second-pass merge: identical, enriched, new, pass-1-only", () => {
  const e = (h, ...lines) => ({ header: h, lines });
  const p1 = [e("H1", "a"), e("H1"), e("H2", "x"), e("H3", "only-in-pass-1")];
  const p2 = [e("H1", "a"), e("H1", "late-after-line"), e("H2", "x", "warm"), e("H4", "new")];
  const m = mergeEntries(p1, p2);
  assert.equal(m.identical, 1); // H1 a
  assert.equal(m.enriched, 2); // H1 (empty) ⊂ H1 late; H2 x ⊂ H2 x warm
  assert.equal(m.new, 1); // H4
  assert.equal(m.pass1Only, 1); // H3 kept
  assert.equal(m.merged.length, 5);
});

test("assemble: disjoint slices, markers, second pass enriches the save record", () => {
  const text = buildHistory();
  const f = parseFetchFile(text);
  assert.equal(f.header.passes, "2");
  assert.equal(f.header.tz, "-0700");
  assert.equal(f.slices.length, 5);
  for (let i = 1; i < f.slices.length; i++) assert.equal(f.slices[i].fromMs, f.slices[i - 1].toMs);
  const save = f.slices[2];
  assert.equal(save.enriched, "1"); // pass 1 had only the writer line of the PUT record
  assert.equal(save.identical, "1");
  assert.equal(f.coverage.enriched, "1");
  assert.equal(f.coverage.records, String(SLICES.reduce((a, s) => a + s[2].length, 0)));
  assert.match(text, /\[liveWarm\] done event=111 rev=11/);
  // Without the second pass the warm job's lines are missing.
  assert.doesNotMatch(buildHistory({ secondPass: false }), /\[liveWarm\] done/);
});

test("complete evidence: fetch complete, writers and hint fetches reconcile, gates PASS", () => {
  const j = join(H_OK(), buildHistory());
  assert.equal(j.addHours, 7);
  assert.match(j.tzSource, /tz=-0700/);
  assert.equal(j.fetch.complete, true, j.fetch.reasons.join("; "));
  assert.equal(j.reconcile.writer.status, "ok");
  assert.deepEqual([j.reconcile.writer.found, j.reconcile.writer.expected], [2, 2]);
  assert.equal(j.reconcile.hint.found, 8);
  assert.equal(j.reconcile.hint.status, "ok");
  // Instance c did a revision read without a pool line: Σ cannot see it,
  // so without the pooler side-car Σ is UNESTABLISHED, not PASS.
  assert.deepEqual(j.server.sigma.dbSilentInstances, ["c"]);
  const g = Object.fromEntries(j.verdict.gates.map((x) => [x.gate.split(" ")[0], x.verdict]));
  assert.equal(g.EMAXCONN, "PASS");
  assert.equal(g["Σ"], "UNESTABLISHED");
  assert.equal(g.writer, "PASS");
  // With a pooler CSV covering the window below the gate, Σ stands.
  const csv = ["# pooler-clients sampler", "ts,m_pgbouncer_used_clients,m_pgbouncer_pools_client_waiting_connections,backends_total,probe_result,errors"];
  for (let t = Z("11:59:58"); t <= Z("12:02:02"); t += 2000) csv.push(`${new Date(t).toISOString()},${t > Z("12:00:30") && t < Z("12:01:30") ? 40 : 12},0,9,ok,""`);
  const j2 = join(H_OK(), buildHistory(), { poolerCsv: csv.join("\n") });
  assert.equal(j2.pooler.covers, true);
  assert.equal(j2.verdict.gates.find((x) => x.gate.startsWith("Σ")).verdict, "PASS");
  assert.equal(j2.pooler.periods.find((p) => p.label.startsWith("attack (")).max["pooler used clients"], 40);
  assert.equal(j2.pooler.periods.find((p) => p.label === "baseline").max["pooler used clients"], 12);
});

test("server outcomes per minute: hint kinds, rev reads, lookups, pool waiting, warm vs reader builds", () => {
  const j = join(H_OK(), buildHistory(), { addHours: 7 });
  const w = j.server.whole;
  assert.equal(w.hintTotal, 8);
  assert.deepEqual([w.hint.memo, w.hint.fresh, w.hint.deferred, w.hint.satisfied], [4, 2, 1, 1]);
  assert.deepEqual([w.revReads, w.revReadsHint, w.revReadTimeouts], [3, 3, 1]);
  assert.deepEqual([w.lookups.miss, w.lookups.timeout, w.lookups.hit], [1, 1, 1]);
  assert.equal(w.poolWaitingMax, 2);
  // builds in the window: base a, spam b, warm w → 1 warm-job + 2 reader.
  assert.deepEqual([w.builds, w.warmBuilds, w.readerBuilds], [3, 1, 2]);
  // First vs last attack minute (12:00:30 +60 s vs 12:00:35 → 12:01:35).
  assert.equal(j.server.firstMin.hintTotal, 6);
  assert.deepEqual([j.server.lastMin.hintTotal, j.server.lastMin.hint.memo], [4, 2]);
  // Per-10 s rows start at the spam start.
  assert.equal(j.server.per10s[0].t, Z("12:00:30"));
  // Σ: baseline max 1 (instance a); peak while b holds 4.
  assert.equal(j.server.sigma.baselineMax, 1);
  assert.ok(j.server.sigma.peak.carried >= 4);
  // The last pool line (12:01:34) precedes the last send: Σ after it is 0
  // by construction, and the join says so instead of calling it a drain.
  assert.equal(j.server.sigma.drain.noPoolLinesAfter, true);
});

test("writer shortfall: a 2xx write without its line → acquire and Σ/EMAXCONN UNESTABLISHED", () => {
  const h = H_OK();
  h.spam7.writes.push({ k: 2, label: "pair", rev: 12, putStart: Z("12:01:00"), putEnd: Z("12:01:00.300"), status: 200 });
  const j = join(h, buildHistory());
  assert.equal(j.reconcile.writer.status, "shortfall");
  assert.deepEqual(j.reconcile.writer.missing, [12]);
  const g = Object.fromEntries(j.verdict.gates.map((x) => [x.gate.split(" ")[0], x]));
  assert.equal(g.writer.verdict, "UNESTABLISHED");
  assert.match(g.writer.why, /rev 12/);
  assert.equal(g.EMAXCONN.verdict, "UNESTABLISHED");
  assert.equal(j.verdict.complete, false);
});

test("hint-fetch reconciliation: shortfall beyond the padding, excess flagged, padding absorbs edges", () => {
  const h = H_OK();
  // The harness says 12 hinted requests inside the window, the log has 8.
  h.spam7.hintedStarts = [...h.spam7.hintedStarts, Z("12:00:50"), Z("12:00:51"), Z("12:00:52"), Z("12:00:53")];
  const j = join(h, buildHistory());
  assert.equal(j.reconcile.hint.status, "shortfall");
  assert.equal(j.verdict.gates.find((x) => x.gate === "EMAXCONN").verdict, "UNESTABLISHED");
  // Requests within 5 s of the window edges count only toward the upper
  // bound: one at 11:59:58 and one at 12:02:03 widen hi, not lo.
  const hv = harnessView(H_OK());
  hv.hintedStarts = [Z("11:59:58"), Z("12:00:30"), Z("12:02:03")];
  assert.deepEqual(expectedHinted(hv, { from: hv.window.from, to: hv.window.to }), { lo: 1, hi: 3, source: "hintedStarts" });
  // Bucket form: sdkNotification + pages total widening the upper bound.
  const hb = harnessView({ spam7: { phases: { baselineStart: Z("12:00:00"), recoveryEnd: Z("12:02:00") }, buckets: [
    { t: Z("12:00:10"), sdkNotification: 3, pages: 2 },
    { s: 60, sdkNotification: 4, pagesHinted: 1, pages: 2 },
    { t: Z("12:01:58"), sdkNotification: 5 },
  ] } });
  assert.deepEqual(expectedHinted(hb, { from: hb.window.from, to: hb.window.to }), { lo: 8, hi: 15, source: "buckets" });
  // Excess: the harness saw fewer than the log holds.
  const h2 = H_OK();
  h2.spam7.hintedStarts = h2.spam7.hintedStarts.slice(0, 3);
  assert.equal(join(h2, buildHistory()).reconcile.hint.status, "excess");
});

test("saturation, missing second pass, unknown fetch metadata → incomplete with reasons", () => {
  const sat = join(H_OK(), buildHistory({ saturateIdx: 1 }));
  assert.equal(sat.fetch.complete, false);
  assert.ok(sat.fetch.reasons.some((r) => /saturated/.test(r)));
  // A slice at the limit counts as saturated even if its marker says ok.
  const atLimit = fetchCompleteness(buildHistory({ limit: 6 }), { from: Z("12:00:00"), to: Z("12:02:00") });
  assert.equal(atLimit.coverage.saturated, 1); // spam1 has exactly 6 records
  const one = join(H_OK(), buildHistory({ secondPass: false }));
  assert.ok(one.fetch.reasons.some((r) => /no second pass/.test(r)));
  assert.equal(one.verdict.gates.find((x) => x.gate.startsWith("Σ")).verdict, "UNESTABLISHED");
  // A bare concatenation (no markers): unknown, and the default clock is
  // UTC with a warning.
  const bare = SLICES.map(([, , r]) => cliText(r)).join("\n");
  const j = join(H_OK(), bare, { addHours: 7 });
  assert.equal(j.fetch.known, false);
  assert.equal(j.verdict.complete, false);
  assert.equal(join(H_OK(), bare).tzSource.startsWith("none"), true);
});

test("positive evidence fails a gate even when the evidence is incomplete", () => {
  const h = H_OK();
  const text = buildHistory({ secondPass: false })
    .replace("acquireMs=12 execMs=40 rev=11", "acquireMs=650 execMs=40 rev=11")
    .replace("[setlist] hint-fetch event=111 locale=ko minRev=11 verify=satisfied instance=b", "[setlist] hint-fetch event=111 locale=ko minRev=11 verify=satisfied instance=b\nError: EMAXCONN max client connections reached instance=b");
  const j = join(h, text);
  const g = Object.fromEntries(j.verdict.gates.map((x) => [x.gate.split(" ")[0], x.verdict]));
  assert.equal(g.writer, "FAIL");
  assert.equal(g.EMAXCONN, "FAIL");
});

test("k6: zero-count 5xx evidence from http_req_failed, achieved rates, dropped iterations", () => {
  const md = "- cold start: off; steady 0s → 420s (poll 1 rps + SSR 2.5 rps)\n- reactions: 500 POST+DELETE over 10s @195s\nBASE_URL=x HINT_MODE=r2\n";
  assert.deepEqual(k6ConfigFromMd(md), { steadyS: 420, pollRps: 1, ssrRps: 2.5, reactions: 500, reactionSeconds: 10, reactionAt: 195, hintMode: "r2" });
  const c = (n) => ({ type: "counter", values: { count: n } });
  const k6 = {
    setup: { startRev: 10 },
    metrics: {
      http_reqs: c(2000), http_req_failed: { type: "rate", values: { passes: 0, fails: 2000, rate: 0 } },
      "http_reqs{scenario:poll}": c(420), "http_reqs{scenario:ssr}": c(1040),
      "reaction_latency{op:post}": { type: "trend", values: { count: 500, "p(95)": 210 } },
      "reaction_latency{op:delete}": { type: "trend", values: { count: 500, "p(95)": 190 } },
      "dropped_iterations{scenario:poll}": c(0), "dropped_iterations{scenario:ssr}": c(0), "dropped_iterations{scenario:reactions}": c(0),
      "http_req_duration{scenario:ssr}": { type: "trend", values: { count: 1040, "p(95)": 900 } },
      // A tolerated error RATE threshold must not be read as evidence: the
      // join reads passes (bad count) only.
      snapshot_errors: { type: "rate", values: { passes: 0, fails: 420, rate: 0 }, thresholds: { "rate<=0.01": { ok: true } } },
    },
  };
  const v = k6View(k6, { md });
  assert.deepEqual([v.fivexx.count, v.fivexx.established], [0, true]);
  // SSR 1040 / 420 s = 2.48 rps (99 %), poll 100 %, 500 pairs, 0 dropped.
  assert.ok(v.achieved.ssr.ratio > 0.95 && v.achieved.poll.ratio >= 1 && v.achieved.reactions.ratio === 1);
  assert.equal(v.generator, "OK");
  assert.equal(v.p95.ssr, 900);
  // Dropped iterations → SHORT; failed requests → 5xx unestablished (the
  // JSON has no status codes), with the per-stream bad counts kept.
  const k2 = structuredClone(k6);
  k2.metrics["dropped_iterations{scenario:ssr}"] = c(3);
  k2.metrics.http_req_failed.values = { passes: 2, fails: 1998, rate: 0.001 };
  k2.metrics.snapshot_errors.values = { passes: 2, fails: 418, rate: 0.0048 };
  const v2 = k6View(k2, { md });
  assert.equal(v2.generator, "SHORT");
  assert.deepEqual([v2.fivexx.count, v2.fivexx.established], [null, false]);
  assert.equal(v2.streams.snapshot.bad, 2);
  // A status-tagged submetric, when present, is counted by code.
  const k3 = structuredClone(k2);
  k3.metrics["http_reqs{status:503}"] = c(2);
  k3.metrics["http_reqs{scenario:poll,status:200}"] = c(418);
  const v3 = k6View(k3, { md });
  assert.deepEqual(v3.byStatus, { 503: 2, 200: 418 });
  assert.deepEqual([v3.fivexx.count, v3.fivexx.established], [2, true]);
  // No configuration at all → generator unknown, never OK.
  assert.match(k6View(k6).generator, /^unknown/);
});

test("markdown carries the verdicts, the completeness reasons and the expiry caveat", () => {
  const h = H_OK();
  h.spam7.writes.push({ k: 2, rev: 12, putStart: Z("12:01:00"), putEnd: Z("12:01:00.300"), status: 200 });
  const md = toMarkdown(join(h, buildHistory({ secondPass: false })), { source: "fixture" });
  assert.match(md, /\*\*UNESTABLISHED\*\*/);
  assert.match(md, /no second pass/);
  assert.match(md, /silent instances expire by construction/);
  assert.match(md, /\*\*2 \/ 3\*\* \(shortfall\); missing rev 12/);
  assert.match(md, /no instance logged a pool line/);
  assert.match(md, /no line/);
});

test("helpers: tz → add-hours, CSV with quoted fields", () => {
  assert.equal(tzToAddHours("-0700"), 7);
  assert.equal(tzToAddHours("+0900"), -9);
  assert.equal(tzToAddHours("x"), null);
  const rows = parseCsv('# c\nts,a,waits\n2026-10-12T12:00:00Z,1,"Client:ClientRead, Lock"\n');
  assert.deepEqual(rows, [{ ts: "2026-10-12T12:00:00Z", a: "1", waits: "Client:ClientRead, Lock" }]);
});
