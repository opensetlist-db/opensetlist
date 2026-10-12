// n14 qualification step 6 — deployment transitions with open tabs
// (`run.mjs --phase=transition`): the pure parts. run.mjs does the I/O
// (population, switch-file polling, saves, probe, route marker, subsets,
// arrivals, smoke) and calls these; they live here, free of side
// effects, so transition.test.mjs can pin them without a browser, a
// database or a deployment (run.mjs runs its whole measurement at import
// time and cannot be imported by a test). The join
// (../transition-join.mjs) reads the harness JSON these produce; it does
// the positive attribution (Vercel request id → deployment), which the
// harness cannot see live — everything the harness classifies against a
// "first target response" here is PROVISIONAL (see `boundaryOf`).
//
// Clocks. Everything is the LOAD HOST's clock (epoch ms), except the
// switch file's cliStart / cliEnd: the operator's alias CLI runs on the
// same laptop (the recorded exception, design §0), so those share the
// clock too. The server's clock never appears here.
import { dist } from "../realtime/lib.mjs";
import { parseSnapshotVerify } from "../../../src/lib/snapshotVerify.ts";
import { connOf, connectedThrough, firstSub, sdkExposure, pageExposure } from "./admission.mjs";

// ─── flags ───

export const TRANSITION_KEYS = [
  "switch-files", "transition-saves", "leg-gap", "arrivals", "r1-cohort", "hold-subset", "hold-at", "hold-cap",
  "ahead-hint-subset", "ahead-hint-at", "ahead-hint-offset", "route-marker", "route-window", "probe-interval",
  "smoke-at", "after-switch-gap", "continuity-timeout", "notice-min", "exposure-pending-min", "exposure-recheck-min",
  "exposure-old-min", "exposure-arrival-sdk-min", "exposure-arrival-pages-min",
];

// A comma-separated list of SIGNED seconds ("-30,-1,+1,+5"), strictly
// increasing. `min` / `max` bound every element.
export function signedList(v, name, { min = -3600, max = 3600, allowEmpty = false } = {}) {
  const parts = String(v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return allowEmpty ? { list: [] } : { error: `--${name} must be a comma-separated list of seconds` };
  const list = parts.map(Number);
  if (list.some((x) => !Number.isFinite(x) || x < min || x > max)) return { error: `--${name} must be seconds in [${min}, ${max}]` };
  for (let i = 1; i < list.length; i++) if (!(list[i] > list[i - 1])) return { error: `--${name} must be strictly increasing` };
  return { list };
}

// Parse and validate the step-6 flags. `args` = parseArgs() output.
// Returns { cfg } (cfg null without --phase=transition) or { error };
// run.mjs prints the error and exits 2 BEFORE anything is created.
//
// Refusals and why:
//   - a transition flag without --phase=transition: silently ignored
//     otherwise, and the run mistaken for a step-6 run;
//   - --phase=transition with a --drill: two experiments in one run;
//   - --phase=transition with --deployment-url: the experiment IS the
//     alias moving between deployments; a deployment URL never moves;
//   - no --switch-files: there is no transition to measure;
//   - subsets larger than --subs: the subsets are CARVED OUT of --subs
//     (so the declared population stays the declared population), the
//     natural remainder must stay > 0;
//   - a save schedule without a save before AND after the switch: the
//     continuity claim needs both sides.
export function parseTransitionFlags(args, { phase, drill, deploymentUrl, subs = 0 }) {
  const given = TRANSITION_KEYS.filter((k) => args[k] !== undefined);
  if (phase !== "transition") {
    if (given.length) return { error: `${given.map((k) => `--${k}`).join(", ")} need(s) --phase=transition` };
    return { cfg: null };
  }
  if (drill) return { error: `--phase=transition runs no drill (got --drill=${drill})` };
  if (deploymentUrl) return { error: "--phase=transition measures the dev ALIAS while it moves; --deployment-url pins one deployment and is refused" };
  const files = args["switch-files"] === undefined || args["switch-files"] === true ? [] : String(args["switch-files"]).split(",").map((x) => x.trim()).filter(Boolean);
  if (!files.length) return { error: "--phase=transition needs --switch-files=a.json[,b.json,…] (one per switch, written by the operator)" };
  if (new Set(files).size !== files.length) return { error: "--switch-files lists the same file twice" };
  const saves = signedList(args["transition-saves"] ?? "-30,-1,1,5,11,15,30,60", "transition-saves", { min: -55, max: 600 });
  if (saves.error) return { error: saves.error };
  if (!(saves.list[0] < 0) || !(saves.list[saves.list.length - 1] > 0)) return { error: "--transition-saves needs at least one save before (< 0) and one after (> 0) the planned switch" };
  const num = (k, d, lo, hi, integer = true) => {
    const v = args[k] === undefined ? d : Number(args[k]);
    return Number.isFinite(v) && v >= lo && v <= hi && (!integer || Number.isInteger(v)) ? v : NaN;
  };
  const arr = String(args.arrivals ?? "10,100").split(",").map((x) => Number(x.trim()));
  if (arr.length !== 2 || arr.some((x) => !Number.isInteger(x) || x < 0 || x > 500)) return { error: "--arrivals must be \"<pages>,<sdk>\" (0–500 each)" };
  const cfg = {
    files,
    savesS: saves.list,
    legGapS: num("leg-gap", 90, 0, 3600),
    arrivals: { pages: arr[0], sdk: arr[1], atS: 10 },
    r1Cohort: num("r1-cohort", 15, 0, 100),
    hold: { n: num("hold-subset", 20, 0, 200), capS: num("hold-cap", 30, 1, 120) },
    ahead: { n: num("ahead-hint-subset", 20, 0, 200), offset: num("ahead-hint-offset", 5, 1, 1_000_000) },
    routeRate: num("route-marker", 2, 0, 10, false),
    probeIntervalMs: num("probe-interval", 1000, 0, 60000),
    smokeAtS: num("smoke-at", 20, 0, 600, false),
    afterSwitchGapS: num("after-switch-gap", 10, 1, 120, false),
    continuityMs: num("continuity-timeout", 30, 5, 120) * 1000,
    noticeMinS: num("notice-min", 60, 0, 3600),
    min: {
      pending: num("exposure-pending-min", 20, 0, 1000),
      recheck: num("exposure-recheck-min", 5, 0, 1000),
      old: num("exposure-old-min", 5, 0, 1000),
      arrivalSdk: num("exposure-arrival-sdk-min", 20, 0, 1000),
      arrivalPages: num("exposure-arrival-pages-min", 3, 0, 1000),
    },
  };
  const hAt = signedList(args["hold-at"] ?? "-1,1,3", "hold-at", { min: -20, max: 60 });
  if (hAt.error) return { error: hAt.error };
  cfg.hold.atS = hAt.list;
  const aAt = signedList(args["ahead-hint-at"] ?? "-1.2", "ahead-hint-at", { min: -20, max: 20 });
  if (aAt.error) return { error: aAt.error };
  cfg.ahead.atS = aAt.list;
  const rw = signedList(args["route-window"] ?? "-10,70", "route-window", { min: -60, max: 600 });
  if (rw.error) return { error: rw.error };
  if (rw.list.length !== 2) return { error: "--route-window must be \"<from>,<to>\" seconds relative to plannedAt" };
  cfg.routeWindowS = rw.list;
  const bad = Object.entries({ "leg-gap": cfg.legGapS, "r1-cohort": cfg.r1Cohort, "hold-subset": cfg.hold.n, "hold-cap": cfg.hold.capS, "ahead-hint-subset": cfg.ahead.n, "ahead-hint-offset": cfg.ahead.offset, "route-marker": cfg.routeRate, "probe-interval": cfg.probeIntervalMs, "smoke-at": cfg.smokeAtS, "after-switch-gap": cfg.afterSwitchGapS, "continuity-timeout": cfg.continuityMs, "notice-min": cfg.noticeMinS, ...Object.fromEntries(Object.entries(cfg.min).map(([k, v]) => [`exposure-${k}-min`, v])) })
    .filter(([, v]) => Number.isNaN(v)).map(([k]) => `--${k}`);
  if (bad.length) return { error: `${bad.join(", ")} out of range (see README "Transition phase")` };
  if (cfg.hold.n + cfg.ahead.n >= subs && cfg.hold.n + cfg.ahead.n > 0) return { error: `--hold-subset + --ahead-hint-subset (${cfg.hold.n + cfg.ahead.n}) must leave natural SDK clients out of --subs=${subs} (the subsets are carved out of it)` };
  return { cfg };
}

// ─── switch files ───

export const SWITCH_KINDS = ["pseudo", "off", "return", "fresh", "r1", "return-from-r1"];
const AFTER_OPS = ["insert", "update", "delete"];

const instant = (v) => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : NaN;
};

// One switch file → its parsed state. The operator writes it in two
// steps (README "Transition phase"): first
//   { "plannedAt": "<ISO>", "kind": "...", "label": "...", "afterSwitchSaves": "insert,update,delete" }
// ≥ 60 s ahead, then — right after `vercel alias set` returned — merges
//   { "cliStart": "<ISO>", "cliEnd": "<ISO>", "cliCpuMs": 812, "target": { "url": "https://opensetlist-<hash>-…", "id": "dpl_…" } }
// into it. The harness polls; a half-written file is simply not
// parseable yet (`{ error }`, try again). Times: ISO or epoch ms. A BOM
// (PowerShell 5.1 `Out-File -Encoding utf8`) is stripped.
export function parseSwitchFile(text) {
  const t = String(text ?? "").replace(/^﻿/, "").trim();
  if (!t) return { error: "empty" };
  let j;
  try { j = JSON.parse(t); } catch { return { error: "not JSON (yet)" }; }
  if (!j || typeof j !== "object" || Array.isArray(j)) return { error: "not a JSON object" };
  const plannedAt = instant(j.plannedAt);
  if (plannedAt == null || Number.isNaN(plannedAt)) return { error: "plannedAt missing or not an instant" };
  const kind = j.kind == null ? null : String(j.kind);
  if (kind !== null && !SWITCH_KINDS.includes(kind)) return { error: `kind must be one of ${SWITCH_KINDS.join(" | ")}` };
  let after = [];
  if (j.afterSwitchSaves != null && j.afterSwitchSaves !== "") {
    after = String(j.afterSwitchSaves).split(",").map((x) => x.trim()).filter(Boolean);
    if (after.some((x) => !AFTER_OPS.includes(x)) || new Set(after).size !== after.length) return { error: "afterSwitchSaves must be a subset of insert,update,delete" };
    // update and delete act on the row the insert creates.
    if ((after.includes("update") || after.includes("delete")) && !after.includes("insert")) return { error: "afterSwitchSaves: update / delete need insert (they act on the inserted row)" };
    after = AFTER_OPS.filter((x) => after.includes(x));
  }
  const cliStart = instant(j.cliStart);
  const cliEnd = instant(j.cliEnd);
  if (Number.isNaN(cliStart) || Number.isNaN(cliEnd)) return { error: "cliStart / cliEnd must be instants" };
  if (cliStart != null && cliEnd != null && cliEnd < cliStart) return { error: "cliEnd before cliStart" };
  let target = null;
  if (j.target != null) {
    if (typeof j.target !== "object" || typeof j.target.url !== "string") return { error: "target must be { url, id }" };
    target = { url: j.target.url.replace(/\/$/, ""), id: j.target.id == null ? null : String(j.target.id) };
  }
  const cpu = j.cliCpuMs == null ? null : Number(j.cliCpuMs);
  return {
    plannedAt, kind, label: j.label == null ? null : String(j.label), afterSwitchSaves: after,
    cliStart, cliEnd, cliCpuMs: Number.isFinite(cpu) ? cpu : null, target,
    // The switch is "done" for the harness once the CLI times and the
    // target are in: then the identity guard can run.
    complete: cliStart != null && cliEnd != null && target != null,
    raw: t.slice(0, 4000),
  };
}

// The save schedule of one leg: offsets (s) relative to plannedAt.
export const saveSchedule = (plannedAt, offsetsS) => offsetsS.map((offS, i) => ({ i, offS, due: plannedAt + Math.round(offS * 1000) }));

// The quiet between legs (--leg-gap): no save of the next leg may start
// before the previous leg's last save start + gap. Returns the delayed
// due time and the delay (0 = untouched).
export function quietDue(due, prevLastSaveStart, legGapS) {
  if (prevLastSaveStart == null) return { due, delayMs: 0 };
  const floor = prevLastSaveStart + legGapS * 1000;
  return due >= floor ? { due, delayMs: 0 } : { due: floor, delayMs: floor - due };
}

// Round-robin split of the subset clients over the wave offsets.
export function waves(idxs, offsetsS) {
  const out = offsetsS.map((offS) => ({ offS, idxs: [] }));
  idxs.forEach((x, i) => out[i % out.length].idxs.push(x));
  return out;
}

// ─── per-response evidence ───

// Pin evidence of ONE request (design §0: Skew Protection pins framework
// assets with `?dpl=`; the page's own /api/setlist fetch carries no
// `x-deployment-id` header and no `__vdpl` cookie, so it follows the
// alias). `headers` = the request headers as sent (lowercase keys; the
// Cookie header included when known). Returns "none" or
// "header=<v>|cookie=<v>|query=<v>" (only the parts present) — a string,
// so it fits the compact per-request rows.
export function pinEvidence(url, headers = {}) {
  const parts = [];
  const h = headers?.["x-deployment-id"];
  if (h) parts.push(`header=${h}`);
  const ck = String(headers?.cookie ?? "");
  const m = /(?:^|;\s*)__vdpl=([^;]+)/.exec(ck);
  if (m) parts.push(`cookie=${m[1]}`);
  try {
    const q = new URL(url, "https://x.invalid").searchParams.get("dpl");
    if (q) parts.push(`query=${q}`);
  } catch { /* not a URL */ }
  return parts.length ? parts.join("|") : "none";
}

export const isPinned = (pin) => pin != null && pin !== "none";

// `data-dpl-id` of a document (Skew Protection stamps the serving
// deployment on <html>): the positively attributed build of a page.
export function dplIdOf(html) {
  const m = /data-dpl-id="(dpl_[A-Za-z0-9]+)"/.exec(String(html ?? ""));
  return m ? m[1] : null;
}

// The hint resolution a client would compute for one hinted response
// with no other state (the probe's): satisfied when the body is at or
// above the hint (before any verify logic — snapshotAcceptance.ts), else
// disproved when a fresh revision read is below the hint, else
// inconclusive (an R1 answer has no verify header at all).
export function probeResolution(rev, hint, verifyRaw) {
  if (hint == null) return "none";
  if (rev == null) return "inconclusive";
  if (rev >= hint) return "satisfied";
  const v = parseSnapshotVerify(verifyRaw ?? null);
  if (v.kind === "fresh" && v.dbRev < hint) return "disproved";
  return "inconclusive";
}

// ─── live routing (the route marker) ───

// The first response, among the route-marker rows, that positively
// shows the TARGET deployment serving the alias. Rows:
// { reqStart, respAt, dpl } (dpl = the document's data-dpl-id). Rules:
//   - target id known and ≠ the leg's baseline (the incumbent): the
//     first row whose dpl is the target;
//   - target id unknown yet: the first row whose dpl differs from the
//     baseline (a real move; the id is confirmed once the file has it);
//   - target id = baseline (a pseudo-switch, T0): no move is visible,
//     so the first row that STARTED after cliEnd counts.
// Returns { row, how } or null.
export function firstTargetLive(rows, { baseline, targetId = null, cliEnd = null }) {
  const sorted = [...rows].filter((r) => r.dpl).sort((a, b) => a.respAt - b.respAt);
  if (targetId && targetId === baseline) {
    if (cliEnd == null) return null;
    const r = sorted.find((x) => x.reqStart > cliEnd && x.dpl === targetId);
    return r ? { row: r, how: "pseudo: first marker started after cliEnd" } : null;
  }
  const r = sorted.find((x) => x.dpl !== baseline && (targetId == null || x.dpl === targetId));
  return r ? { row: r, how: targetId ? "marker served by the target id" : "marker served by a non-baseline deployment" } : null;
}

// Live routing profile around one switch from the route marker (the
// join's log attribution is authoritative; this is the live view):
// the last request that still reached the baseline (start and response),
// and whether every marker that started in [first target, + windowMs]
// was served by the target (sustained routing).
export function routingProfile(rows, { baseline, targetId, firstTarget, windowMs = 60000 }) {
  const old = rows.filter((r) => r.dpl && r.dpl === baseline && (!targetId || targetId !== baseline));
  const lastOldReqStart = old.length ? Math.max(...old.map((r) => r.reqStart)) : null;
  const lastOldResponse = old.length ? Math.max(...old.map((r) => r.respAt)) : null;
  if (!firstTarget) return { lastOldReqStart, lastOldResponse, sustained: null, inWindow: 0, offTarget: 0, windowMs, windowCovered: false };
  const from = firstTarget.reqStart;
  const win = rows.filter((r) => r.reqStart >= from && r.reqStart <= from + windowMs);
  const offTarget = win.filter((r) => r.dpl !== (targetId ?? firstTarget.dpl)).length;
  const covered = rows.some((r) => r.reqStart >= from + windowMs - 2000);
  return { lastOldReqStart, lastOldResponse, sustained: covered ? offTarget === 0 : null, inWindow: win.length, offTarget, windowMs, windowCovered: covered };
}

// The provisional "first target response" boundary of a switch: the
// route marker's live positive identification, else the switch file's
// cliEnd (the alias CLI returned, so the move was issued), else null.
// The join replaces it with the first response the Vercel logs
// attribute to the target.
export function boundaryOf({ firstTarget, cliEnd }) {
  if (firstTarget) return { at: firstTarget.respAt, how: "route marker (data-dpl-id)" };
  if (cliEnd != null) return { at: cliEnd, how: "cliEnd (no live identification)" };
  return { at: null, how: "none" };
}

// When the hold subset is released: first target seen + delay, else the
// cap (relative to plannedAt). Pure so the rule is pinned by a test.
export function releaseAt({ firstTargetAt, plannedAt, capS, delayMs = 200 }) {
  const cap = plannedAt + capS * 1000;
  if (firstTargetAt == null) return { at: cap, why: "cap" };
  const t = firstTargetAt + delayMs;
  return t <= cap ? { at: t, why: "target+200ms" } : { at: cap, why: "cap" };
}

// ─── the hold gate (controlled subset, lives in an SDK worker) ───

// Client-side hold of in-flight responses, async (a pending Promise per
// held response — NEVER a blocked thread: the worker's lag monitor,
// heartbeats and the requests' own 8 s deadline timers keep running, so
// a hold that outlives the deadline turns into the real deadline
// failure). States: idle → armed (responses that complete now are held)
// → released (all held resolved; later responses pass). `arm` again
// starts the next leg's window.
export function createHoldGate(now = () => Date.now()) {
  let state = "idle";
  let armedAt = null;
  let releasedAt = null;
  let why = null;
  const entries = [];
  const pending = [];
  return {
    get state() { return state; },
    arm() {
      state = "armed";
      armedAt = now();
      releasedAt = null;
      why = null;
      entries.length = 0;
      pending.length = 0;
    },
    // null when not armed (the response passes); otherwise a Promise
    // resolved at release with the entry { client, heldAt, releasedAt }.
    hold(client) {
      if (state !== "armed") return null;
      const e = { client, heldAt: now(), releasedAt: null };
      entries.push(e);
      return new Promise((resolve) => pending.push(() => { e.releasedAt = now(); resolve(e); }));
    },
    release(reason = "release") {
      if (state !== "armed") return 0;
      state = "released";
      releasedAt = now();
      why = reason;
      const n = pending.length;
      for (const f of pending.splice(0)) f();
      return n;
    },
    snapshot() {
      return { state, armedAt, releasedAt, why, entries: entries.map((e) => ({ ...e })) };
    },
  };
}

// ─── SDK row access (subs-worker.mjs `reqs`, transition columns) ───

// Column indices of an SDK request row (see subs-worker.mjs and the
// README "Row formats"); 16+ exist only under --phase=transition.
export const Q = {
  tStart: 0, reason: 1, generic: 2, hint: 3, notify: 4, minRev: 5, status: 6, verify: 7, rev: 8, res: 9, tEnd: 10, outcome: 11, source: 12,
  capturedAt: 13, anchorTitle: 14, bytes: 15,
  vercelId: 16, headersAt: 17, bodyAt: 18, evalAt: 19, heldAt: 20, releasedAt: 21, xVercelCache: 22, cacheControl: 23, age: 24,
  verifyRaw: 25, pin: 26, recheckQueued: 27, failKind: 28, synthetic: 29,
};
export const SDK_ROW_TX = [
  "tStart", "reason", "generic 0/1", "hint", "notify 0/1", "minRev", "status (0 = network / deadline)", "verify kind", "body rev", "hint resolution", "tEnd (= scheduler settled)", "outcome ok|failed|cancelled", "x-snapshot-source",
  "body capturedAt", "anchorTitle (overlap only)", "body bytes",
  "x-vercel-id", "headersAt", "bodyAt", "evalAt (acceptance evaluated)", "heldAt (hold subset)", "releasedAt (hold subset)", "x-vercel-cache", "cache-control", "age",
  "x-snapshot-verify raw (null = absent)", "pin evidence (none | header=|cookie=|query=)", "recheck queued 0/1 (inconclusive notification → ticket in recheck phase)", "fail kind (http | network | deadline | gap | body)", "synthetic hint 0/1 (ahead-hint subset)",
];

// ─── exposure (predeclared, per switch) ───

// Pending hinted fetch (natural clients): a hinted request (notify=1)
// dispatched before cliStart whose outcome was not settled at the
// boundary (the provisional first target response). The separate
// milestones are kept per row so the join can say which stage spanned
// the cutover (network headers / body / acceptance / scheduler).
export function pendingHinted(clients, { cliStart, boundary, min = 20 }) {
  const rows = [];
  if (cliStart == null || boundary == null) return { count: 0, min, exercised: false, rows, why: "no cliStart / boundary" };
  for (const c of clients) {
    const q = (c.reqs || []).find((r) => r[Q.notify] === 1 && r[Q.synthetic] !== 1 && r[Q.tStart] < cliStart && (r[Q.tEnd] == null || r[Q.tEnd] > boundary));
    if (q) rows.push({ idx: c.idx, cohort: c.cohort ?? null, tStart: q[Q.tStart], headersAt: q[Q.headersAt] ?? null, bodyAt: q[Q.bodyAt] ?? null, evalAt: q[Q.evalAt] ?? null, tEnd: q[Q.tEnd], status: q[Q.status], res: q[Q.res], hint: q[Q.hint], vercelId: q[Q.vercelId] ?? null });
  }
  return { count: rows.length, min, exercised: rows.length >= min, rows };
}

// Pending recheck (controlled, ahead-hint subset): the synthetic ticket
// was answered INCONCLUSIVE before cliStart (proof the ticket was queued
// for a recheck before the switch), and its recheck settled after
// cliStart. queued = the recheck dispatched after cliStart (it waited
// across the start of the switch); dispatched = it left before cliStart
// and was still unsettled then.
export function pendingRecheck(clients, { cliStart, syntheticRevs, min = 5 }) {
  const per = [];
  if (cliStart == null) return { count: 0, queued: 0, dispatched: 0, min, exercised: false, per, why: "no cliStart" };
  const syn = new Set(syntheticRevs || []);
  for (const c of clients) {
    const reqs = c.reqs || [];
    const n = reqs.find((r) => syn.has(r[Q.hint]) && r[Q.reason] !== "recheck" && r[Q.res] === "inconclusive");
    const first = reqs.find((r) => syn.has(r[Q.hint]) && r[Q.reason] !== "recheck");
    if (!n) {
      per.push({ idx: c.idx, state: first ? `first answer ${first[Q.res] ?? first[Q.outcome]}` : "no synthetic fetch", firstVerify: first?.[Q.verify] ?? null });
      continue;
    }
    const queuedAt = n[Q.tEnd];
    const rc = reqs.find((r) => r[Q.reason] === "recheck" && r[Q.tStart] >= queuedAt && syn.has(r[Q.hint]));
    let state;
    if (queuedAt >= cliStart) state = "inconclusive after cliStart";
    else if (rc == null) state = "queued, never dispatched";
    else if (rc[Q.tStart] > cliStart) state = "queued";
    else if (rc[Q.tEnd] == null || rc[Q.tEnd] > cliStart) state = "dispatched";
    else state = "recheck settled before cliStart";
    per.push({ idx: c.idx, state, queuedAt, recheckStart: rc?.[Q.tStart] ?? null, recheckEnd: rc?.[Q.tEnd] ?? null, recheckRes: rc?.[Q.res] ?? null, recheckVerify: rc?.[Q.verify] ?? null, recheckVercelId: rc?.[Q.vercelId] ?? null });
  }
  const queued = per.filter((p) => p.state === "queued").length;
  const dispatched = per.filter((p) => p.state === "dispatched").length;
  return { count: queued + dispatched, queued, dispatched, min, exercised: queued + dispatched >= min, per };
}

// Old answer after cutover: a 200 dispatched before cliStart, evaluated
// (applied or not) after the boundary, then the client converges to the
// leg's head without regression. `natural` and `hold` are counted
// apart by the caller (pass each population separately).
export function oldAnswerAfterCutover(clients, { cliStart, boundary, headRev, until = Infinity, min = 5 }) {
  const per = [];
  if (cliStart == null || boundary == null) return { count: 0, min, exercised: false, per, why: "no cliStart / boundary" };
  for (const c of clients) {
    const q = (c.reqs || []).find((r) => r[Q.tStart] < cliStart && r[Q.status] === 200 && (r[Q.evalAt] ?? r[Q.tEnd] ?? -Infinity) > boundary);
    if (!q) continue;
    const evalAt = q[Q.evalAt] ?? q[Q.tEnd];
    const after = (c.applied || []).filter(([t]) => t > evalAt && t <= until);
    const conv = headRev != null ? after.find(([, rev]) => rev >= headRev) : null;
    let maxV = -Infinity;
    let regressions = 0;
    for (const [t, rev] of c.applied || []) {
      if (t > until) break;
      if (rev < maxV && t >= q[Q.tStart]) regressions++;
      maxV = Math.max(maxV, rev);
    }
    per.push({ idx: c.idx, cohort: c.cohort ?? null, tStart: q[Q.tStart], evalAt, heldAt: q[Q.heldAt] ?? null, releasedAt: q[Q.releasedAt] ?? null, rev: q[Q.rev], vercelId: q[Q.vercelId] ?? null, convergedAt: conv ? conv[0] : null, regressions, ok: !!conv && regressions === 0 });
  }
  const count = per.filter((p) => p.ok).length;
  return { count, candidates: per.length, min, exercised: count >= min, per };
}

// Arrival exposure of one save (the +11 / +15 s saves): SDK arrivals
// still unjoined at the PUT response, pages navigated by the PUT start
// but not complete — independently (admission.mjs rules on the arrival
// cohort only).
export function arrivalExposure(sdkArrivals, pageArrivals, save, { sdkMin = 20, pagesMin = 3 } = {}) {
  const s = sdkExposure(sdkArrivals, save, { min: 0 });
  const p = pageExposure(pageArrivals, save, { min: pagesMin });
  return {
    sdk: { unjoined: s.notYet, connected: s.connected, total: s.total, min: sdkMin, exposed: s.notYet >= sdkMin && sdkArrivals.length > 0 },
    pages: { incomplete: p.inflight, future: p.future, settled: p.settled, total: p.total, min: pagesMin, exposed: p.exposed && pageArrivals.length > 0 },
  };
}

// ─── outcomes, continuity ───

// The latest committed revision whose save had answered by instant t
// (the head a request started at t could know about).
export function headAt(saves, t) {
  let h = null;
  for (const s of saves) if (s.rev != null && s.putEnd != null && s.putEnd <= t && (h == null || s.rev > h)) h = s.rev;
  return h;
}

// How one client reached one save (design §2 "outcomes … counted"):
// the first applied snapshot with rev ≥ the save's, within `timeoutMs`
// of `clock`, by the reason of the fetch that applied it —
// notification → satisfied-first-fetch, recheck → rechecked, periodic →
// periodic-repaired, else the reason itself (catchup, initial, resume,
// retry). `superseded` = what it applied was already a later save's
// revision; `exhausted` = a ticket for this save was dropped after an
// inconclusive recheck.
export function clientOutcome(c, save, { clock, timeoutMs }) {
  const a = (c.applied || []).find((x) => x[1] >= save.rev);
  const exhausted = (c.exhausted || []).some(([, h]) => h === save.rev);
  if (!a || a[0] > clock + timeoutMs) return { outcome: exhausted ? "exhausted (missing)" : "missing", ms: null, superseded: false, exhausted };
  const map = { notification: "satisfied-first-fetch", recheck: "rechecked", periodic: "periodic-repaired" };
  return { outcome: map[a[2]] ?? a[2], ms: Math.max(0, a[0] - clock), superseded: a[1] > save.rev, exhausted };
}

// Broadcast receipt of one save by the continuously connected R2 SDK
// clients: connected through [PUT start, PUT response + graceMs] (a
// client that dropped inside it may legitimately miss the frame — it is
// counted apart), and received the save's `rev` frame (news or
// duplicate; never a drill drop or a synthetic hint).
export function broadcastReceipt(clients, save, { graceMs = 10000 } = {}) {
  let eligible = 0;
  let received = 0;
  const missingIdx = [];
  for (const c of clients) {
    if (c.stoppedAt != null && c.stoppedAt <= save.putEnd + graceMs) continue;
    if (!connectedThrough(connOf(c), save.putStart, save.putEnd + graceMs)) continue;
    eligible++;
    if ((c.bcasts || []).some(([, rev, w]) => rev === save.rev && (w === "n" || w === "d"))) received++;
    else if (missingIdx.length < 20) missingIdx.push(c.idx);
  }
  return { eligible, received, missing: eligible - received, missingIdx };
}

// Update gaps of one client: the largest interval between two
// consecutive successful (200) responses inside [from, to].
export function updateGap(reqs, from, to) {
  const ts = (reqs || []).filter((r) => r[Q.status] === 200 && r[Q.tEnd] != null && r[Q.tEnd] >= from && r[Q.tEnd] <= to).map((r) => r[Q.tEnd]).sort((a, b) => a - b);
  let g = 0;
  for (let i = 1; i < ts.length; i++) g = Math.max(g, ts[i] - ts[i - 1]);
  return ts.length > 1 ? g : null;
}

// Page build by behaviour (design: detect R1 by postgres_changes / the
// absent verify header). An R1 page REGISTERS postgres_changes (the
// "Subscribed to PostgreSQL" system frame, or a received change);
// an R2 page never does. The verify header is a property of the
// SERVING deployment (an R1 page fetching through an ON target gets
// one), so it only labels pages that never registered anything:
// "r2" when their channel joined, else "unknown".
export function pageBuild(p) {
  if ((p.pgReadyAt && p.pgReadyAt.length) || (p.notes && p.notes.length)) return "r1";
  if (p.joinAt && p.joinAt.length) return "r2";
  return "unknown";
}

// Readiness per cohort (design: R1 pages = postgres_changes registered,
// R2 = channel joined / SUBSCRIBED).
export function pageReadyAt(p) {
  const b = pageBuild(p);
  if (b === "r1") return p.pgReadyAt && p.pgReadyAt.length ? p.pgReadyAt[0] : null;
  return p.joinAt && p.joinAt.length ? p.joinAt[0] : null;
}

// Time to usable of an arriving page: the LATER of the complete setlist
// and the cohort's readiness (design: "the later of complete setlist and
// hydration/channel readiness"), from its navigation start.
export function timeToUsable(p) {
  const ready = pageReadyAt(p);
  if (p.navStart == null || p.completeAt == null || ready == null) return null;
  return Math.max(p.completeAt, ready) - p.navStart;
}

// Stale first answers after an existing-ON return (design §2): every
// client's first response whose request started after the boundary;
// stale = body rev below the head its request could know (headAt).
// rows: [{ who, tStart, rev }].
export function staleFirstAfter(rows, saves, boundary) {
  const out = { eligible: 0, stale: 0, unknown: 0, staleList: [] };
  if (boundary == null) return out;
  for (const r of rows) {
    if (r.tStart == null || r.tStart < boundary) continue;
    out.eligible++;
    const h = headAt(saves, r.tStart);
    if (r.rev == null) out.unknown++;
    else if (h != null && r.rev < h) {
      out.stale++;
      if (out.staleList.length < 20) out.staleList.push({ ...r, head: h });
    }
  }
  return out;
}

// The first rowsLog entry at or after `from` satisfying `pred(rows)` —
// the DOM update time of a structural save (insert: one more row; PUT:
// the marker shown; soft-delete: the row gone).
export function firstRowsAt(rowsLog, from, pred) {
  for (const [t, rows] of rowsLog || []) if (t >= from && pred(rows)) return t;
  return null;
}

// ─── verdicts ───

// Continuity of one switch (design §2, verdict "Continuity"): each
// named check → pass true / false. FAIL on any false; null checks (no
// population in scope) are n/a.
export function continuityVerdict(checks) {
  const failed = checks.filter((c) => c.pass === false).map((c) => c.name);
  return { pass: failed.length === 0, failed };
}

// Run verdict: INVALID (host) outranks; then any FAIL (continuity,
// performance, arrivals, smoke) → VALID + FAIL; else any predeclared
// exposure NOT EXERCISED → NOT EXERCISED (exit 4: re-run that switch,
// the behavioural verdicts stand); else VALID + PASS.
export function transitionVerdict({ invalid, switches }) {
  if (invalid) return { verdict: "INVALID", exit: 3 };
  const failed = [];
  const notExercised = [];
  for (const s of switches) {
    for (const [k, v] of Object.entries(s.verdicts || {})) if (v === "FAIL") failed.push(`switch ${s.k} ${k}`);
    for (const [k, v] of Object.entries(s.exposureVerdicts || {})) if (v === "NOT EXERCISED") notExercised.push(`switch ${s.k} ${k}`);
  }
  if (failed.length) return { verdict: "VALID + FAIL", exit: 1, failed, notExercised };
  if (notExercised.length) return { verdict: "NOT EXERCISED", exit: 4, failed, notExercised };
  return { verdict: "VALID + PASS", exit: 0, failed, notExercised };
}

export const pctOf = (values) => dist(values);
export { firstSub };
