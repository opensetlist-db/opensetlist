// Synthetic fixtures for transition-join.mjs: one switch ON (dpl_OLD) →
// OFF (dpl_NEW), with a 1/s probe, natural hinted SDK fetches spanning
// the switch, a hold subset answered by the old deployment after the
// cutover, one save and per-deployment JSON log records in the shape
// `vercel logs --json` emits.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeLogRecords, reqIdOf, parseJsonl, attribute, harnessResponses, attributionSummary,
  propagation, resolveSwitches, exposure, roleEvidence, join, toMarkdown, recordsToHistoryText,
  linesOf, roleKind, staleFirstAnswers, r1Cohort, continuity, arrivalExposure,
} from "./transition-join.mjs";

const T0 = Date.UTC(2026, 9, 12, 10, 0, 0); // cliStart
const OLD = "dpl_OLD";
const NEW = "dpl_NEW";
const manifest = { deployments: [
  { id: OLD, role: "ON-A", url: "https://old-x.vercel.app", env: { LIVE_WARM_ENTRIES: "1" } },
  { id: NEW, role: "OFF-1", url: "https://new-y.vercel.app", env: { LIVE_WARM_ENTRIES: "0" } },
] };

const rec = (id, ts, dep, path, status, msgs = [], method = "GET") => ({
  id, timestamp: ts, deploymentId: dep, projectId: "prj", level: "info", message: msgs[0] ?? "", source: "serverless",
  domain: "alias.vercel.app", requestMethod: method, requestPath: path, responseStatusCode: status, logs: msgs.map((m) => ({ level: "info", message: m })),
});

function fixture({ dropProbeLog = false, writerLine = true, warmStart = false } = {}) {
  const probe = [];
  const logs = { [OLD]: [], [NEW]: [] };
  for (let i = -20; i <= 70; i++) {
    const t = T0 + i * 1000;
    const dep = t < T0 + 1500 ? OLD : NEW;
    const id = `prb${i + 100}-1-a`;
    probe.push({ tStart: t, tEnd: t + 120, status: 200, vercelId: `sfo1::icn1::${id}`, path: "/api/setlist?eventId=111&locale=ko&minRev=5&hint=1", notify: true, rev: 10, source: "cache", verify: "satisfied", client: "probe" });
    if (dropProbeLog && i === 3) continue;
    logs[dep].push(rec(id, t + 30, dep, "/api/setlist", 200, [`[setlist] hint-fetch event=111 locale=ko minRev=5 verify=satisfied instance=${dep}i`]));
  }
  // 25 natural hinted SDK fetches dispatched before cliStart, settled after the first target response.
  const sdk = [];
  for (let c = 0; c < 25; c++) {
    const id = `sdk${c}-1-b`;
    sdk.push({ client: c, tStart: T0 - 500, tEnd: T0 + 2500, settledAt: T0 + 3000, status: 200, vercelId: `sfo1::icn1::${id}`, path: "/api/setlist?eventId=111&locale=ko&minRev=9&hint=1", notify: true, rev: 10 });
    logs[OLD].push(rec(id, T0 - 470, OLD, "/api/setlist", 200, ["[setlist] hint-fetch event=111 locale=ko minRev=9 verify=satisfied instance=x"]));
  }
  // Hold subset: old answer completes after the cutover, follow-up from the target converges.
  for (let c = 100; c < 106; c++) {
    const a = `hold${c}-1-c`, b = `hold${c}-2-c`;
    sdk.push({ client: c, subset: "hold", tStart: T0 - 200, tEnd: T0 + 4000, status: 200, vercelId: a, path: "/api/setlist?eventId=111&locale=ko", rev: 10 });
    sdk.push({ client: c, subset: "hold", tStart: T0 + 5000, tEnd: T0 + 5200, status: 200, vercelId: b, path: "/api/setlist?eventId=111&locale=ko", rev: 11, source: "build" });
    logs[OLD].push(rec(a, T0 - 180, OLD, "/api/setlist", 200));
    logs[NEW].push(rec(b, T0 + 5020, NEW, "/api/setlist", 200));
  }
  // One unmatched SDK response, one with a status mismatch.
  sdk.push({ client: 200, tStart: T0 + 8000, tEnd: T0 + 8100, status: 200, vercelId: "sfo1::icn1::ghost-1-d", path: "/api/setlist?eventId=111&locale=ko" });
  sdk.push({ client: 201, tStart: T0 + 9000, tEnd: T0 + 9100, status: 200, vercelId: "mism-1-d", path: "/api/setlist?eventId=111&locale=ko" });
  logs[NEW].push(rec("mism-1-d", T0 + 9020, NEW, "/api/setlist", 503));
  const saveMsgs = [writerLine ? "[liveWriter] route=setlist-item-put acquireMs=3 execMs=20 rev=11 ok=true at=1 instance=w" : "[prisma] pool total=1 idle=1 waiting=0 instance=w"];
  if (warmStart) saveMsgs.push("[liveWarm] start event=111 rev=11 at=1 instance=w");
  const saves = [
    { k: 1, rev: 11, status: 200, putStart: T0 + 3000, putEnd: T0 + 3300, method: "PUT", path: "/api/admin/setlist-items/5", vercelId: "save1-1-e", leg: 0 },
  ];
  logs[NEW].push(rec("save1-1-e", T0 + 3010, NEW, "/api/admin/setlist-items/5", 200, saveMsgs, "PUT"));
  for (const k of Object.keys(logs)) logs[k].sort((a, b) => a.timestamp - b.timestamp);
  const json = { config: { label: "fixture", base: "https://alias.vercel.app" }, transition: {
    switches: [{ name: "ON-A → OFF-1", kind: "off", plannedAt: T0, cliStart: T0, cliEnd: T0 + 2000, cliCpuMs: 900, target: { url: "https://new-y.vercel.app", id: NEW }, from: { id: OLD } }],
    saves, probe: { reqs: probe }, sdk: { reqs: sdk },
  } };
  return { json, logsByDep: new Map(Object.entries(logs)) };
}

test("reqIdOf takes the suffix of X-Vercel-Id and passes a bare id", () => {
  assert.equal(reqIdOf("sfo1::icn1::pzvwd-1791817116374-440956450699"), "pzvwd-1791817116374-440956450699");
  assert.equal(reqIdOf("abc-1-2"), "abc-1-2");
  assert.equal(reqIdOf(null), null);
  assert.equal(reqIdOf(""), null);
});

test("mergeLogRecords dedupes by id, keeps the copy with more logs[], counts new / enriched", () => {
  const a = rec("x", 2, OLD, "/p", 200, ["one"]);
  const aMore = rec("x", 2, OLD, "/p", 200, ["one", "[liveWarm] done"]);
  const b = rec("y", 1, OLD, "/p", 200);
  const first = mergeLogRecords([], [a, b, a]);
  assert.equal(first.records.length, 2);
  assert.equal(first.dupes, 1);
  assert.equal(first.added, 2);
  assert.deepEqual(first.records.map((r) => r.id), ["y", "x"], "sorted by timestamp");
  const second = mergeLogRecords(first.records, [aMore, b]);
  assert.equal(second.records.length, 2);
  assert.equal(second.added, 0);
  assert.equal(second.enriched, 1);
  assert.equal(second.records.find((r) => r.id === "x").logs.length, 2);
  // An older, shorter copy never replaces the enriched one.
  const third = mergeLogRecords(second.records, [a]);
  assert.equal(third.records.find((r) => r.id === "x").logs.length, 2);
  assert.equal(third.enriched, 0);
});

test("parseJsonl skips banner and partial lines", () => {
  const txt = 'Fetching logs...\n{"id":"a","timestamp":1}\n{"id":"b",\n\n{"id":"c","timestamp":3}\n';
  assert.deepEqual(parseJsonl(txt).map((r) => r.id), ["a", "c"]);
});

test("attribution: matched, unmatched and inconsistent responses; instrumentation separate", () => {
  const { json, logsByDep } = fixture({ writerLine: false });
  const rows = attribute(harnessResponses(json), logsByDep, { manifest });
  const ghost = rows.find((r) => r.reqId === "ghost-1-d");
  assert.equal(ghost.attr.matched, false);
  assert.match(ghost.attr.mismatch.join(), /no log record/);
  const mism = rows.find((r) => r.reqId === "mism-1-d");
  assert.equal(mism.attr.matched, true);
  assert.equal(mism.attr.consistent, false);
  assert.match(mism.attr.mismatch.join(), /status 503/);
  const save = rows.find((r) => r.pop === "save");
  assert.equal(save.attr.consistent, true, "request attribution holds");
  assert.equal(save.attr.instrumented, false, "but the writer line is missing");
  const all = attributionSummary(rows).find((g) => g.key === "ALL");
  assert.equal(all.n, rows.length);
  assert.equal(all.unmatched, 1);
  assert.equal(all.inconsistent, 1);
  const probe = attributionSummary(rows).find((g) => g.key === "probe");
  assert.equal(probe.consistent, probe.n);
  assert.equal(probe.instrExpected, probe.n, "hinted reads on R2 deployments expect hint-fetch");
  assert.equal(probe.instrumented, probe.n);
});

test("array rows with a section-level cols list are read", () => {
  const json = { transition: { sdk: { cols: ["tStart", "tEnd", "status", "xVercelId", "path"], reqs: [[1, 2, 200, "a::b::zz-1", "/api/setlist?x=1&hint=1"]] } } };
  const [r] = harnessResponses(json);
  assert.equal(r.reqId, "zz-1");
  assert.equal(r.notify, true, "hint=1 from the query when no notify field");
  assert.equal(r.path, "/api/setlist");
});

test("propagation: bounds, sustained routing, NOT EXERCISED on one unattributed defining probe", () => {
  const { json, logsByDep } = fixture();
  const rows = attribute(harnessResponses(json), logsByDep, { manifest });
  const [sw] = resolveSwitches(json.transition.switches, { manifest });
  const p = propagation(sw, rows);
  assert.equal(p.status, "EXERCISED");
  assert.equal(p.per.probe.firstTarget.tStart, T0 + 2000);
  assert.equal(p.per.probe.lastOldStart, T0 + 1000);
  assert.equal(p.per.probe.lastOldEnd, T0 + 1120);
  assert.equal(p.sustained.ok, true);
  assert.equal(p.sustained.flipBacks, 0);
  // all populations: the hold subset's old answers complete at +4 s.
  assert.equal(p.per.all.lastOldEnd, T0 + 4000);
  assert.equal(p.firstTargetT, T0 + 2120);

  const f2 = fixture({ dropProbeLog: true });
  const rows2 = attribute(harnessResponses(f2.json), f2.logsByDep, { manifest });
  const p2 = propagation(resolveSwitches(f2.json.transition.switches, { manifest })[0], rows2);
  assert.equal(p2.status, "NOT EXERCISED");
  assert.equal(p2.unattributed.length, 1);
});

test("propagation: a flip-back to the old deployment breaks sustained routing", () => {
  const { json, logsByDep } = fixture();
  // Re-attribute probe +30 s to the old deployment.
  const recs = logsByDep.get(NEW);
  const i = recs.findIndex((r) => r.id === "prb130-1-a");
  const moved = { ...recs[i], deploymentId: OLD };
  recs.splice(i, 1);
  logsByDep.get(OLD).push(moved);
  const rows = attribute(harnessResponses(json), logsByDep, { manifest });
  const p = propagation(resolveSwitches(json.transition.switches, { manifest })[0], rows);
  assert.equal(p.sustained.flipBacks, 1);
  assert.equal(p.sustained.ok, false);
  assert.equal(p.per.probe.lastOldStart, T0 + 30_000);
});

test("exposure: pending hinted fetches, old answers after cutover, rechecks", () => {
  const { json, logsByDep } = fixture();
  const rows = attribute(harnessResponses(json), logsByDep, { manifest });
  const [sw] = resolveSwitches(json.transition.switches, { manifest });
  const p = propagation(sw, rows);
  const e = exposure(sw, p, rows, {
    rechecks: [
      ...[1, 2, 3].map((c) => ({ client: c, queuedAt: T0 - 800, dispatchedAt: T0 + 2500, settledAt: T0 + 2700 })),
      ...[4, 5].map((c) => ({ client: c, queuedAt: T0 - 900, dispatchedAt: T0 - 100, settledAt: T0 + 2600 })),
      { client: 6, queuedAt: T0 + 100, dispatchedAt: T0 + 1200, settledAt: T0 + 2600 }, // queued after cliStart: not spanning
    ],
  });
  assert.equal(e.pendingHinted.clients, 25);
  assert.equal(e.pendingHinted.exercised, true);
  assert.equal(e.pendingHinted.oldAttributed, 25);
  assert.equal(e.pendingHinted.stagesAfterT.settled, 25);
  assert.equal(e.pendingRecheck.clients, 5);
  assert.equal(e.pendingRecheck.queued, 3);
  assert.equal(e.pendingRecheck.dispatched, 2);
  assert.equal(e.pendingRecheck.exercised, true);
  assert.equal(e.oldAfterCutover.converged, 6);
  assert.equal(e.oldAfterCutover.controlled, 6);
  assert.equal(e.oldAfterCutover.exercised, true);
  // With client records showing a regression, those clients do not count.
  const e2 = exposure(sw, p, rows, { clients: [{ idx: 100, appliedAll: [[1, 11], [2, 10]] }] });
  assert.equal(e2.oldAfterCutover.converged, 5);
  assert.equal(e2.oldAfterCutover.exercised, true);
});

test("OFF evidence: complete → PASS; missing writer line → NOT EXERCISED; a warm job → FAIL", () => {
  const legOf = () => ({ legFrom: T0 - 35_000, legTo: Infinity });
  const run = (opts) => {
    const { json, logsByDep } = fixture(opts);
    const rows = attribute(harnessResponses(json), logsByDep, { manifest });
    const [sw] = resolveSwitches(json.transition.switches, { manifest });
    return roleEvidence(sw, rows, logsByDep.get(NEW), manifest, legOf());
  };
  const ok = run({});
  assert.equal(ok.kind, "OFF");
  assert.equal(ok.status, "PASS", JSON.stringify(ok));
  assert.equal(ok.savesWithWriterLine, 1);
  const noWriter = run({ writerLine: false });
  assert.equal(noWriter.status, "NOT EXERCISED");
  assert.match(noWriter.missing.join(), /writer-log coverage/);
  const warm = run({ warmStart: true });
  assert.equal(warm.status, "FAIL");
  assert.equal(warm.warmStart, 1);
  // Without the manifest env the absence claim is not exercised either.
  const { json, logsByDep } = fixture();
  const man2 = { deployments: [manifest.deployments[0], { id: NEW, role: "OFF-1" }] };
  const rows = attribute(harnessResponses(json), logsByDep, { manifest: man2 });
  const [sw] = resolveSwitches(json.transition.switches, { manifest: man2 });
  assert.equal(roleEvidence(sw, rows, logsByDep.get(NEW), man2, legOf()).status, "NOT EXERCISED");
});

test("R1 evidence: a verify header on an R1-served response fails the claim", () => {
  const { json, logsByDep } = fixture();
  const manR1 = { deployments: [manifest.deployments[0], { id: NEW, role: "R1-1", commit: "385e5f0" }] };
  const rows = attribute(harnessResponses(json), logsByDep, { manifest: manR1 });
  const [sw] = resolveSwitches(json.transition.switches, { manifest: manR1 });
  const r = roleEvidence(sw, rows, logsByDep.get(NEW), manR1, { legFrom: T0 - 35_000, legTo: Infinity });
  assert.equal(r.kind, "R1");
  assert.equal(r.status, "FAIL", "probe responses on the R1 deployment carry verify=satisfied");
  assert.ok(r.verifyResponses > 0);
  assert.equal(roleKind({ role: "ON-B" }), "ON");
  assert.equal(roleKind({ role: "x", effectiveFlag: "0" }), "OFF");
  assert.equal(roleKind(null), "unknown");
});

test("stale first answers on a return compare against the committed head", () => {
  const { json, logsByDep } = fixture();
  const rows = attribute(harnessResponses(json), logsByDep, { manifest });
  const [sw] = resolveSwitches(json.transition.switches, { manifest });
  const p = propagation(sw, rows);
  const st = staleFirstAnswers(sw, p, rows, json.transition.saves);
  const probe = st.find((g) => g.pop === "probe");
  // The probe's first target answer (+2 s) precedes the save (+3.3 s): head unknown.
  assert.equal(probe.n, 1);
  assert.equal(probe.unknown, 1);
  const sdk = st.find((g) => g.pop === "sdk");
  assert.equal(sdk.stale, 0, "hold follow-ups answered rev 11 = head");
});

test("R1 cohort: receipt → fetch → DOM by change type, soft-delete split from UPDATE", () => {
  const pages = [{ idx: 1, cohort: "r1", notes: [[T0 + 100, "I", "9"], [T0 + 200, "U", "9", true], [T0 - 5000, "U", "8"]], fetches: [[T0 + 400, null, 200, "cache", 11, null, false, T0 + 300, null]], dom: [[T0 + 600, ["9"], []]] }];
  const r = r1Cohort(pages, T0);
  const ins = r.find((g) => g.type === "INSERT");
  assert.equal(ins.receipts, 1);
  assert.equal(ins.fetch.p50, 200);
  assert.equal(ins.dom.p50, 500);
  assert.equal(ins.domBeforeRepair, 1);
  assert.ok(r.find((g) => g.type === "soft-delete"));
  assert.equal(r.find((g) => g.type === "UPDATE"), undefined, "the pre-switch UPDATE is excluded");
});

test("JSON records convert to history text the summariser reads; linesOf types nested lines", () => {
  const r = rec("a", Date.UTC(2026, 9, 12, 10, 0, 1, 230), NEW, "/api/setlist", 200, ["[prisma] pool total=3 idle=1 waiting=0 instance=q", "[liveSnapshot] build event=111 locale=ko rev=1 items=2 ms=3 instance=q"]);
  const txt = recordsToHistoryText([r]);
  assert.match(txt, /^10:00:01\.23 {2}alias\.vercel\.app {2}info {2}λ GET \/api\/setlist$/m);
  const l = linesOf(r);
  assert.equal(l.builds, 1);
  assert.equal(l.pool[0].total, 3);
});

test("join + markdown end to end", () => {
  const { json, logsByDep } = fixture();
  const j = join(json, { logsByDep, manifest });
  assert.equal(j.legs.length, 1);
  assert.equal(j.legs[0].role.status, "PASS");
  assert.equal(j.legs[0].propagation.status, "EXERCISED");
  assert.ok(j.legs[0].drain.requestsAfter >= 0);
  assert.equal(j.attribution.unmatched.length, 2);
  const md = toMarkdown(j, { source: "fixture" });
  // `PREVIEW_MD=1 node tests/load/transition-join.test.mjs` prints the
  // fixture report — the quickest way to eyeball a layout change.
  if (process.env.PREVIEW_MD) console.log(md);
  assert.match(md, /## Attribution/);
  assert.match(md, /Propagation — \*\*EXERCISED\*\*/);
  assert.match(md, /OFF absence: \*\*PASS\*\*/);
  assert.match(md, /## Resources across deployments/);
});

test("continuity: 30 s acceptance and p95 per SDK group; arrival exposure counted per cohort", () => {
  const save = { k: 1, rev: 11, status: 200, putStart: T0, putEnd: T0 + 300 };
  const inc = (idx, applyAt, extra = {}) => ({ idx, subscribedAt: [T0 - 60_000], applied: applyAt == null ? [] : [[applyAt, 11]], appliedAll: applyAt == null ? [] : [[applyAt, 11, "notify"]], bcasts: [[T0 + 400, 11, "n"]], ...extra });
  const clients = [
    inc(1, T0 + 1000), inc(2, T0 + 2000), inc(3, T0 + 31_000), // 3 misses the 30 s acceptance
    inc(4, T0 + 900, { subset: "hold" }),
    { idx: 5, cohort: "arrival", switchIdx: 0, subscribedAt: [T0 + 5000], applied: [[T0 + 5100, 11]], appliedAll: [[T0 + 5100, 11, "initial"]] },
  ];
  const [c] = continuity([save], clients);
  const nat = c.per.find((g) => g.group === "incumbent");
  assert.equal(nat.eligible, 3);
  assert.equal(nat.before.missing, 1);
  assert.equal(nat.continuity30s, "FAIL");
  assert.equal(nat.perf3s, "PASS", "p95 of the converged ones (1 s, 2 s) ≤ 3 s");
  assert.equal(nat.received, 3);
  const hold = c.per.find((g) => g.group === "incumbent/hold");
  assert.equal(hold.continuity30s, "PASS", "the controlled subset is its own group");
  const arr = c.per.find((g) => g.group === "arrival");
  assert.equal(arr.after.n, 1);
  assert.equal(arr.continuity30s, "n/a", "no eligible incumbent → no vacuous PASS");

  const sdk = Array.from({ length: 25 }, (_, i) => ({ idx: i, cohort: "arrival", switchIdx: 0, subscribedAt: i < 21 ? [T0 + 20_000] : [T0 + 100] }));
  const pages = Array.from({ length: 4 }, (_, i) => ({ idx: i, cohort: "arrival", switchIdx: 0, navStart: T0 - 1000, completeAt: i < 3 ? T0 + 9000 : T0 }));
  const x = arrivalExposure(save, sdk, pages, 0);
  assert.equal(x.sdk.notJoined, 21);
  assert.equal(x.sdk.exercised, true);
  assert.equal(x.pages.incomplete, 3);
  assert.equal(x.pages.exercised, true);
  assert.equal(arrivalExposure(save, sdk, pages, 1).sdk.arrivals, 0, "a later switch's arrivals are excluded");
});
