// Join an n14 step-6 transition run (`run.mjs --phase=transition`) with
// the per-deployment JSON request logs (`vercel-logs-json.sh`): which
// deployment actually answered every recorded request, and what that
// means for the switch's propagation, exposure, OFF / R1 evidence,
// resources and continuity (design step6-design.md §2–§3).
//
//   node tests/load/transition-join.mjs <browsers-transition.json>
//        --logs=<dplId>=<a.jsonl>[,<dplId>=<b.jsonl>…]
//        [--switch-files=<a.json>,<b.json>…] [--manifest=<deployments.json>]
//        [--alias=<host>] [--sustain-s=60] [--carry=5] [--bucket=5]
//        [--out=<file.md>] [--json[=<file.json>]]
//
//   node tests/load/transition-join.mjs merge-logs <out.jsonl> <raw.jsonl>… [--coverage=…]
//        (used by vercel-logs-json.sh: dedupe by id + merge into <out>)
//
// ─── What the join expects from the harness JSON (`transition` section) ───
// The harness side is written in parallel; this module reads it
// defensively and the README section "n14 qualification step 6 — joins,
// attribution smoke, JSON log export" documents the same contract.
//
//   transition.switches[]: { name?, plannedAt, cliStart, cliEnd, cliCpuMs,
//       target: { url, id }, from?: { url?, id? }, kind?, afterSwitchSaves? }
//     kind: "pseudo" (T0) | "off" | "r1" | "existing-return" | "fresh" | …
//     (free text; "existing-return" — or a target already seen earlier in
//     the run — triggers the stale-first-answer table). Switch files given
//     with --switch-files are merged in by index (they are the operator's
//     own record and win for cliStart / cliEnd / target).
//   transition.saves[]: { k?, who?, rev, status, putStart, putEnd,
//       firstAttemptAt?, method?, path?, leg? (switch index), label?,
//       scheduledOffsetMs?, actualOffsetMs?, offsetFromCliEndMs?, arrival?,
//       songId?, vercelId }
//   Responses — any of these, each row an object (or an array with a
//   section-level `cols` / `reqCols` naming the columns):
//     transition.responses[]                       (flat, with `pop`)
//     transition.{sdk,pages,probe,saves,smoke,guard,documents}.{responses|reqs|rows}[]
//     transition.{sdk,pages}.clients[].reqs[]      (per client)
//   Response fields (first present alias wins):
//     request id   vercelId | xVercelId | reqId | "x-vercel-id"   (full header
//                  `sfo1::icn1::<reqid>` or the bare <reqid>)
//     timing       tStart|reqStart|start|sentAt  ·  tEnd|end|respAt|receivedAt|t
//                  headersAt · bodyAt · evalAt · settledAt  (exposure stages)
//     who          pop|population · client|clientId|idx · subset ("hold" |
//                  "aheadHint" | null) · cohort ("incumbent" | "arrival" | "r1")
//     request      method (GET) · path|url · host · notify (hint=1 sent) ·
//                  minRev · hint (ticket rev) · reason (initial | notify |
//                  recheck | periodic | …) · queuedAt (recheck ticket queued)
//     response     status (0 = network / deadline) · bodyValid · rev · source
//                  (x-snapshot-source) · verify (x-snapshot-verify; null =
//                  header absent) · resolution (satisfied | inconclusive |
//                  disproved | superseded) · cache { xVercelCache,
//                  cacheControl, age } · pin { header, cookie, query } ·
//                  clientBuild (document data-dpl-id)
//   Client records (continuity, R1 cohort): transition.sdk.clients[] in
//   subs-worker.mjs's record shape (idx, cohort, subset, subscribedAt,
//   connLog, applied, appliedAll, bcasts, stoppedAt, switchIdx), pages in
//   pages.mjs's shape (idx, cohort, navStart, completeAt, joinAt, seen,
//   gone, dom, notes [t, type, rowId, isDeleted?], fetches).
//   Optional: transition.rechecks[] { client, queuedAt, dispatchedAt,
//   settledAt, subset }, transition.smoke[] (reactions / wishes),
//   transition.arrivals[], transition.verdicts (harness provisional).
//
// ─── What the join reports ───
//   - Attribution: every response with a request id joined to a log record
//     by id. "Request attribution" = id matched AND the record's
//     deploymentId / requestPath / responseStatusCode consistent with the
//     response. "Function instrumentation" = the record also carries the
//     lines the deployment's role must log for that request (a save → a
//     `[liveWriter]` line; a hinted read on an R2 deployment → a
//     `[setlist] hint-fetch` line). They are separate: a request can be
//     attributed while its nested lines are missing (the background part
//     of a record lands later — second export pass).
//   - Propagation per switch (probe and every alias population apart),
//     exposure finalisation, positive OFF / R1 evidence, resources across
//     deployments (Σ via vercel-logs-summary's estimator, with its
//     caveats), drain, continuity / performance per save and population,
//     the R1 cohort table, the existing-ON return stale-first-answer
//     table and the reactions / wishes smoke table.
//
// Clocks: the harness, the switch files (CLI start / end) and the smoke
// all stamp this laptop's clock; a log record's `timestamp` is Vercel's
// (request arrival at the edge); a writer's `at=` is the function's
// Date.now(). The join never orders events across clocks without saying
// so: propagation bounds use harness times only (attribution only says
// WHICH deployment answered), and the record−harness offset distribution
// is printed so the size of the cross-clock uncertainty is visible.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarise } from "./vercel-logs-summary.mjs";
import { todToEpoch } from "./overlap-join.mjs";
import { sdkConvergence, receiptVsReason, firstSub } from "./browsers/admission.mjs";

const iso = (t) => (t == null || !Number.isFinite(t) ? "—" : new Date(t).toISOString());
const hms = (t) => (t == null || !Number.isFinite(t) ? "—" : new Date(t).toISOString().slice(11, 23));
const d = (v) => (v == null || !Number.isFinite(v) ? "—" : String(Math.round(v)));
const num = (v) => {
  if (v == null || v === "" || v === "-") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const pct = (values, p) => {
  const s = values.filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
};
const first = (o, keys) => {
  for (const k of keys) if (o && o[k] !== undefined && o[k] !== null) return o[k];
  return null;
};

// Predeclared thresholds (design §2 "Exposure", Codex rounds 2–3). They
// are coverage minimums chosen before the run, not statistical bounds.
export const EXPOSURE_MIN = { pendingHinted: 20, pendingRecheck: 5, oldAfterCutover: 5, arrivalSdk: 20, arrivalPages: 3 };
export const CONTINUITY_MS = 30_000; // proposed operational acceptance
export const PERF_P95_MS = 3_000; // per-save, per-population target, kept visible
// The earliest a healthy periodic repair can fire (20 s ± 4 s): an R1 DOM
// update before this after a postgres_changes receipt was driven by the
// receipt, not by the periodic poll.
export const EARLIEST_REPAIR_MS = 16_000;

// ─── log records ───

export function parseJsonl(text) {
  const out = [];
  for (const l of String(text).split(/\r?\n/)) {
    if (!l.trim().startsWith("{")) continue;
    try { out.push(JSON.parse(l)); } catch { /* partial line */ }
  }
  return out;
}

const logCount = (r) => (Array.isArray(r?.logs) ? r.logs.length : 0);

/**
 * Dedupe + merge log records by `id`. When two copies of one request
 * differ, the copy with MORE nested `logs[]` lines wins: a request's
 * `after()` work (the writer's warm job) is appended to its record after
 * the response, so an early export holds a shorter copy of the same
 * record. Records without an id are kept as they are (never seen in
 * practice; counted). Output sorted by timestamp.
 */
export function mergeLogRecords(existing = [], incoming = []) {
  const by = new Map();
  let dupes = 0, added = 0, enriched = 0, noId = 0;
  const loose = [];
  for (const r of existing) {
    if (!r?.id) { loose.push(r); noId++; continue; }
    if (by.has(r.id)) { dupes++; if (logCount(r) > logCount(by.get(r.id))) by.set(r.id, r); continue; }
    by.set(r.id, r);
  }
  const before = new Set(by.keys());
  for (const r of incoming) {
    if (!r?.id) { loose.push(r); noId++; continue; }
    const cur = by.get(r.id);
    if (!cur) { by.set(r.id, r); if (!before.has(r.id)) added++; continue; }
    dupes++;
    if (logCount(r) > logCount(cur)) { by.set(r.id, r); if (before.has(r.id)) enriched++; }
  }
  const records = [...by.values(), ...loose].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  return { records, dupes, added, enriched, noId };
}

/** `sfo1::icn1::<reqid>` → `<reqid>`; a bare id passes through. */
export function reqIdOf(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const parts = s.split("::");
  return parts[parts.length - 1] || null;
}

const kv = (line) => {
  const out = {};
  for (const m of String(line).matchAll(/([A-Za-z_][\w]*)=(\S+)/g)) out[m[1]] = m[2];
  return out;
};

/**
 * The nested lines of one record, typed. Patterns mirror
 * vercel-logs-summary.mjs's classifier (the same server log contract);
 * only the kinds this join needs are kept.
 */
export function linesOf(rec) {
  const msgs = (Array.isArray(rec?.logs) && rec.logs.length ? rec.logs.map((l) => l?.message ?? "") : [rec?.message ?? ""])
    .flatMap((m) => String(m).split(/\r?\n/)).filter((m) => m.trim());
  const o = { writer: [], writerFailed: 0, warmStart: 0, warmAny: 0, warmArmed: 0, warmLookup: [], hintFetch: [], builds: 0, pool: [], emax: 0 };
  for (const m of msgs) {
    if (/\[liveWriter\] failed\b/.test(m)) o.writerFailed++;
    else if (/\[liveWriter\]/.test(m)) { const f = kv(m); o.writer.push({ route: f.route ?? null, rev: num(f.rev), ok: f.ok === "true", acquireMs: num(f.acquireMs), execMs: num(f.execMs), at: num(f.at), instance: f.instance ?? null }); }
    if (/\[liveWarm\]/.test(m)) o.warmAny++;
    if (/\[liveWarm\] start\b/.test(m)) o.warmStart++;
    if (/\[liveWarm\] fault armed\b/.test(m)) o.warmArmed++;
    if (/\[setlist\] warm-lookup\b/.test(m)) o.warmLookup.push(kv(m).result ?? "?");
    if (/\[setlist\] hint-fetch\b/.test(m)) o.hintFetch.push(kv(m).verify ?? "?");
    if (/\[liveSnapshot\] build\s/.test(m)) o.builds++;
    if (/\[prisma\] pool\b/.test(m)) { const f = kv(m); o.pool.push({ total: num(f.total), instance: f.instance ?? null }); }
    if (/EMAXCONN/.test(m)) o.emax++;
  }
  return o;
}

/**
 * JSON records → the CLI's history-mode text, so vercel-logs-summary's
 * `summarise` (builds, writer, Σ buckets, EMAXCONN) runs unchanged on a
 * JSON export. Header times are UTC time-of-day (the record's
 * `timestamp` = request start, like history mode); map them back with
 * `todToEpoch(t, 0, refMs)`. A window that crosses UTC midnight is not
 * handled (same limitation as the text summariser).
 */
export function recordsToHistoryText(records) {
  const L = [];
  for (const r of records) {
    const t = new Date(r.timestamp ?? 0);
    const tod = `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}:${String(t.getUTCSeconds()).padStart(2, "0")}.${String(Math.floor(t.getUTCMilliseconds() / 10)).padStart(2, "0")}`;
    const level = ["info", "error", "warning", "fatal", "debug"].includes(r.level) ? r.level : "info";
    L.push(`${tod}  ${r.domain || "unknown.host"}  ${level}  λ ${r.requestMethod || "GET"} ${r.requestPath || "/"}`);
    const msgs = Array.isArray(r.logs) && r.logs.length ? r.logs.map((l) => l?.message ?? "") : [r.message ?? ""];
    for (const m of msgs) for (const line of String(m).split(/\r?\n/)) if (line.trim()) L.push(line);
    L.push("");
  }
  return L.join("\n");
}

// ─── manifest / deployment roles ───

/**
 * Role kind of a deployment: "R1" (the pre-R2 build — no warming code, no
 * verify header), "OFF" (LIVE_WARM_ENTRIES=0), "ON", or "unknown". The
 * manifest (written by the operator's deploy script) is the only source:
 * a deployment's role is never inferred from its logs, because the OFF /
 * R1 evidence is exactly the check that its logs match its declared role.
 */
export function roleKind(dep) {
  if (!dep) return "unknown";
  const role = String(dep.role ?? "");
  if (/^R1/i.test(role) || String(dep.commit ?? "").startsWith("385e5f0") || dep.build === "r1") return "R1";
  const flag = dep.effectiveFlag ?? dep.env?.LIVE_WARM_ENTRIES ?? null;
  if (/^OFF/i.test(role) || String(flag) === "0") return "OFF";
  if (/^ON/i.test(role) || String(flag) === "1") return "ON";
  return "unknown";
}

export function manifestIndex(manifest) {
  const deps = Array.isArray(manifest) ? manifest : manifest?.deployments ?? [];
  const byId = new Map();
  const byHost = new Map();
  for (const x of deps) {
    if (x?.id) byId.set(x.id, x);
    if (x?.url) { try { byHost.set(new URL(String(x.url).startsWith("http") ? x.url : `https://${x.url}`).host, x); } catch { /* bad url */ } }
  }
  return { deps, byId, byHost };
}

// ─── harness responses ───

const ID_KEYS = ["vercelId", "xVercelId", "reqId", "x-vercel-id", "vercel_id", "requestId"];
const POPS = ["sdk", "pages", "probe", "saves", "smoke", "guard", "documents", "assets"];
const POP_NAME = { sdk: "sdk", pages: "page", probe: "probe", saves: "save", smoke: "smoke", guard: "guard", documents: "document", assets: "asset" };

function rowObject(row, cols) {
  if (!Array.isArray(row)) return row;
  if (!Array.isArray(cols)) return null;
  const o = {};
  cols.forEach((c, i) => { o[c] = row[i]; });
  return o;
}

function pathOf(o) {
  const p = first(o, ["path", "url", "requestPath"]);
  if (p == null) return { path: null, host: o?.host ?? null, query: null };
  try {
    const u = new URL(String(p), "https://placeholder.invalid");
    return { path: u.pathname, host: o?.host ?? (u.host === "placeholder.invalid" ? null : u.host), query: u.searchParams };
  } catch {
    return { path: String(p).split("?")[0], host: o?.host ?? null, query: null };
  }
}

const bool = (v) => v === true || v === 1 || v === "1" || v === "true";

/** One harness row → the normalised response the join works on. */
export function normaliseResponse(o, pop, client = null) {
  if (!o || typeof o !== "object") return null;
  const { path: p, host, query } = pathOf(o);
  const notifyRaw = first(o, ["notify", "hinted"]);
  const notify = notifyRaw != null ? bool(notifyRaw) : query ? query.get("hint") === "1" : false;
  const pin = o.pin ?? { header: o.pinHeader ?? null, cookie: o.pinCookie ?? null, query: o.pinQuery ?? null };
  const cache = o.cache ?? { xVercelCache: o.xVercelCache ?? null, cacheControl: o.cacheControl ?? null, age: o.age ?? null };
  const popName = String(first(o, ["pop", "population"]) ?? pop ?? "?");
  const isSave = popName === "save" || popName === "saves";
  return {
    pop: POP_NAME[popName] ?? popName,
    client: first(o, ["client", "clientId", "idx", "who"]) ?? client,
    subset: o.subset ?? null,
    cohort: o.cohort ?? null,
    switchIdx: first(o, ["switchIdx", "leg"]),
    vercelId: first(o, ID_KEYS),
    reqId: reqIdOf(first(o, ID_KEYS)),
    tStart: num(first(o, isSave ? ["putStart", "tStart", "reqStart", "start", "sentAt"] : ["tStart", "reqStart", "start", "sentAt", "putStart"])),
    tEnd: num(first(o, isSave ? ["putEnd", "tEnd", "end", "respAt", "receivedAt", "t"] : ["tEnd", "end", "respAt", "receivedAt", "t", "putEnd"])),
    headersAt: num(first(o, ["headersAt", "tHeaders"])),
    bodyAt: num(first(o, ["bodyAt", "tBody"])),
    evalAt: num(first(o, ["evalAt", "tEval"])),
    settledAt: num(first(o, ["settledAt", "tSettled"])),
    queuedAt: num(o.queuedAt),
    method: String(o.method ?? (isSave ? "PUT" : "GET")).toUpperCase(),
    path: p, host,
    notify,
    minRev: num(o.minRev),
    hint: num(o.hint),
    reason: o.reason ?? null,
    status: num(o.status),
    bodyValid: o.bodyValid ?? null,
    rev: num(first(o, ["rev", "bodyRev"])),
    source: o.source ?? null,
    verify: o.verify ?? null,
    resolution: first(o, ["resolution", "hintRes"]),
    cache, pin,
    clientBuild: o.clientBuild ?? null,
    label: o.label ?? null,
    raw: o,
  };
}

/** Every response row the harness JSON holds, normalised. */
export function harnessResponses(json) {
  const tr = json?.transition ?? json ?? {};
  const out = [];
  const push = (o, pop, client) => { const r = normaliseResponse(o, pop, client); if (r) out.push(r); };
  for (const o of tr.responses ?? []) push(rowObject(o, tr.cols), o?.pop ?? null, null);
  for (const key of POPS) {
    const sec = tr[key];
    if (!sec) continue;
    const cols = sec.cols ?? sec.reqCols ?? null;
    if (Array.isArray(sec)) { for (const o of sec) push(rowObject(o, cols), key, null); continue; }
    for (const arrKey of ["responses", "reqs", "rows"]) for (const o of sec[arrKey] ?? []) push(rowObject(o, cols), key, null);
    for (const c of sec.clients ?? []) for (const o of c.reqs ?? []) {
      const r = rowObject(o, cols);
      if (r && typeof r === "object") push({ cohort: c.cohort ?? null, subset: c.subset ?? null, ...r }, key, c.idx ?? c.client ?? null);
    }
  }
  return out;
}

// ─── attribution ───

/**
 * Join responses to log records by request id.
 * `logsByDep` = Map(dplId → records[]). The record's own `deploymentId`
 * is the attribution (the file key only names where it came from).
 * Expected instrumentation depends on the serving deployment's role kind
 * (manifest): a 2xx save must carry a `[liveWriter]` line (any role); a
 * hinted /api/setlist read on an R2 deployment (ON / OFF / unknown-R2)
 * must carry a `[setlist] hint-fetch` line; R1 never logs hint-fetch.
 */
export function attribute(responses, logsByDep, { manifest = null } = {}) {
  const idx = new Map();
  for (const [, recs] of logsByDep) for (const r of recs) {
    if (!r?.id) continue;
    const cur = idx.get(r.id);
    if (!cur || logCount(r) > logCount(cur)) idx.set(r.id, r);
  }
  const man = manifestIndex(manifest);
  return responses.map((x) => {
    const rec = x.reqId ? idx.get(x.reqId) ?? null : null;
    const a = { matched: !!rec, deploymentId: rec?.deploymentId ?? null, recordTs: rec?.timestamp ?? null, consistent: false, mismatch: [], instrumented: null, expected: [], lines: null };
    if (!x.reqId) a.mismatch.push("no request id recorded");
    else if (!rec) a.mismatch.push("no log record with this id");
    if (rec) {
      if (x.path && rec.requestPath && rec.requestPath !== x.path) a.mismatch.push(`path ${rec.requestPath} ≠ ${x.path}`);
      if (x.status != null && x.status !== 0 && rec.responseStatusCode != null && Number(rec.responseStatusCode) !== x.status) a.mismatch.push(`status ${rec.responseStatusCode} ≠ ${x.status}`);
      if (x.method && rec.requestMethod && rec.requestMethod !== x.method) a.mismatch.push(`method ${rec.requestMethod} ≠ ${x.method}`);
      if (!rec.deploymentId) a.mismatch.push("record has no deploymentId");
      a.consistent = a.mismatch.length === 0;
      const lines = linesOf(rec);
      a.lines = lines;
      const kind = roleKind(man.byId.get(rec.deploymentId));
      const ok2xx = x.status != null && x.status >= 200 && x.status < 300;
      if (x.pop === "save" && ok2xx) a.expected.push("writer");
      if (x.notify && (x.path ?? "").startsWith("/api/setlist") && kind !== "R1" && ok2xx) a.expected.push("hint-fetch");
      if (a.expected.length) {
        a.instrumented = a.expected.every((e) => (e === "writer" ? lines.writer.length > 0 : lines.hintFetch.length > 0));
      }
    }
    return { ...x, attr: a };
  });
}

export function attributionSummary(rows) {
  const groups = new Map();
  const add = (k, r) => {
    if (!groups.has(k)) groups.set(k, { key: k, n: 0, withId: 0, matched: 0, consistent: 0, unmatched: 0, inconsistent: 0, instrExpected: 0, instrumented: 0, byDep: {} });
    const g = groups.get(k);
    g.n++;
    if (r.reqId) g.withId++;
    if (r.attr.matched) g.matched++; else g.unmatched++;
    if (r.attr.consistent) g.consistent++;
    else if (r.attr.matched) g.inconsistent++;
    if (r.attr.instrumented != null) { g.instrExpected++; if (r.attr.instrumented) g.instrumented++; }
    const dep = r.attr.deploymentId ?? "(unmatched)";
    g.byDep[dep] = (g.byDep[dep] || 0) + 1;
  };
  for (const r of rows) { add(`${r.pop}${r.subset ? `/${r.subset}` : ""}`, r); add("ALL", r); }
  return [...groups.values()]
    .sort((a, b) => (a.key === "ALL") - (b.key === "ALL") || a.key.localeCompare(b.key))
    .map((g) => ({ ...g, coverage: g.n ? g.consistent / g.n : null }));
}

/** Per-deployment coverage: matched responses vs log records seen. */
export function perDeployment(rows, logsByDep) {
  const out = [];
  for (const [dep, recs] of logsByDep) {
    const mine = rows.filter((r) => r.attr.deploymentId === dep);
    out.push({ dep, records: recs.length, matchedResponses: mine.length, consistent: mine.filter((r) => r.attr.consistent).length, first: recs.length ? recs[0].timestamp : null, last: recs.length ? recs[recs.length - 1].timestamp : null });
  }
  return out;
}

/** record.timestamp − harness tStart over matched responses (ms). */
export function clockOffsets(rows) {
  const v = rows.filter((r) => r.attr.matched && r.attr.recordTs != null && r.tStart != null).map((r) => r.attr.recordTs - r.tStart);
  return { n: v.length, p5: pct(v, 0.05), p50: pct(v, 0.5), p95: pct(v, 0.95), min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null };
}

// ─── switches ───

export function mergeSwitches(fromJson = [], files = []) {
  const n = Math.max(fromJson.length, files.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = fromJson[i] ?? {};
    const b = files[i] ?? {};
    out.push({ ...a, ...b, target: { ...(a.target ?? {}), ...(b.target ?? {}) }, idx: i });
  }
  return out;
}

/** Target / old deployment id of each switch (manifest host lookup for a url-only target). */
export function resolveSwitches(switches, { manifest = null, initial = null } = {}) {
  const man = manifestIndex(manifest);
  const idOf = (t) => {
    if (!t) return null;
    if (t.id) return t.id;
    if (t.url) { try { return man.byHost.get(new URL(String(t.url).startsWith("http") ? t.url : `https://${t.url}`).host)?.id ?? null; } catch { return null; } }
    return null;
  };
  let prev = initial;
  return switches.map((s) => {
    const targetId = idOf(s.target);
    const fromId = idOf(s.from) ?? prev;
    prev = targetId ?? prev;
    return { ...s, targetId, fromId };
  });
}

const ALIAS_POPS = new Set(["sdk", "page", "probe"]);

/**
 * Propagation profile of one switch, from harness times + attribution.
 * Bounds (all harness clock):
 *   firstTarget       first response attributed to the target (tEnd), per population;
 *   lastOldStart      latest request START attributed to the old deployment;
 *   lastOldEnd        latest response COMPLETION attributed to the old deployment
 *                     (an old request finishing after a target response is not
 *                     continued old routing — both are shown);
 *   sustained         the predeclared window [cliEnd, cliEnd + sustainMs]: every
 *                     probe request that started there after the first target
 *                     probe went to the target (0 flip-backs) and the probe
 *                     covered the window (no gap > 3 s).
 * Complete attribution of the probe requests that define the bounds
 * (started in [cliStart − 10 s, cliEnd + sustainMs]) is REQUIRED: one
 * unmatched probe there and the profile is NOT EXERCISED (behavioural
 * verdicts are unaffected).
 */
export function propagation(sw, rows, { sustainMs = 60_000, legEnd = Infinity } = {}) {
  const lo = (sw.cliStart ?? sw.plannedAt ?? 0) - 10_000;
  const sEnd = (sw.cliEnd ?? sw.cliStart ?? 0) + sustainMs;
  const inLeg = rows.filter((r) => ALIAS_POPS.has(r.pop) && r.tStart != null && r.tStart >= lo - 50_000 && r.tStart < legEnd);
  const per = {};
  const bounds = (rs) => {
    const tgt = rs.filter((r) => r.attr.deploymentId && r.attr.deploymentId === sw.targetId);
    const old = rs.filter((r) => r.attr.deploymentId && r.attr.deploymentId === sw.fromId);
    const ft = tgt.reduce((m, r) => (r.tEnd != null && (m == null || r.tEnd < m.tEnd) ? r : m), null);
    const afterCli = old.filter((r) => r.tStart >= (sw.cliStart ?? 0));
    return {
      n: rs.length, target: tgt.length, old: old.length,
      other: rs.filter((r) => r.attr.deploymentId && r.attr.deploymentId !== sw.targetId && r.attr.deploymentId !== sw.fromId).length,
      unmatched: rs.filter((r) => !r.attr.matched).length,
      firstTarget: ft ? { tStart: ft.tStart, tEnd: ft.tEnd, client: ft.client } : null,
      lastOldStart: afterCli.length ? Math.max(...afterCli.map((r) => r.tStart)) : null,
      lastOldEnd: old.some((r) => r.tEnd != null) ? Math.max(...old.filter((r) => r.tEnd != null).map((r) => r.tEnd)) : null,
      oldStartsAfterCliStart: afterCli.length,
    };
  };
  for (const p of ["probe", "sdk", "page"]) per[p] = bounds(inLeg.filter((r) => r.pop === p));
  per.all = bounds(inLeg);

  const probes = inLeg.filter((r) => r.pop === "probe").sort((a, b) => a.tStart - b.tStart);
  const defining = probes.filter((r) => r.tStart >= lo && r.tStart <= sEnd);
  const unattributed = defining.filter((r) => !r.attr.consistent);
  const win = probes.filter((r) => r.tStart >= (sw.cliEnd ?? 0) && r.tStart <= sEnd);
  const ftp = per.probe.firstTarget;
  const flipBacks = ftp ? win.filter((r) => r.tStart > ftp.tStart && r.attr.deploymentId === sw.fromId).length : null;
  let maxGap = null;
  const pts = [sw.cliEnd, ...win.map((r) => r.tStart), sEnd].filter((v) => v != null);
  for (let i = 1; i < pts.length; i++) maxGap = Math.max(maxGap ?? 0, pts[i] - pts[i - 1]);
  const lastInWin = win[win.length - 1] ?? null;
  const sustained = ftp != null && flipBacks === 0 && maxGap != null && maxGap <= 3_000 && lastInWin?.attr.deploymentId === sw.targetId;
  const exercised = defining.length > 0 && unattributed.length === 0 && sw.targetId != null;
  return {
    status: exercised ? "EXERCISED" : "NOT EXERCISED",
    why: !sw.targetId ? "target deployment id unknown" : !defining.length ? "no probe requests in the defining window" : unattributed.length ? `${unattributed.length}/${defining.length} defining probe request(s) not attributed` : null,
    cliStart: sw.cliStart ?? null, cliEnd: sw.cliEnd ?? null, sustainMs, window: { from: lo, to: sEnd },
    per, sustained: { ok: sustained, probes: win.length, flipBacks, maxGapMs: maxGap },
    unattributed: unattributed.map((r) => ({ tStart: r.tStart, reqId: r.reqId, why: r.attr.mismatch.join("; ") })),
    // The instant exposure is measured against: the first attributed target
    // response over ALL alias populations (the moment target routing
    // demonstrably began for anyone).
    firstTargetT: per.all.firstTarget?.tEnd ?? null,
  };
}

// ─── exposure ───

const distinct = (rs) => new Set(rs.map((r) => String(r.client))).size;

/**
 * Exposure finalisation for one switch (design §2):
 *   pendingHinted   natural SDK hinted fetches (no controlled subset)
 *                   dispatched before cliStart whose outcome was still
 *                   unresolved after the first attributed target response
 *                   (settledAt, else tEnd); stages counted apart; ≥ 20
 *                   distinct clients; old-deployment attribution shown.
 *   pendingRecheck  the controlled ahead-hint subset: ticket queued before
 *                   cliStart, recheck resolved after the first target
 *                   response; "queued" = dispatched after it (the recheck
 *                   itself crossed), "dispatched" = in flight across it; ≥ 5.
 *   oldAfterCutover clients that received an OLD-deployment answer after
 *                   the first target response and later got a target
 *                   answer with rev ≥ it, without regression; ≥ 5.
 */
export function exposure(sw, prop, rows, { rechecks = null, clients = [] } = {}) {
  const T = prop.firstTargetT;
  const out = { firstTargetT: T };
  if (T == null || sw.cliStart == null) {
    const nx = { exercised: false, why: "no attributed target response / no cliStart" };
    return { ...out, pendingHinted: nx, pendingRecheck: nx, oldAfterCutover: nx };
  }
  const resolvedAt = (r) => r.settledAt ?? r.evalAt ?? r.bodyAt ?? r.tEnd;
  const sdk = rows.filter((r) => r.pop === "sdk");
  const ph = sdk.filter((r) => r.notify && r.tStart != null && r.tStart < sw.cliStart && (resolvedAt(r) == null || resolvedAt(r) > T));
  const nat = ph.filter((r) => !r.subset);
  out.pendingHinted = {
    clients: distinct(nat), min: EXPOSURE_MIN.pendingHinted, exercised: distinct(nat) >= EXPOSURE_MIN.pendingHinted,
    requests: nat.length, oldAttributed: nat.filter((r) => r.attr.deploymentId === sw.fromId).length, unmatched: nat.filter((r) => !r.attr.matched).length,
    stagesAfterT: {
      headers: nat.filter((r) => r.headersAt != null && r.headersAt > T).length,
      body: nat.filter((r) => r.bodyAt != null && r.bodyAt > T).length,
      eval: nat.filter((r) => r.evalAt != null && r.evalAt > T).length,
      settled: nat.filter((r) => r.settledAt != null && r.settledAt > T).length,
    },
    subsets: Object.fromEntries([...new Set(ph.filter((r) => r.subset).map((r) => r.subset))].map((s) => [s, distinct(ph.filter((r) => r.subset === s))])),
  };

  // Rechecks: explicit records, else recheck responses of the subset.
  const rc = rechecks ?? sdk.filter((r) => r.reason === "recheck" && r.subset).map((r) => ({ client: r.client, queuedAt: r.queuedAt, dispatchedAt: r.tStart, settledAt: resolvedAt(r), subset: r.subset }));
  const spanning = rc.filter((x) => x.queuedAt != null && x.queuedAt < sw.cliStart && (x.settledAt == null || x.settledAt > T));
  const queued = spanning.filter((x) => x.dispatchedAt == null || x.dispatchedAt > T);
  const dispatched = spanning.filter((x) => x.dispatchedAt != null && x.dispatchedAt <= T);
  const nrc = new Set(spanning.map((x) => String(x.client))).size;
  out.pendingRecheck = {
    clients: nrc, min: EXPOSURE_MIN.pendingRecheck, exercised: nrc >= EXPOSURE_MIN.pendingRecheck,
    queued: new Set(queued.map((x) => String(x.client))).size, dispatched: new Set(dispatched.map((x) => String(x.client))).size,
    source: rechecks ? "transition.rechecks" : "recheck responses of the controlled subset",
  };

  // Old answer after cutover → converge.
  const clientRec = new Map(clients.map((c) => [String(c.idx ?? c.client), c]));
  const byClient = new Map();
  for (const r of rows.filter((x) => ALIAS_POPS.has(x.pop) && x.client != null)) {
    const k = String(r.client);
    if (!byClient.has(k)) byClient.set(k, []);
    byClient.get(k).push(r);
  }
  const hits = [];
  for (const [k, rs] of byClient) {
    const late = rs.filter((r) => r.attr.deploymentId === sw.fromId && r.tEnd != null && r.tEnd > T && r.status === 200);
    if (!late.length) continue;
    const o = late[late.length - 1];
    const follow = rs.find((r) => r.tStart != null && r.tStart >= o.tEnd && r.attr.deploymentId === sw.targetId && r.status === 200 && r.rev != null && (o.rev == null || r.rev >= o.rev));
    const c = clientRec.get(k);
    let regressions = null;
    if (c?.appliedAll) { regressions = 0; let prev = -Infinity; for (const a of c.appliedAll) { if (a[1] < prev) regressions++; prev = Math.max(prev, a[1]); } }
    else if (c?.regressions != null) regressions = c.regressions;
    hits.push({ client: k, subset: o.subset, oldRev: o.rev, oldEnd: o.tEnd, followRev: follow?.rev ?? null, followEnd: follow?.tEnd ?? null, converged: !!follow && (regressions == null || regressions === 0), regressions });
  }
  const conv = hits.filter((h) => h.converged);
  out.oldAfterCutover = {
    clients: hits.length, converged: conv.length, min: EXPOSURE_MIN.oldAfterCutover, exercised: conv.length >= EXPOSURE_MIN.oldAfterCutover,
    natural: conv.filter((h) => !h.subset).length, controlled: conv.filter((h) => h.subset).length,
    regressionCheck: hits.some((h) => h.regressions != null) ? "client appliedAll" : "n/a (no client records)",
    rows: hits.slice(0, 40),
  };
  return out;
}

/**
 * Arrival exposure of a save (+11 / +15 s): SDK arrivals not yet joined
 * at the PUT response (≥ 20) and arrival pages not yet complete (≥ 3),
 * classified independently.
 */
export function arrivalExposure(save, sdkClients, pageClients, switchIdx) {
  const arr = (c) => c.cohort === "arrival" && (c.switchIdx == null || switchIdx == null || c.switchIdx === switchIdx);
  const sdk = sdkClients.filter(arr);
  const pages = pageClients.filter(arr);
  const notJoined = sdk.filter((c) => { const f = firstSub(c); return f == null || f > save.putEnd; }).length;
  const incomplete = pages.filter((p) => p.navStart != null && p.navStart <= save.putEnd && (p.completeAt == null || p.completeAt > save.putEnd)).length;
  return {
    sdk: { arrivals: sdk.length, notJoined, exercised: notJoined >= EXPOSURE_MIN.arrivalSdk },
    pages: { arrivals: pages.length, incomplete, exercised: incomplete >= EXPOSURE_MIN.arrivalPages },
  };
}

// ─── positive OFF / R1 evidence ───

/**
 * OFF absence is claimed only with POSITIVE evidence (Codex round 1/3):
 * the manifest records the env (LIVE_WARM_ENTRIES=0) for the deployment;
 * every 2xx save served by it in the leg is attributed AND carries its
 * writer line (full writer-log coverage — a save whose nested lines are
 * missing could also be missing its `[liveWarm] start`); every hinted read
 * in the leg is attributed (an unmatched read could have been a warm
 * hit); then 0 `[liveWarm] start`, 0 warm-lookup lines (whole export of
 * that deployment) and 0 `source=warm` responses attributed to it.
 * R1: 0 `[liveWarm]` lines of any kind and 0 responses carrying a verify
 * header. Anything short → NOT EXERCISED for the absence claim.
 */
export function roleEvidence(sw, rows, depRecs, manifest, { legFrom, legTo }) {
  const man = manifestIndex(manifest);
  const dep = man.byId.get(sw.targetId) ?? null;
  const kind = roleKind(dep);
  const lines = (depRecs ?? []).map(linesOf);
  const sum = (f) => lines.reduce((a, l) => a + f(l), 0);
  const inLeg = rows.filter((r) => r.tStart != null && r.tStart >= legFrom && r.tStart < legTo);
  const onDep = rows.filter((r) => r.attr.deploymentId === sw.targetId);
  const saves = inLeg.filter((r) => r.pop === "save" && r.status != null && r.status >= 200 && r.status < 300);
  const savesOnDep = saves.filter((r) => r.attr.deploymentId === sw.targetId);
  const hinted = inLeg.filter((r) => r.notify && ALIAS_POPS.has(r.pop) && r.status === 200);
  const base = {
    kind, role: dep?.role ?? null, manifestEnv: dep?.env ?? null, effectiveFlag: dep?.effectiveFlag ?? dep?.env?.LIVE_WARM_ENTRIES ?? null,
    logRecords: (depRecs ?? []).length,
    warmStart: sum((l) => l.warmStart), warmAny: sum((l) => l.warmAny), warmLookups: sum((l) => l.warmLookup.length),
    warmResponses: onDep.filter((r) => r.source === "warm").length,
    verifyResponses: onDep.filter((r) => r.pop !== "save" && r.status === 200 && r.verify != null && r.verify !== "" && r.verify !== "missing").length,
    saves: saves.length, savesAttributedToTarget: savesOnDep.length,
    savesWithWriterLine: savesOnDep.filter((r) => r.attr.lines?.writer.length > 0).length,
    savesUnattributed: saves.filter((r) => !r.attr.consistent).length,
    hinted: hinted.length, hintedUnattributed: hinted.filter((r) => !r.attr.consistent).length,
  };
  if (kind === "OFF") {
    const envOk = String(base.effectiveFlag) === "0";
    const writerFull = base.saves > 0 && base.savesUnattributed === 0 && base.savesWithWriterLine === base.saves;
    const reads = base.hintedUnattributed === 0;
    const zero = base.warmStart === 0 && base.warmLookups === 0 && base.warmResponses === 0;
    const missing = [!envOk && "manifest env LIVE_WARM_ENTRIES=0", !writerFull && "full writer-log coverage of the leg's saves", !reads && "attribution of every hinted read"].filter(Boolean);
    return { ...base, claim: "OFF absence", status: missing.length ? "NOT EXERCISED" : zero ? "PASS" : "FAIL", missing };
  }
  if (kind === "R1") {
    const reads = base.hintedUnattributed === 0 && onDep.length > 0;
    const zero = base.warmAny === 0 && base.verifyResponses === 0;
    const missing = [!reads && "attribution of every read in the leg"].filter(Boolean);
    return { ...base, claim: "R1 (no warming, no verify header)", status: missing.length ? "NOT EXERCISED" : zero ? "PASS" : "FAIL", missing };
  }
  return { ...base, claim: kind === "ON" ? "ON (warming expected)" : "role unknown (no manifest entry)", status: kind === "ON" ? (base.warmStart > 0 ? "warm jobs seen" : "no warm job seen") : "n/a", missing: [] };
}

// ─── resources across deployments ───

function summariseRecs(recs, { from, to, bucketS, carryS }) {
  if (!recs.length) return null;
  const s = summarise(recordsToHistoryText(recs), { bucketS, carryS });
  const ref = recs[0].timestamp;
  const ep = (t) => todToEpoch(t, 0, ref);
  const buckets = s.poolBuckets.map((b) => ({ ...b, at: ep(b.t) })).filter((b) => b.at >= from && b.at <= to);
  const peak = buckets.reduce((m, b) => (b.carried > (m?.carried ?? -1) ? b : m), null);
  const writers = recs.flatMap((r) => linesOf(r).writer);
  const acq = writers.map((w) => w.acquireMs).filter((v) => v != null);
  const perMinute = new Map();
  for (const r of recs) {
    if (r.timestamp < from || r.timestamp > to) continue;
    const m = Math.floor(r.timestamp / 60000) * 60000;
    if (!perMinute.has(m)) perMinute.set(m, { minute: m, requests: 0, builds: 0 });
    const g = perMinute.get(m);
    g.requests++;
    g.builds += linesOf(r).builds;
  }
  return {
    sigma: peak ? { at: peak.at, carried: peak.carried, reported: peak.reported, instances: peak.carriedInstances } : null,
    buckets, emax: recs.filter((r) => r.timestamp >= from && r.timestamp <= to).reduce((a, r) => a + linesOf(r).emax, 0),
    writerAcquireMax: acq.length ? Math.max(...acq) : null, writers: writers.length,
    perMinute: [...perMinute.values()].sort((a, b) => a.minute - b.minute),
  };
}

export function resources(logsByDep, { from, to, bucketS = 5, carryS = 5 }) {
  const per = [];
  for (const [dep, recs] of logsByDep) per.push({ dep, ...(summariseRecs(recs, { from, to, bucketS, carryS }) ?? {}) });
  // Combined Σ: instance ids are per deployment, so one summarise over the
  // union sums every deployment's instances in the same bucket.
  const all = [...logsByDep.values()].flat().sort((a, b) => a.timestamp - b.timestamp);
  const combined = summariseRecs(all, { from, to, bucketS, carryS });
  return { per, combined, bucketS, carryS };
}

/** Old-deployment activity after the switch, in 10 s buckets. */
export function drain(sw, oldRecs, { T, until, bucketMs = 10_000 }) {
  if (!oldRecs || T == null) return null;
  const after = oldRecs.filter((r) => r.timestamp >= T && r.timestamp <= until);
  const buckets = new Map();
  for (const r of after) {
    const b = T + Math.floor((r.timestamp - T) / bucketMs) * bucketMs;
    if (!buckets.has(b)) buckets.set(b, { at: b, requests: 0, poolLines: 0, poolMax: null, instances: new Set() });
    const g = buckets.get(b);
    g.requests++;
    const l = linesOf(r);
    for (const p of l.pool) { g.poolLines++; g.poolMax = Math.max(g.poolMax ?? 0, p.total ?? 0); if (p.instance) g.instances.add(p.instance); }
  }
  const pools = after.filter((r) => linesOf(r).pool.length);
  return {
    from: T, requestsAfter: after.length, lastRequest: after.length ? after[after.length - 1].timestamp : null,
    lastPoolLine: pools.length ? pools[pools.length - 1].timestamp : null,
    buckets: [...buckets.values()].sort((a, b) => a.at - b.at).map((g) => ({ ...g, instances: g.instances.size })),
  };
}

// ─── continuity / performance ───

const dist = (v) => ({ n: v.length, p50: pct(v, 0.5), p95: pct(v, 0.95), max: v.length ? Math.max(...v) : null });

/**
 * Per save, per SDK group (cohort × subset): eligible incumbents
 * (subscribed by the PUT start) must reach ≥ rev within 30 s of the first
 * save attempt (continuity) and are timed for the p95 ≤ 3 s target
 * (performance); clients that joined after are reported apart (their
 * clock is max(join, PUT response)). Supersession counts: any applied
 * rev ≥ the save's rev converges it. Controlled subsets are their own
 * groups, never pooled into natural performance.
 */
export function continuity(saves, sdkClients) {
  const groups = new Map();
  for (const c of sdkClients) {
    const k = `${c.cohort ?? "incumbent"}${c.subset ? `/${c.subset}` : ""}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  return saves.filter((s) => s.rev != null && s.status >= 200 && s.status < 300).map((s) => {
    const clock = { ...s, putStart: s.firstAttemptAt ?? s.putStart };
    const per = [...groups.entries()].map(([k, cs]) => {
      const cv = sdkConvergence(cs, clock, { timeoutMs: CONTINUITY_MS });
      const rr = receiptVsReason(cs, s);
      let regressions = 0;
      for (const c of cs) { let prev = -Infinity; for (const a of c.appliedAll ?? []) { if (a[1] < prev) regressions++; prev = Math.max(prev, a[1]); } }
      const b = dist(cv.before.values);
      return {
        group: k, clients: cs.length, eligible: b.n + cv.before.missing, before: { ...b, missing: cv.before.missing },
        after: { ...dist(cv.after.values), missing: cv.after.missing }, notJoined: cv.notJoined,
        // No eligible incumbent (e.g. an arrival cohort that joined after the
        // save) → nothing to accept: "n/a", never a vacuous PASS.
        continuity30s: b.n + cv.before.missing === 0 ? "n/a" : cv.before.missing === 0 ? "PASS" : "FAIL", perf3s: b.p95 == null ? "n/a" : b.p95 <= PERF_P95_MS ? "PASS" : "FAIL",
        received: rr.received, population: rr.population, reasons: rr.reasons, regressions,
      };
    });
    return { k: s.k ?? null, rev: s.rev, leg: s.leg ?? null, label: s.label ?? null, putStart: s.putStart, per };
  });
}

/**
 * R1 cohort: per postgres_changes receipt after the switch (INSERT /
 * UPDATE / soft-delete = UPDATE with isDeleted), the page's next
 * /api/setlist fetch and next DOM change. DOM before EARLIEST_REPAIR_MS
 * = driven by the receipt, not by the periodic repair.
 */
export function r1Cohort(pages, from) {
  const types = new Map();
  for (const p of pages.filter((x) => x.cohort === "r1")) {
    for (const n of p.notes ?? []) {
      const [t, type, , isDel] = n;
      if (t < from) continue;
      const k = type === "U" && bool(isDel) ? "soft-delete" : type === "I" ? "INSERT" : type === "U" ? "UPDATE" : type === "D" ? "DELETE" : String(type);
      if (!types.has(k)) types.set(k, { type: k, receipts: 0, pages: new Set(), fetchMs: [], domMs: [], domBeforeRepair: 0, noFetch: 0, noDom: 0 });
      const g = types.get(k);
      g.receipts++;
      g.pages.add(p.idx);
      const f = (p.fetches ?? []).find((x) => (x[7] ?? x[0]) >= t);
      if (f) g.fetchMs.push((f[7] ?? f[0]) - t); else g.noFetch++;
      const dm = (p.dom ?? []).find((x) => x[0] >= t);
      if (dm) { g.domMs.push(dm[0] - t); if (dm[0] - t < EARLIEST_REPAIR_MS) g.domBeforeRepair++; } else g.noDom++;
    }
  }
  return [...types.values()].map((g) => ({ ...g, pages: g.pages.size, fetch: dist(g.fetchMs), dom: dist(g.domMs), fetchMs: undefined, domMs: undefined }));
}

/**
 * Existing-ON return: each alias client's FIRST response from the target
 * after target routing began, against the committed head at its request
 * start (highest 2xx save rev whose PUT response preceded it). Recorded,
 * not a gate by itself (a generic read can legitimately join an older
 * in-flight build); what the return adds is the old cache namespace.
 */
export function staleFirstAnswers(sw, prop, rows, saves) {
  const T = prop.firstTargetT;
  if (T == null) return null;
  const firsts = new Map();
  for (const r of rows.filter((x) => ALIAS_POPS.has(x.pop) && x.attr.deploymentId === sw.targetId && x.status === 200 && x.tStart != null && x.tEnd >= T).sort((a, b) => a.tStart - b.tStart)) {
    const k = `${r.pop}:${r.client}`;
    if (!firsts.has(k)) firsts.set(k, r);
  }
  const ok = saves.filter((s) => s.status >= 200 && s.status < 300 && s.rev != null);
  const per = {};
  for (const r of firsts.values()) {
    const head = ok.filter((s) => s.putEnd < r.tStart).reduce((m, s) => Math.max(m, s.rev), -Infinity);
    const g = (per[r.pop] ??= { pop: r.pop, n: 0, stale: 0, unknown: 0, source: {}, staleRevs: {} });
    g.n++;
    g.source[r.source ?? "none"] = (g.source[r.source ?? "none"] || 0) + 1;
    if (r.rev == null || head === -Infinity) g.unknown++;
    else if (r.rev < head) { g.stale++; g.staleRevs[r.rev] = (g.staleRevs[r.rev] || 0) + 1; }
  }
  return Object.values(per);
}

// ─── the join ───

export function join(json, { logsByDep = new Map(), switchFiles = [], manifest = null, sustainMs = 60_000, bucketS = 5, carryS = 5 } = {}) {
  const tr = json?.transition;
  if (!tr) throw new Error("browsers JSON has no `transition` section (not a step-6 run)");
  const man = manifest ?? tr.manifest ?? null;
  const responses = harnessResponses(json);
  // Saves are responses too (attributed by their own x-vercel-id):
  // harnessResponses reads transition.saves as the `save` population.
  const rows = attribute(responses, logsByDep, { manifest: man });
  const saves = (tr.saves ?? []).map((s) => ({ ...s, putStart: num(s.putStart), putEnd: num(s.putEnd), status: num(s.status), rev: num(s.rev) }));
  const switches = resolveSwitches(mergeSwitches(tr.switches ?? [], switchFiles), { manifest: man, initial: tr.initialDeploymentId ?? tr.incumbent?.id ?? null });
  const sdkClients = tr.sdk?.clients ?? [];
  const pageClients = tr.pages?.clients ?? [];
  const tAll = rows.flatMap((r) => [r.tStart, r.tEnd]).filter((v) => v != null);
  const runFrom = tAll.length ? Math.min(...tAll) : null;
  const runTo = tAll.length ? Math.max(...tAll) : null;

  const legs = switches.map((sw, i) => {
    const next = switches[i + 1];
    const legTo = next ? (next.cliStart ?? next.plannedAt ?? Infinity) - 30_000 - 5_000 : Infinity;
    const legFrom = (sw.cliStart ?? sw.plannedAt ?? 0) - 35_000;
    const prop = propagation(sw, rows, { sustainMs, legEnd: legTo });
    const rechecks = tr.rechecks ? tr.rechecks.filter((x) => x.switchIdx == null || x.switchIdx === i) : null;
    const exp = exposure(sw, prop, rows.filter((r) => r.tStart == null || (r.tStart >= legFrom - 60_000 && r.tStart < legTo)), { rechecks, clients: sdkClients });
    const legSaves = saves.filter((s) => (s.leg != null ? s.leg === i : s.putStart >= legFrom && s.putStart < legTo));
    const arrivalSaves = legSaves.filter((s) => s.arrival || [11_000, 15_000].includes(s.scheduledOffsetMs)).map((s) => ({ k: s.k ?? null, rev: s.rev, scheduledOffsetMs: s.scheduledOffsetMs ?? null, ...arrivalExposure(s, sdkClients, pageClients, i) }));
    const role = sw.targetId ? roleEvidence(sw, rows, logsByDep.get(sw.targetId), man, { legFrom, legTo }) : null;
    const seenBefore = switches.slice(0, i).some((x) => x.targetId === sw.targetId || x.fromId === sw.targetId);
    const isReturn = sw.kind === "existing-return" || (sw.targetId != null && seenBefore);
    return {
      idx: i, name: sw.name ?? `switch ${i + 1}`, kind: sw.kind ?? null, plannedAt: sw.plannedAt ?? null, cliStart: sw.cliStart ?? null, cliEnd: sw.cliEnd ?? null, cliCpuMs: sw.cliCpuMs ?? null,
      targetId: sw.targetId, targetUrl: sw.target?.url ?? null, fromId: sw.fromId, legFrom, legTo: Number.isFinite(legTo) ? legTo : null,
      propagation: prop, exposure: { ...exp, arrivalSaves }, role,
      drain: sw.fromId && sw.fromId !== sw.targetId ? drain(sw, logsByDep.get(sw.fromId), { T: prop.firstTargetT, until: Number.isFinite(legTo) ? legTo : (runTo ?? Infinity) }) : null,
      continuity: continuity(legSaves, sdkClients),
      stale: isReturn ? staleFirstAnswers(sw, prop, rows, saves) : null,
      isReturn,
      r1Cohort: pageClients.some((p) => p.cohort === "r1") && sw.cliStart != null ? r1Cohort(pageClients, sw.cliStart) : null,
    };
  });

  const res = runFrom != null ? resources(logsByDep, { from: runFrom - 10_000, to: runTo + 30_000, bucketS, carryS }) : null;
  const unmatched = rows.filter((r) => !r.attr.consistent).map((r) => {
    const near = switches.map((s) => (s.cliStart != null && r.tStart != null ? { i: s.idx, dt: r.tStart - s.cliStart } : null)).filter(Boolean).sort((a, b) => Math.abs(a.dt) - Math.abs(b.dt))[0] ?? null;
    return { pop: r.pop, subset: r.subset, client: r.client, tStart: r.tStart, status: r.status, path: r.path, reqId: r.reqId, why: r.attr.mismatch.join("; "), nearestSwitch: near };
  });
  return {
    label: json.config?.label ?? tr.config?.label ?? null, base: json.config?.base ?? null, runFrom, runTo,
    deployments: manifestIndex(man).deps.map((x) => ({ id: x.id, role: x.role ?? null, kind: roleKind(x), commit: x.commit ?? null, url: x.url ?? null, flag: x.effectiveFlag ?? x.env?.LIVE_WARM_ENTRIES ?? null })),
    attribution: { summary: attributionSummary(rows), perDeployment: perDeployment(rows, logsByDep), clock: clockOffsets(rows), unmatched, pins: pinSummary(rows) },
    legs, resources: res,
    smoke: (tr.smoke ?? []).map((s) => { const r = rows.find((x) => x.pop === "smoke" && x.reqId && x.reqId === reqIdOf(first(s, ID_KEYS))); return { ...s, attributedTo: r?.attr.deploymentId ?? null }; }),
    arrivals: tr.arrivals ?? null,
    harnessVerdicts: tr.verdicts ?? null,
  };
}

export function pinSummary(rows) {
  const per = {};
  for (const r of rows) {
    const g = (per[r.pop] ??= { pop: r.pop, n: 0, header: 0, cookie: 0, query: 0, none: 0 });
    g.n++;
    const h = !!r.pin?.header, c = !!r.pin?.cookie, q = !!r.pin?.query;
    if (h) g.header++;
    if (c) g.cookie++;
    if (q) g.query++;
    if (!h && !c && !q) g.none++;
  }
  return Object.values(per);
}

// ─── markdown ───

const pctS = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)} %`);
const yes = (b) => (b ? "**EXERCISED**" : "**NOT EXERCISED**");

export function toMarkdown(j, { source = "" } = {}) {
  const L = [];
  L.push(`# Step 6 transition join${j.label ? ` — ${j.label}` : ""}`);
  L.push("");
  if (source) L.push(`- Inputs: ${source}`);
  L.push(`- Base ${j.base ?? "—"}; run ${iso(j.runFrom)} → ${iso(j.runTo)}`);
  const c = j.attribution.clock;
  L.push(`- Clocks: harness, switch files (CLI start / end) and smoke = this laptop; log \`timestamp\` = Vercel edge arrival; writer \`at\` = the function. Propagation bounds use harness times only. Record − harness request start over ${c.n} matched responses: p5 ${d(c.p5)} / p50 ${d(c.p50)} / p95 ${d(c.p95)} ms (min ${d(c.min)}, max ${d(c.max)}) — one-way latency plus clock offset; bounds closer than this spread are indeterminate.`);
  L.push("");
  if (j.deployments.length) {
    L.push("## Deployments (manifest)");
    L.push("");
    L.push("| id | role | kind | commit | LIVE_WARM_ENTRIES | url |");
    L.push("|---|---|---|---|---|---|");
    for (const x of j.deployments) L.push(`| ${x.id} | ${x.role ?? "—"} | ${x.kind} | ${x.commit ?? "—"} | ${x.flag ?? "—"} | ${x.url ?? "—"} |`);
    L.push("");
  }
  L.push("## Attribution");
  L.push("");
  L.push("Request attribution = request id matched to a log record whose deployment / path / status / method agree with the response. Function instrumentation = the record also carries the lines the serving deployment must log (2xx save → `[liveWriter]`; hinted read on an R2 deployment → `[setlist] hint-fetch`).");
  L.push("");
  L.push("| population | responses | with request id | matched | consistent (coverage) | inconsistent | unmatched | instrumentation (expected → present) | by deployment |");
  L.push("|---|---|---|---|---|---|---|---|---|");
  for (const g of j.attribution.summary) L.push(`| ${g.key} | ${g.n} | ${g.withId} | ${g.matched} | ${g.consistent} (${pctS(g.coverage)}) | ${g.inconsistent} | ${g.unmatched} | ${g.instrExpected ? `${g.instrExpected} → ${g.instrumented}` : "—"} | ${Object.entries(g.byDep).map(([k, v]) => `${k} ${v}`).join(", ")} |`);
  L.push("");
  L.push("| deployment | log records | matched responses | consistent | first record | last record |");
  L.push("|---|---|---|---|---|---|");
  for (const x of j.attribution.perDeployment) L.push(`| ${x.dep} | ${x.records} | ${x.matchedResponses} | ${x.consistent} | ${iso(x.first)} | ${iso(x.last)} |`);
  L.push("");
  L.push("Pin evidence per population (request-side): `x-deployment-id` header / `__vdpl` cookie / `dpl` query / none.");
  L.push("");
  L.push("| population | n | header | cookie | query | none |");
  L.push("|---|---|---|---|---|---|");
  for (const p of j.attribution.pins) L.push(`| ${p.pop} | ${p.n} | ${p.header} | ${p.cookie} | ${p.query} | ${p.none} |`);
  L.push("");
  if (j.attribution.unmatched.length) {
    L.push(`### Not attributed (${j.attribution.unmatched.length})`);
    L.push("");
    L.push("| population | client | request start | Δ to nearest cliStart | status | path | request id | why |");
    L.push("|---|---|---|---|---|---|---|---|");
    for (const u of j.attribution.unmatched.slice(0, 60)) L.push(`| ${u.pop}${u.subset ? `/${u.subset}` : ""} | ${u.client ?? "—"} | ${hms(u.tStart)} | ${u.nearestSwitch ? `switch ${u.nearestSwitch.i + 1}: ${u.nearestSwitch.dt > 0 ? "+" : ""}${d(u.nearestSwitch.dt)} ms` : "—"} | ${u.status ?? "—"} | ${u.path ?? "—"} | ${u.reqId ?? "—"} | ${u.why} |`);
    if (j.attribution.unmatched.length > 60) L.push(`| … ${j.attribution.unmatched.length - 60} more (JSON) | | | | | | | |`);
    L.push("");
  }
  for (const lg of j.legs) {
    const p = lg.propagation;
    L.push(`## ${lg.name}${lg.kind ? ` (${lg.kind})` : ""}: ${lg.fromId ?? "?"} → ${lg.targetId ?? "?"}`);
    L.push("");
    L.push(`- planned ${iso(lg.plannedAt)}; CLI ${hms(lg.cliStart)} → ${hms(lg.cliEnd)} (${d(lg.cliEnd != null && lg.cliStart != null ? lg.cliEnd - lg.cliStart : null)} ms, CPU ${d(lg.cliCpuMs)} ms); target ${lg.targetUrl ?? "—"}`);
    L.push("");
    L.push(`### Propagation — **${p.status}**${p.why ? ` (${p.why})` : ""}`);
    L.push("");
    L.push("| population | requests | → target | → old | → other | unmatched | first target response (start → end) | last old request start | last old response end | old starts after cliStart |");
    L.push("|---|---|---|---|---|---|---|---|---|---|");
    for (const k of ["probe", "sdk", "page", "all"]) {
      const b = p.per[k];
      L.push(`| ${k} | ${b.n} | ${b.target} | ${b.old} | ${b.other} | ${b.unmatched} | ${b.firstTarget ? `${hms(b.firstTarget.tStart)} → ${hms(b.firstTarget.tEnd)}` : "—"} | ${hms(b.lastOldStart)} | ${hms(b.lastOldEnd)} | ${b.oldStartsAfterCliStart} |`);
    }
    L.push("");
    L.push(`- Sustained target routing over [cliEnd, cliEnd + ${p.sustainMs / 1000} s] (probe): ${p.sustained.ok ? "**yes**" : "**no**"} — ${p.sustained.probes} probe request(s), flip-backs to old ${p.sustained.flipBacks ?? "—"}, largest probe gap ${d(p.sustained.maxGapMs)} ms.`);
    if (p.unattributed.length) L.push(`- Defining probe requests not attributed: ${p.unattributed.map((u) => `${hms(u.tStart)} (${u.why})`).join("; ")}`);
    L.push("");
    const e = lg.exposure;
    L.push(`### Exposure (first attributed target response ${hms(e.firstTargetT)})`);
    L.push("");
    L.push("| exposure | measured | min | result | detail |");
    L.push("|---|---|---|---|---|");
    const ph = e.pendingHinted;
    L.push(`| pending hinted fetch (natural SDK) | ${ph.clients ?? "—"} clients | ${EXPOSURE_MIN.pendingHinted} | ${yes(ph.exercised)} | ${ph.why ?? `${ph.requests} req; old-attributed ${ph.oldAttributed}, unmatched ${ph.unmatched}; after T: headers ${ph.stagesAfterT.headers}, body ${ph.stagesAfterT.body}, eval ${ph.stagesAfterT.eval}, settled ${ph.stagesAfterT.settled}; subsets ${JSON.stringify(ph.subsets)}`} |`);
    const pr = e.pendingRecheck;
    L.push(`| pending recheck (controlled) | ${pr.clients ?? "—"} clients | ${EXPOSURE_MIN.pendingRecheck} | ${yes(pr.exercised)} | ${pr.why ?? `queued ${pr.queued}, dispatched ${pr.dispatched} (${pr.source})`} |`);
    const oa = e.oldAfterCutover;
    L.push(`| old answer after cutover → converged | ${oa.converged ?? "—"} / ${oa.clients ?? "—"} clients | ${EXPOSURE_MIN.oldAfterCutover} | ${yes(oa.exercised)} | ${oa.why ?? `natural ${oa.natural}, controlled ${oa.controlled}; regression check: ${oa.regressionCheck}`} |`);
    for (const a of e.arrivalSaves) {
      L.push(`| arrival save rev ${a.rev} (${a.scheduledOffsetMs != null ? `+${a.scheduledOffsetMs / 1000} s` : "—"}) SDK | ${a.sdk.notJoined} / ${a.sdk.arrivals} not joined at PUT response | ${EXPOSURE_MIN.arrivalSdk} | ${yes(a.sdk.exercised)} | |`);
      L.push(`| arrival save rev ${a.rev} pages | ${a.pages.incomplete} / ${a.pages.arrivals} incomplete | ${EXPOSURE_MIN.arrivalPages} | ${yes(a.pages.exercised)} | |`);
    }
    L.push("");
    if (lg.role) {
      const r = lg.role;
      L.push(`### Target role evidence — ${r.claim}: **${r.status}**${r.missing.length ? ` (missing: ${r.missing.join("; ")})` : ""}`);
      L.push("");
      L.push(`- manifest role ${r.role ?? "—"}, LIVE_WARM_ENTRIES ${r.effectiveFlag ?? "—"}; ${r.logRecords} log record(s) for the deployment`);
      L.push(`- saves in the leg ${r.saves}: attributed to the target ${r.savesAttributedToTarget}, with writer line ${r.savesWithWriterLine}, not attributed ${r.savesUnattributed}; hinted reads ${r.hinted}, not attributed ${r.hintedUnattributed}`);
      L.push(`- \`[liveWarm] start\` ${r.warmStart}; any \`[liveWarm]\` ${r.warmAny}; warm-lookup lines ${r.warmLookups}; \`source=warm\` responses ${r.warmResponses}; responses with a verify header ${r.verifyResponses}`);
      L.push("");
    }
    if (lg.drain) {
      const dr = lg.drain;
      L.push(`### Drain — old deployment ${lg.fromId} after ${hms(dr.from)}`);
      L.push("");
      L.push(`- requests after ${dr.requestsAfter}; last request ${hms(dr.lastRequest)}; last pool line ${hms(dr.lastPoolLine)}. An instance that stops logging has not necessarily closed its pooler connections (the estimator only sees log lines).`);
      if (dr.buckets.length) {
        L.push("");
        L.push("| +s | requests | pool lines | max pool total | instances logging pool |");
        L.push("|---|---|---|---|---|");
        for (const b of dr.buckets) L.push(`| +${Math.round((b.at - dr.from) / 1000)} | ${b.requests} | ${b.poolLines} | ${b.poolMax ?? "—"} | ${b.instances} |`);
      }
      L.push("");
    }
    if (lg.continuity.some((s) => s.per.length)) {
      L.push("### Continuity / performance per save and SDK group");
      L.push("");
      L.push(`Eligible = subscribed by the first save attempt; continuity = every eligible client at ≥ rev within ${CONTINUITY_MS / 1000} s of it (proposed operational acceptance); performance = p95 ≤ ${PERF_P95_MS / 1000} s (kept visible). Joined-after clients are timed from max(join, PUT response).`);
      L.push("");
      L.push("| save rev | label | group | eligible | p50 / p95 / max ms | missing @30 s | continuity | p95 ≤ 3 s | joined after p95 / missing | not joined | broadcast received / pop. | applying fetch reasons | regressions |");
      L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
      for (const s of lg.continuity) for (const g of s.per) L.push(`| ${s.rev} | ${s.label ?? "—"} | ${g.group} | ${g.eligible} | ${d(g.before.p50)} / ${d(g.before.p95)} / ${d(g.before.max)} | ${g.before.missing} | ${g.continuity30s} | ${g.perf3s} | ${d(g.after.p95)} / ${g.after.missing} | ${g.notJoined} | ${g.received} / ${g.population} | ${JSON.stringify(g.reasons)} | ${g.regressions} |`);
      L.push("");
    }
    if (lg.stale) {
      L.push("### Existing-deployment return — first target answers vs the committed head");
      L.push("");
      L.push("| population | clients | stale | unknown | sources | stale revs |");
      L.push("|---|---|---|---|---|---|");
      for (const g of lg.stale) L.push(`| ${g.pop} | ${g.n} | ${g.stale} | ${g.unknown} | ${JSON.stringify(g.source)} | ${JSON.stringify(g.staleRevs)} |`);
      L.push("");
    }
    if (lg.r1Cohort && lg.r1Cohort.length) {
      L.push("### R1 cohort — postgres_changes receipts after the switch → fetch → DOM");
      L.push("");
      L.push(`| change | receipts | pages | → fetch p50 / max ms (none) | → DOM p50 / max ms (none) | DOM < ${EARLIEST_REPAIR_MS / 1000} s (before periodic repair) |`);
      L.push("|---|---|---|---|---|---|");
      for (const g of lg.r1Cohort) L.push(`| ${g.type} | ${g.receipts} | ${g.pages} | ${d(g.fetch.p50)} / ${d(g.fetch.max)} (${g.noFetch}) | ${d(g.dom.p50)} / ${d(g.dom.max)} (${g.noDom}) | ${g.domBeforeRepair}/${g.receipts} |`);
      L.push("");
    }
  }
  if (j.resources) {
    const r = j.resources;
    L.push("## Resources across deployments");
    L.push("");
    L.push(`Σ = sum of per-instance Prisma pool totals (vercel-logs-summary's estimator on the JSON export): ${r.bucketS} s buckets of per-instance MAXIMA (an upper bound within a bucket, not a simultaneous count), an instance carried ≤ ${r.carryS} s after its last line, instances that never log a pool line are invisible; record times are request STARTS. An app-side estimate, not the pooler's own client count.`);
    L.push("");
    L.push("| deployment | Σ peak (carried / reported, instances) | at | writer lines | writer acquire max ms | EMAXCONN |");
    L.push("|---|---|---|---|---|---|");
    const row = (name, x) => L.push(`| ${name} | ${x?.sigma ? `${x.sigma.carried} / ${x.sigma.reported} (${x.sigma.instances})` : "—"} | ${hms(x?.sigma?.at)} | ${x?.writers ?? "—"} | ${d(x?.writerAcquireMax)} | ${x?.emax ?? "—"} |`);
    for (const x of r.per) row(x.dep, x);
    row("**combined**", r.combined);
    L.push("");
    L.push("| minute (UTC) | " + r.per.map((x) => `${x.dep} requests / builds`).join(" | ") + " |");
    L.push("|---|" + r.per.map(() => "---").join("|") + "|");
    const minutes = [...new Set(r.per.flatMap((x) => (x.perMinute ?? []).map((m) => m.minute)))].sort((a, b) => a - b);
    for (const m of minutes) L.push(`| ${iso(m).slice(11, 16)} | ` + r.per.map((x) => { const g = (x.perMinute ?? []).find((y) => y.minute === m); return g ? `${g.requests} / ${g.builds}` : "—"; }).join(" | ") + " |");
    L.push("");
  }
  if (j.smoke.length) {
    L.push("## Reactions / wishes smoke from old pages");
    L.push("");
    L.push("| switch | locale | kind | submit | persisted | refreshed | identity retained | served by |");
    L.push("|---|---|---|---|---|---|---|---|");
    for (const s of j.smoke) L.push(`| ${s.switchIdx != null ? s.switchIdx + 1 : "—"} | ${s.locale ?? "—"} | ${s.kind ?? "—"} | ${s.submitStatus ?? s.status ?? "—"} | ${s.persisted ?? "—"} | ${s.refreshed ?? "—"} | ${s.identityRetained ?? "—"} | ${s.attributedTo ?? "unattributed"} |`);
    L.push("");
  }
  if (j.harnessVerdicts) {
    L.push("## Harness provisional verdicts (verbatim)");
    L.push("");
    L.push("```json");
    L.push(JSON.stringify(j.harnessVerdicts, null, 2).slice(0, 8000));
    L.push("```");
    L.push("");
  }
  return L.join("\n") + "\n";
}

// ─── CLI ───

export function parseLogsArg(s) {
  const out = [];
  for (const part of String(s ?? "").split(",").filter(Boolean)) {
    const i = part.indexOf("=");
    if (i <= 0) throw new Error(`--logs entry "${part}" is not <dplId>=<file.jsonl>`);
    out.push([part.slice(0, i), part.slice(i + 1)]);
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  const pos = argv.filter((a) => !a.startsWith("--"));
  const opt = Object.fromEntries(argv.filter((a) => a.startsWith("--")).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return [m[1], m[2] ?? true];
  }));
  if (pos[0] === "merge-logs") {
    const [, outFile, ...raws] = pos;
    if (!outFile || !raws.length) { console.error("usage: transition-join.mjs merge-logs <out.jsonl> <raw.jsonl>…"); process.exit(2); }
    const existing = fs.existsSync(outFile) ? parseJsonl(fs.readFileSync(outFile, "utf8")) : [];
    const rawRecs = raws.flatMap((f) => parseJsonl(fs.readFileSync(f, "utf8")));
    const m = mergeLogRecords(existing, rawRecs);
    fs.writeFileSync(outFile, m.records.map((r) => JSON.stringify(r)).join("\n") + (m.records.length ? "\n" : ""));
    const deps = [...new Set(m.records.map((r) => r.deploymentId))].join(",");
    console.log(`${opt.coverage ? `${opt.coverage} ` : ""}records=${m.records.length} raw=${rawRecs.length} dupes=${m.dupes} existing=${existing.length} new=${m.added} enriched=${m.enriched} noId=${m.noId} deployments=${deps || "—"} span=${m.records.length ? `${iso(m.records[0].timestamp)}..${iso(m.records[m.records.length - 1].timestamp)}` : "—"}`);
    process.exit(0);
  }
  if (!pos[0] || !opt.logs) {
    console.error("usage: node tests/load/transition-join.mjs <browsers-transition.json> --logs=<dplId>=<a.jsonl>[,…] [--switch-files=a.json,…] [--manifest=<json>] [--sustain-s=60] [--out=<md>] [--json[=<file>]]");
    process.exit(2);
  }
  const json = JSON.parse(fs.readFileSync(pos[0], "utf8"));
  const logsByDep = new Map();
  for (const [dep, file] of parseLogsArg(opt.logs)) logsByDep.set(dep, parseJsonl(fs.readFileSync(file, "utf8")).sort((a, b) => a.timestamp - b.timestamp));
  const switchFiles = opt["switch-files"] ? String(opt["switch-files"]).split(",").filter(Boolean).map((f) => {
    // A switch file may be one JSON object or JSON Lines (the operator
    // writes {plannedAt} first and appends the CLI record) — merge lines.
    const txt = fs.readFileSync(f, "utf8").trim();
    try { return JSON.parse(txt); } catch { return parseJsonl(txt).reduce((a, o) => ({ ...a, ...o, target: { ...(a.target ?? {}), ...(o.target ?? {}) } }), {}); }
  }) : [];
  const manifest = opt.manifest ? JSON.parse(fs.readFileSync(String(opt.manifest), "utf8")) : null;
  const j = join(json, { logsByDep, switchFiles, manifest, sustainMs: (parseFloat(opt["sustain-s"] ?? "60") || 60) * 1000, bucketS: parseFloat(opt.bucket ?? "5") || 5, carryS: parseFloat(opt.carry ?? "5") || 5 });
  const md = toMarkdown(j, { source: [pos[0], opt.logs, opt["switch-files"], opt.manifest].filter(Boolean).join(", ") });
  if (opt.out) fs.writeFileSync(String(opt.out), md);
  if (opt.json) {
    const jf = typeof opt.json === "string" ? opt.json : String(opt.out ?? "transition-join.md").replace(/\.md$/, "") + ".json";
    fs.writeFileSync(jf, JSON.stringify(j, (k, v) => (v instanceof Set ? [...v] : v), 2));
  }
  console.log(md);
}
