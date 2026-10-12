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
  linesOf, roleKind, staleFirstAnswers, r1Cohort, continuity, arrivalExposure, checkCols, SDK_REQ_COLS, cohortOf, parsePin,
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

// The column labels the real harness writes (transition.rows, run.mjs).
const SDK_LABELS = ["tStart", "reason", "generic 0/1", "hint", "notify 0/1", "minRev", "status (0 = network / deadline)", "verify kind", "body rev", "hint resolution", "tEnd (= scheduler settled)", "outcome ok|failed|cancelled", "x-snapshot-source", "body capturedAt", "anchorTitle (overlap only)", "body bytes", "x-vercel-id", "headersAt", "bodyAt", "evalAt (acceptance evaluated)", "heldAt (hold subset)", "releasedAt (hold subset)", "x-vercel-cache", "cache-control", "age", "x-snapshot-verify raw (null = absent)", "pin evidence (none | header=|cookie=|query=)", "recheck queued 0/1 (inconclusive notification → ticket in recheck phase)", "fail kind (http | network | deadline | gap | body)", "synthetic hint 0/1 (ahead-hint subset)"];
const PAGE_LABELS = ["tResponse", "minRev", "status", "x-snapshot-source", "body rev", "x-snapshot-verify (raw)", "hint=1", "request start", "body capturedAt", "x-vercel-id", "x-vercel-cache", "cache-control", "age", "pin evidence", "body complete t", "request path + query"];

// One SDK request row in the harness's array layout.
function sdkRow(o) {
  const r = new Array(30).fill(null);
  Object.assign(r, {
    0: o.tStart, 1: o.reason ?? "notification", 2: o.notify ? 0 : 1, 3: o.hint ?? null, 4: o.notify ? 1 : 0, 5: o.minRev ?? null,
    6: o.status ?? 200, 7: o.verifyKind ?? "satisfied", 8: o.rev ?? null, 9: o.resolution ?? "satisfied", 10: o.settledAt ?? o.bodyAt,
    11: "ok", 12: o.source ?? "cache", 16: o.vercelId, 17: o.headersAt ?? o.bodyAt, 18: o.bodyAt, 19: o.evalAt ?? o.bodyAt,
    25: o.verifyRaw ?? "satisfied", 26: o.pin ?? "none", 27: o.recheckQueued ? 1 : 0, 29: o.synthetic ? 1 : 0,
  });
  return r;
}

// A main-thread record (probe / route marker / guard).
const mainRecOf = (pop, t, id, extra = {}) => ({ pop, k: null, tStart: t, tHeaders: t + 100, tBody: t + 120, status: 200, vercelId: `sfo1::icn1::${id}`, xVercelCache: "MISS", cacheControl: "public, max-age=0, must-revalidate", age: "0", source: "cache", verifyRaw: "satisfied", verifyKind: "satisfied", rev: 10, bodyOk: true, hint: 5, minRev: 5, locale: "ko", resolution: "satisfied", pin: "none", dpl: null, ...extra });

function fixture({ dropProbeLog = false, writerLine = true, warmStart = false } = {}) {
  const probe = [];
  const logs = { [OLD]: [], [NEW]: [] };
  for (let i = -20; i <= 70; i++) {
    const t = T0 + i * 1000;
    const dep = t < T0 + 1500 ? OLD : NEW;
    const id = `prb${i + 100}-1-a`;
    probe.push(mainRecOf("probe", t, id));
    if (dropProbeLog && i === 3) continue;
    logs[dep].push(rec(id, t + 30, dep, "/api/setlist", 200, [`[setlist] hint-fetch event=111 locale=ko minRev=5 verify=satisfied instance=${dep}i`]));
  }
  const sdk = [];
  const client = (idx, cohort, reqs) => ({ idx, worker: 0, cohort, locale: "ko", attemptAt: T0 - 60_000, subscribedAt: [T0 - 59_000], connLog: [[T0 - 59_000, 1, "SUBSCRIBED"]], stoppedAt: null, reqs, applied: [], bcasts: [] });
  // 25 natural hinted SDK fetches dispatched before cliStart, settled after the first target response.
  for (let c = 0; c < 25; c++) {
    const id = `sdk${c}-1-b`;
    sdk.push(client(c, "incumbent", [sdkRow({ tStart: T0 - 500, notify: true, hint: 9, minRev: 9, bodyAt: T0 + 2500, settledAt: T0 + 3000, rev: 10, vercelId: `sfo1::icn1::${id}` })]));
    logs[OLD].push(rec(id, T0 - 470, OLD, "/api/setlist", 200, ["[setlist] hint-fetch event=111 locale=ko minRev=9 verify=satisfied instance=x"]));
  }
  // Hold subset: the old answer is held client-side and evaluated after the cutover; the follow-up from the target converges.
  for (let c = 100; c < 106; c++) {
    const a = `hold${c}-1-c`, b = `hold${c}-2-c`;
    sdk.push(client(c, "hold", [
      sdkRow({ tStart: T0 - 200, reason: "resume", bodyAt: T0 + 100, evalAt: T0 + 4000, rev: 10, vercelId: a, verifyRaw: "none", verifyKind: "none" }),
      sdkRow({ tStart: T0 + 5000, reason: "periodic", bodyAt: T0 + 5200, rev: 11, vercelId: b, source: "build", verifyRaw: "none", verifyKind: "none" }),
    ]));
    logs[OLD].push(rec(a, T0 - 180, OLD, "/api/setlist", 200));
    logs[NEW].push(rec(b, T0 + 5020, NEW, "/api/setlist", 200));
  }
  // Ahead subset: a synthetic ticket inconclusive before cliStart (recheck queued), recheck dispatched after T.
  sdk.push(client(300, "ahead", [
    sdkRow({ tStart: T0 - 1500, notify: true, hint: 99, minRev: 99, bodyAt: T0 - 1250, evalAt: T0 - 1200, rev: 10, resolution: "inconclusive", recheckQueued: true, synthetic: true, vercelId: "ahd-1-f" }),
    sdkRow({ tStart: T0 + 2500, notify: true, hint: 99, minRev: 99, bodyAt: T0 + 2650, settledAt: T0 + 2700, rev: 11, resolution: "inconclusive", synthetic: true, vercelId: "ahd-2-f" }),
  ]));
  logs[OLD].push(rec("ahd-1-f", T0 - 1480, OLD, "/api/setlist", 200, ["[setlist] hint-fetch event=111 locale=ko minRev=99 verify=fresh=10 instance=x"]));
  logs[NEW].push(rec("ahd-2-f", T0 + 2520, NEW, "/api/setlist", 200, ["[setlist] hint-fetch event=111 locale=ko minRev=99 verify=fresh=11 instance=y"]));
  // One unmatched SDK response, one with a status mismatch.
  sdk.push(client(200, "incumbent", [sdkRow({ tStart: T0 + 8000, reason: "periodic", bodyAt: T0 + 8100, vercelId: "sfo1::icn1::ghost-1-d" })]));
  sdk.push(client(201, "incumbent", [sdkRow({ tStart: T0 + 9000, reason: "periodic", bodyAt: T0 + 9100, vercelId: "mism-1-d" })]));
  logs[NEW].push(rec("mism-1-d", T0 + 9020, NEW, "/api/setlist", 503));
  const saveMsgs = [writerLine ? "[liveWriter] route=setlist-item-put acquireMs=3 execMs=20 rev=11 ok=true at=1 instance=w" : "[prisma] pool total=1 idle=1 waiting=0 instance=w"];
  if (warmStart) saveMsgs.push("[liveWarm] start event=111 rev=11 at=1 instance=w");
  const saves = [
    { k: "1.3", leg: 1, i: 3, op: "put", offS: 3, scheduledAt: T0 + 3000, startedAt: T0 + 3000, ms: 300, headersMs: 290, status: 200, rev: 11, vercelId: "sfo1::icn1::save1-1-e", rowId: "5", songId: "7", error: null },
  ];
  logs[NEW].push(rec("save1-1-e", T0 + 3010, NEW, "/api/admin/setlist-items/5", 200, saveMsgs, "PUT"));
  // A page (document + one /api/setlist fetch) and a route marker whose data-dpl-id is checked against the record.
  const pages = [{ idx: 0, locale: "ko", cohort: "incumbent", build: "r2", navStart: T0 - 50_000, completeAt: T0 - 49_000, seen: {}, gone: {}, notes: [],
    fetches: [[T0 + 6200, 10, 200, "cache", 11, "satisfied", true, T0 + 6000, null, "sfo1::icn1::pgf-1-g", "MISS", "public", "0", "none", T0 + 6210, "/api/setlist?eventId=111&locale=ko&minRev=10&hint=1"]],
    navs: [[T0 - 50_000, "https://alias.vercel.app/ko/events/111/x", 200, "sfo1::icn1::doc-1-g", OLD]] }];
  logs[NEW].push(rec("pgf-1-g", T0 + 6020, NEW, "/api/setlist", 200, ["[setlist] hint-fetch event=111 locale=ko minRev=10 verify=satisfied instance=y"]));
  logs[OLD].push(rec("doc-1-g", T0 - 49_990, OLD, "/ko/events/111/x", 200));
  const route = [mainRecOf("route", T0 + 2200, "rte-1-h", { dpl: NEW, source: null, verifyRaw: null, hint: null, minRev: null, phase: "after" })];
  logs[NEW].push(rec("rte-1-h", T0 + 2210, NEW, "/ko/events/111/x", 200));
  for (const k of Object.keys(logs)) logs[k].sort((a, b) => a.timestamp - b.timestamp);
  const json = { config: { label: "fixture", base: "https://alias.vercel.app" }, transition: {
    version: 1, label: "fixture", rows: { sdkReqs: SDK_LABELS, pageFetches: PAGE_LABELS }, syntheticRevs: [99],
    manifest: { file: "fixture-manifest.json", rev: 10, rows: 24 }, // the FIXTURE manifest, not a deployment manifest
    switches: [{
      k: 1, kind: "off", label: "ON-A → OFF-1", plannedAt: T0, cliStart: T0, cliEnd: T0 + 2000, cliCpuMs: 900,
      target: { url: "https://new-y.vercel.app", id: NEW }, baselineDpl: OLD, window: { from: T0 - 25_000, to: T0 + 80_000 },
      boundary: { at: T0 + 2320, how: "route marker (data-dpl-id)" }, firstTargetLive: { reqStart: T0 + 2200, respAt: T0 + 2320, dpl: NEW },
      routing: { sustained: true, inWindow: 1, offTarget: 0 }, route, guard: { attempts: [] }, smoke: [],
    }],
    saves, probe, sdk, pages,
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
  // all populations: the natural SDK hinted fetches' old responses end at +2.5 s
  // (the hold subset's bodies arrived at +0.1 s; holding delays evaluation, not the response).
  assert.equal(p.per.all.lastOldEnd, T0 + 2500);
  assert.equal(p.per.route.firstTarget.tEnd, T0 + 2320, "route marker population reported apart");
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

test("real shape: array rows by column map, cohorts, pins, synthetic keyed on the ahead cohort", () => {
  const { json } = fixture();
  const rs = harnessResponses(json);
  const ahead = rs.filter((r) => r.client === 300);
  assert.equal(ahead.length, 2);
  assert.ok(ahead.every((r) => r.synthetic && r.subset === "ahead"));
  assert.equal(ahead[0].recheckQueued, true);
  assert.equal(ahead[0].evalAt, T0 - 1200);
  const nat = rs.find((r) => r.pop === "sdk" && r.client === 0);
  assert.equal(nat.reqId, "sdk0-1-b");
  assert.equal(nat.settledAt, T0 + 3000);
  assert.equal(nat.tEnd, T0 + 2500, "response received = bodyAt");
  assert.equal(nat.synthetic, false);
  assert.equal(rs.find((r) => r.pop === "save").tEnd, T0 + 3300, "startedAt + ms");
  assert.equal(rs.find((r) => r.pop === "document").dpl, OLD);
  assert.equal(rs.find((r) => r.pop === "page").path, "/api/setlist");
  assert.equal(rs.find((r) => r.pop === "probe").notify, true, "probe: hint present → hint=1 sent");
  // A synthetic flag on a non-ahead client is not a synthetic ticket.
  const j2 = structuredClone(json);
  j2.transition.sdk[0].reqs[0][29] = 1;
  assert.equal(harnessResponses(j2).find((r) => r.client === 0).synthetic, false);
  assert.deepEqual(cohortOf("arrival-2"), { cohort: "arrival", subset: null, switchIdx: 1 });
  assert.deepEqual(cohortOf("hold"), { cohort: "incumbent", subset: "hold", switchIdx: null });
  assert.deepEqual(parsePin("cookie=dpl_X"), { header: null, cookie: "dpl_X", query: null });
  assert.deepEqual(parsePin("none"), { header: null, cookie: null, query: null });
  // A reordered harness column fails loudly.
  const bad = [...SDK_LABELS];
  [bad[16], bad[17]] = [bad[17], bad[16]];
  assert.throws(() => checkCols(bad, SDK_REQ_COLS, "sdkReqs"), /column order changed/);
});

test("real shape: a route marker's data-dpl-id contradicting the record is inconsistent", () => {
  const { json, logsByDep } = fixture();
  json.transition.switches[0].route[0].dpl = OLD; // served by NEW per the log
  const rows = attribute(harnessResponses(json), logsByDep, { manifest });
  const r = rows.find((x) => x.pop === "route");
  assert.equal(r.attr.consistent, false);
  assert.match(r.attr.mismatch.join(), /data-dpl-id dpl_OLD ≠ record dpl_NEW/);
});

test("real shape: recheck exposure derived from recheckQueued rows (queued vs dispatched)", () => {
  const { json, logsByDep } = fixture();
  const rows = attribute(harnessResponses(json), logsByDep, { manifest });
  const [sw] = resolveSwitches(json.transition.switches, { manifest });
  assert.equal(sw.fromId, OLD, "from = baselineDpl");
  const p = propagation(sw, rows);
  const e = exposure(sw, p, rows);
  assert.equal(e.pendingRecheck.clients, 1);
  assert.equal(e.pendingRecheck.queued, 1, "recheck dispatched after the first target response");
  assert.equal(e.pendingRecheck.dispatched, 0);
  assert.equal(e.pendingHinted.clients, 25, "the ahead subset's synthetic ticket is not natural exposure");
});

test("pseudo-switch: target = baseline → no old side, first target after cliEnd, hold answer counted as pre-switch", () => {
  const { json, logsByDep } = fixture();
  // Serve everything from OLD and declare a pseudo-switch to OLD.
  const all = [...logsByDep.get(OLD), ...logsByDep.get(NEW).map((r) => ({ ...r, deploymentId: OLD }))];
  const logs = new Map([[OLD, all]]);
  json.transition.switches[0] = { ...json.transition.switches[0], kind: "pseudo", target: { id: OLD }, baselineDpl: OLD };
  json.transition.switches[0].route[0].dpl = OLD;
  const rows = attribute(harnessResponses(json), logs, {});
  const [sw] = resolveSwitches(json.transition.switches, {});
  assert.equal(sw.pseudo, true);
  const p = propagation(sw, rows);
  assert.equal(p.status, "EXERCISED");
  assert.equal(p.per.probe.firstTarget.tStart, T0 + 2000, "first probe started after cliEnd");
  assert.equal(p.per.probe.lastOldStart, null);
  assert.equal(p.per.all.old, 0);
  assert.equal(p.sustained.ok, true);
  const e = exposure(sw, p, rows);
  assert.equal(e.oldAfterCutover.controlled, 6, "held pre-switch answers evaluated after the boundary");
  const j = join(json, { logsByDep: logs });
  assert.equal(j.legs[0].pseudo, true);
  assert.equal(j.legs[0].stale, null, "a pseudo-switch is never an existing-deployment return");
  assert.match(toMarkdown(j), /Pseudo-switch/);
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
