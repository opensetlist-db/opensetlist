// Join an n14 step-7 spam run (`run.mjs --phase=spam7`) with what the
// harness cannot see itself: the server's text history logs (fetched with
// history-fetch.sh), the k6 background run's summary, and the pooler /
// Supavisor side-car CSVs.
//
//   node tests/load/spam7-join.mjs <browsers-spam7.json> <history.txt>
//        [--k6=<stamp-viewers.json>] [--k6-md=<stamp-viewers.md>]
//        [--pooler=<pooler-clients.csv>] [--backends=<supavisor-backends.csv>]
//        [--add-hours=7] [--bucket=5] [--carry=5] [--pad-s=5]
//        [--poll-rps=] [--ssr-rps=] [--steady-s=] [--reactions=]
//        --out=<file.md> [--json]
//
// What it reports (design §3 "Bounded and draining resource use"):
//   - server outcomes per minute over the measurement window and per 10 s
//     over spam + recovery: hint-fetch outcomes (satisfied / memo /
//     deferred / fresh / none / error), builds split into warm-job vs
//     reader builds, revision reads (the `verifiedRevision` evidence: an
//     uncached read logs `[liveSnapshot] rev-read`, a memo answer has no
//     line of its own and shows up only as a hint fetch answered
//     `verify=memo`), warm-lookup results (incl. miss / timeout /
//     memo-miss / capped), pool waiting, build-failed, EMAXCONN, distinct
//     instances; first vs last spam minute side by side;
//   - every `[liveWriter]` line joined by rev to the harness's writes[]
//     (acquire ≤ 500 ms gate);
//   - Σ (sum of per-instance Prisma pool totals, vercel-logs-summary.mjs's
//     estimator) with its coverage, and Σ after the last send — an
//     estimate whose silent instances expire BY CONSTRUCTION (an instance
//     is carried `--carry` s after its last pool line, so Σ "drains" when
//     instances stop logging whether or not they closed anything); the
//     pooler-clients / supavisor-backends side-cars are the corroboration;
//   - LOG COMPLETENESS (Codex step-7 round 2 §4): the fetch's own coverage
//     (history-fetch.sh header / slice markers / footer: saturation judged
//     by request-record counts, failed slices, second pass, the CLI's own
//     record count), and a reconciliation of the instrumentation the run
//     MUST have produced against the harness's counts: one `[liveWriter]`
//     ok=true line per 2xx harness write (18 + anchor), and the
//     `[setlist] hint-fetch` lines against the harness's hinted requests in
//     the window with ±pad (5 s) of endpoint tolerance. A resource gate
//     whose evidence is not complete reads UNESTABLISHED — never PASS;
//   - the k6 background run: requests by status (zero-count evidence for
//     5xx — counts, never the thresholds' tolerated error RATES), achieved
//     poll / SSR rates and reaction pairs against the configuration,
//     dropped iterations, p95s.
//
// Harness JSON fields read (all optional unless noted; the accessors
// accept the aliases listed, so a renamed field degrades to "—" / unknown
// instead of a crash). Section: `json.spam7` (alias `json.spam`) —
// required.
//   phases.baselineStart, .spamStart, .lastSend, .recoveryEnd  (epoch ms
//     or ISO; baselineStart and recoveryEnd required = the measurement
//     window). `.spamEnd` / `.attackEnd` = the scheduled attack end (P0,
//     which has no sends). lastSend falls back to max(sends[].sentAt|t).
//   sends[]            length (+ sentAt / actualAt / t for the fallback)
//   writes[]           { k, label, kind|op, rev, putStart, putEnd, status,
//                        anchor | kind:"anchor" } — every measured write
//                        AND the anchor; `anchor` (object) is also read
//                        when the anchor is not in writes[]
//   hintedStarts[]     request-start times (epoch ms) of every hinted
//                        (`hint=1`) snapshot request, SDK + pages — the
//                        exact form, preferred when present
//   buckets[]          1 s buckets (`bucketMs` overrides the width):
//                        t | at | start (epoch ms / ISO) or s (seconds
//                        after baselineStart); hinted counts: `hinted`
//                        (exact) else sdkNotification | notification |
//                        sdk.notification plus pagesHinted | pages.hinted;
//                        when pages carry no hinted count the page total
//                        (`pages` | pages.total) widens the upper bound;
//                        503s: s503 | http503 | status503
//   declaredProcess    echoed verbatim
//   config.label / config.base (top level)  echoed
// History-mode log times are the CLI machine's LOCAL clock without a date:
// the offset comes from `--add-hours`, else from the fetch header's `tz=`
// (history-fetch.sh records `date +%z`), else 0 with a warning.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLog, summarise, warming, HINT_KINDS, WARM_RESULTS } from "./vercel-logs-summary.mjs";
import { todToEpoch } from "./overlap-join.mjs";
import { parseFetchFile, countRecords } from "./history-merge.mjs";

export const GATES = { sigma: 300, acquireMs: 500 };
export const PAD_MS = 5000;
// k6 generator health: achieved ≥ 95 % of the configured rate, 0 dropped
// (the viewers.js generator gate, read here from counts).
export const ACHIEVED_RATIO = 0.95;

const first = (o, keys) => {
  for (const k of keys) if (o && o[k] !== undefined && o[k] !== null) return o[k];
  return null;
};
const num = (v) => {
  if (v == null || v === "" || v === "-") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const toMs = (v) => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(v);
  if (Number.isFinite(n) && String(v).trim() !== "") return n;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};
const iso = (t) => (t == null || !Number.isFinite(t) ? "—" : new Date(t).toISOString());
const hms = (t) => (t == null || !Number.isFinite(t) ? "—" : new Date(t).toISOString().slice(11, 19));
const d = (v) => (v == null ? "—" : String(Math.round(v)));
const pct = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)} %`);
const percentile = (values, p) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
};

// `verify=` value → kind (same rule as vercel-logs-summary.mjs).
function hintKind(v) {
  if (typeof v !== "string") return "other";
  const k = v.split(/[=;]/)[0];
  return HINT_KINDS.includes(k) ? k : "other";
}

// `tz=-0700` (date +%z) → hours to ADD to the local clock to get UTC.
export function tzToAddHours(tz) {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(String(tz ?? "").trim());
  if (!m) return null;
  const h = Number(m[2]) + Number(m[3]) / 60;
  return m[1] === "-" ? h : -h;
}

// ─── harness ───
function bucketHinted(b) {
  const exact = num(first(b, ["hinted", "hintedRequests"]));
  if (exact != null) return { lo: exact, hi: exact };
  const sdk = num(first(b, ["sdkNotification", "notification", "sdkNotify"])) ?? num(b?.sdk?.notification);
  const pagesH = num(first(b, ["pagesHinted", "pageHinted"])) ?? num(b?.pages?.hinted);
  const pagesAll = typeof b?.pages === "number" ? b.pages : num(b?.pages?.total) ?? num(first(b, ["pageFetches"]));
  if (sdk == null) return null;
  return { lo: sdk + (pagesH ?? 0), hi: sdk + (pagesH ?? pagesAll ?? 0) };
}

export function harnessView(json) {
  const sp = json?.spam7 ?? json?.spam ?? null;
  if (!sp) throw new Error("browsers JSON has no `spam7` section (not a step-7 run, or an older run.mjs)");
  const ph = sp.phases ?? {};
  const sends = Array.isArray(sp.sends) ? sp.sends : [];
  const sendTimes = sends.map((s) => toMs(Array.isArray(s) ? s[1] ?? s[0] : first(s, ["sentAt", "actualAt", "t"]))).filter((t) => t != null);
  const phases = {
    baselineStart: toMs(ph.baselineStart),
    spamStart: toMs(ph.spamStart),
    lastSend: toMs(ph.lastSend) ?? (sendTimes.length ? Math.max(...sendTimes) : null),
    spamEnd: toMs(first(ph, ["spamEnd", "attackEnd"])),
    recoveryEnd: toMs(ph.recoveryEnd),
  };
  if (phases.baselineStart == null || phases.recoveryEnd == null) throw new Error("spam7.phases needs baselineStart and recoveryEnd (the measurement window)");
  // The attack's end for the recovery views: the last actual send, else
  // the scheduled end (P0 has no sends; its "recovery" starts at the
  // same scheduled instant as an attacked run's, design §0).
  const attackEnd = phases.lastSend ?? phases.spamEnd;
  const normWrite = (w, anchor = false) => ({
    k: first(w, ["k", "idx"]), label: first(w, ["label", "op", "kind"]),
    rev: num(first(w, ["rev", "savedRev"])),
    putStart: toMs(first(w, ["putStart", "startedAt", "start"])),
    putEnd: toMs(first(w, ["putEnd", "endedAt", "end"])),
    status: num(first(w, ["status", "httpStatus"])),
    anchor: anchor || w?.anchor === true || w?.kind === "anchor" || w?.label === "anchor",
  });
  const writes = (Array.isArray(sp.writes) ? sp.writes : []).map((w) => normWrite(w));
  if (sp.anchor && typeof sp.anchor === "object" && !writes.some((w) => w.anchor)) {
    const a = normWrite(sp.anchor, true);
    if (a.rev != null || a.putStart != null) writes.unshift(a);
  }
  const bucketMs = num(sp.bucketMs) ?? 1000;
  const buckets = (Array.isArray(sp.buckets) ? sp.buckets : []).map((b) => {
    const s = num(b?.s);
    const t = toMs(first(b, ["t", "at", "start"])) ?? (s != null ? phases.baselineStart + s * 1000 : null);
    return { t, hinted: bucketHinted(b), s503: num(first(b, ["s503", "http503", "status503"])) };
  }).filter((b) => b.t != null);
  const hintedStarts = Array.isArray(sp.hintedStarts) ? sp.hintedStarts.map(toMs).filter((t) => t != null) : null;
  return {
    label: json?.config?.label ?? null, base: json?.config?.base ?? null,
    phases, attackEnd, window: { from: phases.baselineStart, to: phases.recoveryEnd },
    sends: sends.length, writes, buckets, bucketMs, hintedStarts,
    declaredProcess: sp.declaredProcess ?? null,
    harness503: buckets.some((b) => b.s503 != null) ? buckets.reduce((a, b) => a + (b.s503 ?? 0), 0) : null,
  };
}

/**
 * Harness hinted requests the server must have logged a hint-fetch line
 * for, as a [lo, hi] range: lo = requests that started well inside the
 * window (window shrunk by pad on both ends), hi = requests that started
 * anywhere near it (window grown by pad) — the pad absorbs the offset
 * between this host's clock and the edge's request-start stamp, and a
 * 1 s bucket straddling an edge.
 */
export function expectedHinted(h, { from, to, padMs = PAD_MS, extraHi = 0 }) {
  if (h.hintedStarts) {
    const inR = (a, b) => h.hintedStarts.filter((t) => t >= a && t <= b).length;
    return { lo: inR(from + padMs, to - padMs), hi: inR(from - padMs, to + padMs) + extraHi, source: "hintedStarts" };
  }
  const withH = h.buckets.filter((b) => b.hinted);
  if (!withH.length) return null;
  let lo = 0;
  let hi = 0;
  for (const b of withH) {
    if (b.t >= from + padMs && b.t + h.bucketMs <= to - padMs) lo += b.hinted.lo;
    if (b.t + h.bucketMs > from - padMs && b.t < to + padMs) hi += b.hinted.hi;
  }
  return { lo, hi: hi + extraHi, source: "buckets" };
}

// ─── server ───
const LOOKUP_COLS = [...WARM_RESULTS, "other"];
const HINT_COLS = [...HINT_KINDS, "other"];

function emptyAgg() {
  return {
    requests: 0, errorEntries: 0,
    hint: Object.fromEntries(HINT_COLS.map((k) => [k, 0])), hintTotal: 0,
    builds: 0, warmBuilds: 0, revReads: 0, revReadsHint: 0, revReadTimeouts: 0, revReadErrors: 0,
    lookups: Object.fromEntries(LOOKUP_COLS.map((k) => [k, 0])), lookupTotal: 0,
    poolLines: 0, poolWaitingLines: 0, poolWaitingMax: 0, buildFailed: 0, emax: 0, coalesced: 0,
    writers: 0, instances: new Set(),
  };
}
function addRec(g, r) {
  if (r.f?.instance) g.instances.add(r.f.instance);
  if (r.emax) g.emax++;
  switch (r.kind) {
    case "request": g.requests++; if (r.level === "error") g.errorEntries++; break;
    case "hintFetch": g.hint[hintKind(r.f.verify)]++; g.hintTotal++; break;
    case "build": g.builds++; break;
    case "revRead":
      g.revReads++;
      if (r.f.hint === "1") g.revReadsHint++;
      if (r.f.rev === "timeout") g.revReadTimeouts++;
      if (r.f.rev === "error") g.revReadErrors++;
      break;
    case "warmLookup": {
      const k = WARM_RESULTS.includes(r.f.result) ? r.f.result : "other";
      g.lookups[k]++; g.lookupTotal++; break;
    }
    case "pool": {
      g.poolLines++;
      const w = num(r.f.waiting) ?? 0;
      if (w > 0) g.poolWaitingLines++;
      g.poolWaitingMax = Math.max(g.poolWaitingMax, w);
      break;
    }
    case "buildFailed": g.buildFailed++; break;
    case "coalesced": g.coalesced++; break;
    case "writer": g.writers++; break;
    default: break;
  }
}
const finishAgg = (g) => ({ ...g, instances: g.instances.size, readerBuilds: g.builds - g.warmBuilds });

/**
 * The server side of the window. `recs` carry `at` = epoch ms: the
 * line's explicit `at=` when it has one (writer / warm lines), else the
 * entry's local time-of-day mapped with addHours (history mode stamps
 * every line of a request with the request's START time).
 */
export function serverView(logText, { addHours = 0, h, bucketS = 5, carryS = 5 }) {
  const { from, to } = h.window;
  const ph = h.phases;
  const ep = (t) => todToEpoch(t, addHours, from);
  const { recs } = parseLog(logText);
  for (const r of recs) r.at = num(r.f?.at) ?? ep(r.t);
  const inW = (t, a = from, b = to) => t != null && t >= a && t <= b;
  const w = warming(recs);
  const jobs = w.jobs.map((j) => ({ ...j, startAt: j.start?.at ?? (j.start?.t != null ? ep(j.start.t) : null) }));

  const aggregate = (a, b) => {
    const g = emptyAgg();
    for (const r of recs) if (r.at != null && r.at >= a && r.at < b) addRec(g, r);
    for (const j of jobs) if (j.startAt != null && j.startAt >= a && j.startAt < b) g.warmBuilds += j.warmBuilds;
    return finishAgg(g);
  };
  const rows = (stepMs, a, b) => {
    const out = [];
    for (let t = Math.floor(a / stepMs) * stepMs; t < b; t += stepMs) out.push({ t, ...aggregate(Math.max(t, a), Math.min(t + stepMs, b)) });
    return out;
  };

  const whole = aggregate(from, to + 1);
  const perMinute = rows(60_000, from, to);
  const spamFrom = ph.spamStart ?? from;
  const per10s = rows(10_000, spamFrom, to);
  const firstMin = ph.spamStart != null ? aggregate(ph.spamStart, ph.spamStart + 60_000) : null;
  const lastMin = h.attackEnd != null ? aggregate(h.attackEnd - 60_000, h.attackEnd + 1) : null;

  // Writers (every line, in or out of the window — the join decides).
  const writers = recs.filter((r) => r.kind === "writer").map((r) => ({
    rev: num(r.f.rev), at: r.at, acquireMs: num(r.f.acquireMs), execMs: num(r.f.execMs),
    ok: r.f.ok === "true", route: r.f.route ?? null, instance: r.f.instance ?? null,
  }));
  const writerFailed = recs.filter((r) => r.kind === "writerFailed" && inW(r.at)).map((r) => ({ route: r.f.route ?? null, kind: r.f.kind ?? "?", at: r.at }));

  // Coverage of the log itself over the window.
  const reqAt = recs.filter((r) => r.kind === "request" && r.at != null).map((r) => r.at).sort((a, b) => a - b);
  const winReq = reqAt.filter((t) => inW(t));
  let maxGap = null;
  let maxGapAt = null;
  // Gaps measured over [from, to] including both ends: a log that starts
  // late or stops early shows up as a gap at the edge.
  const pts = [from, ...winReq, to];
  for (let i = 1; i < pts.length; i++) {
    const gap = pts[i] - pts[i - 1];
    if (maxGap == null || gap > maxGap) { maxGap = gap; maxGapAt = pts[i - 1]; }
  }
  const instancesSeen = new Set(recs.filter((r) => inW(r.at) && r.f?.instance).map((r) => r.f.instance));
  const poolInst = new Set(recs.filter((r) => r.kind === "pool" && inW(r.at)).map((r) => r.f.instance));
  const silent = [...instancesSeen].filter((i) => !poolInst.has(i));
  // Silent instances that DID database work without a pool line (the
  // revision read and the writer do not log pool stats): their pooler
  // connections are certainly missing from Σ.
  const dbKinds = new Set(["revRead", "revReadError", "writer", "writerFailed", "buildFailed"]);
  const dbSilent = silent.filter((i) => recs.some((r) => inW(r.at) && r.f?.instance === i && dbKinds.has(r.kind)));

  // Σ (summariser's estimator: per-instance MAX total per bucket, an
  // instance carried `carryS` after its last pool line).
  const s = summarise(logText, { bucketS, carryS });
  const buckets = s.poolBuckets.map((b) => ({ ...b, at: ep(b.t) })).filter((b) => b.at != null);
  const inB = (a, b) => buckets.filter((x) => x.at >= a && x.at < b);
  const peakOf = (arr) => arr.reduce((m, x) => (m == null || x.carried > m.carried ? x : m), null);
  const winBuckets = inB(from, to + 1);
  const peak = peakOf(winBuckets);
  const baseB = ph.spamStart != null ? inB(from, ph.spamStart) : [];
  const baselineMax = baseB.length ? Math.max(...baseB.map((x) => x.carried)) : null;
  const baselineMedian = baseB.length ? percentile(baseB.map((x) => x.carried), 0.5) : null;
  let drain = null;
  if (h.attackEnd != null) {
    const after = inB(h.attackEnd, to + 1);
    const back = baselineMax != null ? after.find((x) => x.carried <= baselineMax) ?? null : null;
    // The summariser's buckets stop at the last pool line anywhere in the
    // log: no bucket after the last send means no instance logged a pool
    // line after it — Σ is then 0 by construction (carry expired), which
    // is the weakest possible drain evidence, so it is said explicitly.
    drain = {
      noPoolLinesAfter: after.length === 0,
      from: h.attackEnd,
      series: after.map((x) => ({ at: x.at, carried: x.carried, reported: x.reported, instances: x.carriedInstances, maxWaiting: x.maxWaiting })),
      backAtOrBelowBaselineAt: back?.at ?? null,
      backAfterMs: back ? back.at - h.attackEnd : null,
      peakAfter: peakOf(after)?.carried ?? null,
    };
  }
  const sigma = {
    peak: peak ? { at: peak.at, carried: peak.carried, reported: peak.reported, instances: peak.carriedInstances } : null,
    baselineMax, baselineMedian,
    firstMinPeak: ph.spamStart != null ? peakOf(inB(ph.spamStart, ph.spamStart + 60_000))?.carried ?? null : null,
    lastMinPeak: h.attackEnd != null ? peakOf(inB(h.attackEnd - 60_000, h.attackEnd + 1))?.carried ?? null : null,
    buckets: winBuckets.length, bucketS, carryS,
    poolInstances: poolInst.size, silentInstances: silent, dbSilentInstances: dbSilent,
    drain,
  };

  // 503 evidence in text mode: the header carries no status code. A 503
  // from /api/setlist leaves a `build-failed` line (deduplicated per
  // failure object — several 503s can share one) and, for a hinted
  // request, a `hint-fetch … verify=error` line. The authoritative 503
  // counts are client-side (harness buckets, k6).
  return {
    whole, perMinute, per10s, firstMin, lastMin, writers, writerFailed,
    jobsInWindow: jobs.filter((j) => inW(j.startAt)).length,
    coverage: {
      entries: winReq.length, firstLog: reqAt[0] ?? null, lastLog: reqAt.length ? reqAt[reqAt.length - 1] : null,
      coversFrom: reqAt.length > 0 && reqAt[0] <= from, coversTo: reqAt.length > 0 && reqAt[reqAt.length - 1] >= to,
      maxGapMs: maxGap, maxGapAt, instances: instancesSeen.size,
    },
    sigma,
    hintLinesInWindow: whole.hintTotal,
  };
}

// ─── fetch completeness ───
export function fetchCompleteness(logText, { from, to }) {
  const meta = parseFetchFile(logText);
  if (!meta.header) {
    return {
      known: false, complete: false, header: null, coverage: null, slices: [],
      reasons: ["no `### capture history-fetch` header: the file was not written by history-fetch.sh, so saturation, failed slices and the second pass cannot be judged"],
    };
  }
  const limit = num(meta.header.limit);
  const slices = meta.slices.map((s) => ({
    from: s.fromMs, to: s.toMs, records: s.records, parsed: countRecords(s.body), status: s.status,
    pass1: s.pass1 ?? null, pass2: s.pass2 ?? null, cli: s.cli ?? null,
    identical: num(s.identical), enriched: num(s.enriched), new: num(s.new), pass1Only: num(s.pass1Only),
  })).sort((a, b) => a.from - b.from);
  const since = toMs(meta.header.since);
  const until = toMs(meta.header.until);
  const gaps = [];
  for (let i = 1; i < slices.length; i++) if (slices[i].from !== slices[i - 1].to) gaps.push([slices[i - 1].to, slices[i].from]);
  if (slices.length && slices[0].from !== since) gaps.push([since, slices[0].from]);
  if (slices.length && slices[slices.length - 1].to !== until) gaps.push([slices[slices.length - 1].to, until]);
  const passes = num(meta.header.passes) ?? 1;
  const c = {
    slices: slices.length,
    records: slices.reduce((a, s) => a + (s.parsed || 0), 0),
    maxPerSlice: slices.reduce((m, s) => Math.max(m, s.parsed || 0), 0),
    saturated: slices.filter((s) => s.status === "saturated" || (limit != null && Math.max(s.parsed, num(s.cli) ?? 0) >= limit)).length,
    failed: slices.filter((s) => s.status === "failed").length,
    resplit: num(meta.coverage?.resplit),
    passes,
    pass2Failed: passes > 1 ? slices.filter((s) => s.pass2 == null || s.pass2 === "failed" || s.pass2 === "saturated").length : null,
    pass2: passes > 1 ? {
      identical: slices.reduce((a, s) => a + (s.identical ?? 0), 0), enriched: slices.reduce((a, s) => a + (s.enriched ?? 0), 0),
      new: slices.reduce((a, s) => a + (s.new ?? 0), 0), pass1Only: slices.reduce((a, s) => a + (s.pass1Only ?? 0), 0),
    } : null,
    markerMismatch: slices.filter((s) => num(s.records) !== s.parsed).length,
    cliMismatch: num(meta.coverage?.cliMismatch),
    cliUnknown: num(meta.coverage?.cliUnknown),
    limit, since, until, gaps,
    coversWindow: since != null && until != null && since <= from && until >= to,
  };
  const reasons = [];
  if (c.failed) reasons.push(`${c.failed} slice(s) failed (the CLI never answered)`);
  if (c.saturated) reasons.push(`${c.saturated} slice(s) saturated (records ≥ limit ${limit}: the oldest records of the slice may be missing)`);
  if (passes < 2) reasons.push("no second pass (background `after()` lines that arrived late are not in the file)");
  else if (c.pass2Failed) reasons.push(`second pass incomplete for ${c.pass2Failed} slice(s)`);
  if (c.gaps.length) reasons.push(`${c.gaps.length} gap(s) between slices`);
  if (!c.coversWindow) reasons.push(`fetch span ${iso(since)} → ${iso(until)} does not cover the measurement window ${iso(from)} → ${iso(to)}`);
  if (c.markerMismatch) reasons.push(`${c.markerMismatch} slice(s) whose marker record count differs from the parsed records (file edited?)`);
  if (c.cliMismatch) reasons.push(`${c.cliMismatch} slice(s) where the CLI's 'Fetched N' disagrees with the parsed records`);
  return { known: true, complete: reasons.length === 0, header: meta.header, coverage: c, slices, reasons };
}

// ─── reconciliation ───
export function reconcile(h, srv, { padMs = PAD_MS, k6Hinted = 0 } = {}) {
  // Writers: one ok=true line per 2xx harness write, matched by rev.
  const expected = h.writes.filter((w) => w.status != null && w.status >= 200 && w.status < 300);
  const used = new Set();
  const perWrite = h.writes.map((w) => {
    const line = w.rev == null ? null : srv.writers.find((x) => !used.has(x) && x.rev === w.rev && x.ok) ?? null;
    if (line) used.add(line);
    // The commit `at` (function clock) against [PUT start, PUT response]
    // (this host's clock): outside means a clock offset, not an ordering.
    let order = "n/a";
    if (line?.at != null && w.putStart != null && w.putEnd != null) {
      if (line.at >= w.putStart && line.at <= w.putEnd) order = "inside PUT";
      else {
        const off = line.at < w.putStart ? line.at - w.putStart : line.at - w.putEnd;
        order = `${off > 0 ? "+" : ""}${off} ms outside (clock offset)`;
      }
    }
    return { ...w, line, order };
  });
  const is2xx = (w) => w.status != null && w.status >= 200 && w.status < 300;
  const found = perWrite.filter((w) => w.line && is2xx(w)).length;
  const missing = perWrite.filter((w) => !w.line && is2xx(w));
  const { from, to } = h.window;
  const extraWriters = srv.writers.filter((x) => !used.has(x) && x.at != null && x.at >= from - padMs && x.at <= to + padMs);
  const writer = {
    expected: expected.length, found, missing: missing.map((w) => w.rev),
    extra: extraWriters.length,
    status: !expected.length ? "unknown" : found === expected.length ? "ok" : "shortfall",
  };
  // Hint fetches.
  const exp = expectedHinted(h, { from, to, padMs, extraHi: k6Hinted });
  const got = srv.hintLinesInWindow;
  const hint = {
    found: got, expected: exp, padMs,
    status: !exp ? "unknown" : got < exp.lo ? "shortfall" : got > exp.hi ? "excess" : "ok",
  };
  return { writer, hint, perWrite };
}

// ─── side-cars ───
export function parseCsv(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  if (!lines.length) return [];
  const split = (l) => {
    const out = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) {
        if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const head = split(lines[0]);
  return lines.slice(1).map((l) => {
    const v = split(l);
    return Object.fromEntries(head.map((k, i) => [k, v[i] ?? ""]));
  });
}

// Column sets: [label, column names (first present wins)].
const POOLER_COLS = [
  ["pooler used clients", ["m_pgbouncer_used_clients"]],
  ["client active", ["m_pgbouncer_pools_client_active_connections"]],
  ["client waiting", ["m_pgbouncer_pools_client_waiting_connections"]],
  ["client max wait s", ["m_pgbouncer_pools_client_maxwait_seconds"]],
  ["backends", ["backends_total"]],
  ["backends active", ["active"]],
  ["idle in tx", ["idle_in_tx"]],
  ["probe ms", ["probe_ms"]],
];
const BACKEND_COLS = [
  ["backends", ["total"]],
  ["active", ["active"]],
  ["idle in tx", ["idle_in_tx"]],
  ["max tx age ms", ["max_xact_ms"]],
  ["max active ms", ["max_active_ms"]],
  ["lock waits", ["lock_waits"]],
];

export function sidecarView(rows, cols, h, { kind }) {
  const pts = rows.map((r) => ({ at: toMs(r.ts), r })).filter((p) => p.at != null).sort((a, b) => a.at - b.at);
  const { from, to } = h.window;
  const ph = h.phases;
  const val = (r, names) => {
    for (const n of names) if (r[n] !== undefined && r[n] !== "") return num(r[n]);
    return null;
  };
  const present = cols.filter(([, names]) => pts.some((p) => val(p.r, names) != null));
  const maxOf = (a, b) => {
    const sel = pts.filter((p) => p.at >= a && p.at < b);
    return { n: sel.length, max: Object.fromEntries(present.map(([label, names]) => {
      const v = sel.map((p) => val(p.r, names)).filter((x) => x != null);
      return [label, v.length ? Math.max(...v) : null];
    })) };
  };
  const periods = [];
  if (ph.spamStart != null) periods.push(["baseline", from, ph.spamStart]);
  if (ph.spamStart != null && h.attackEnd != null) {
    periods.push(["attack (spam start → last send)", ph.spamStart, h.attackEnd + 1]);
    periods.push(["attack, first minute", ph.spamStart, ph.spamStart + 60_000]);
    periods.push(["attack, last minute", h.attackEnd - 60_000, h.attackEnd + 1]);
  }
  if (h.attackEnd != null) periods.push(["recovery (after the last send)", h.attackEnd + 1, to + 1]);
  periods.push(["whole window", from, to + 1]);
  const drain = [];
  if (h.attackEnd != null) for (let t = h.attackEnd; t < to; t += 10_000) drain.push({ from: t, ...maxOf(t, Math.min(t + 10_000, to + 1)) });
  const win = pts.filter((p) => p.at >= from && p.at <= to);
  let maxGap = null;
  const gp = [from, ...win.map((p) => p.at), to];
  for (let i = 1; i < gp.length; i++) maxGap = Math.max(maxGap ?? 0, gp[i] - gp[i - 1]);
  // EMAXCONN / probe failures (pooler-clients only): any sample whose probe
  // result or error column names the pooler's client cap.
  const emax = kind === "pooler" ? win.filter((p) => /EMAXCONN|max client/i.test(`${p.r.probe_result ?? ""} ${p.r.errors ?? ""}`)).length : null;
  const probeFail = kind === "pooler" ? win.filter((p) => p.r.probe_result !== undefined && p.r.probe_result !== "" && p.r.probe_result !== "ok").length : null;
  return {
    kind, samples: win.length, first: pts[0]?.at ?? null, last: pts.length ? pts[pts.length - 1].at : null,
    covers: pts.length > 0 && pts[0].at <= from + 5_000 && pts[pts.length - 1].at >= to - 5_000,
    maxGapMs: maxGap, columns: present.map(([l]) => l),
    periods: periods.map(([label, a, b]) => ({ label, from: a, to: b, ...maxOf(a, b) })),
    drain, emax, probeFail,
  };
}

// ─── k6 ───
/** Configured rates from the k6 markdown viewers.js writes next to its JSON. */
export function k6ConfigFromMd(md) {
  const out = {};
  const st = /steady (\d+(?:\.\d+)?)s → (\d+(?:\.\d+)?)s \(poll ([\d.]+) rps \+ SSR ([\d.]+) rps\)/.exec(md ?? "");
  if (st) {
    out.steadyS = Number(st[2]) - Number(st[1]);
    out.pollRps = Number(st[3]);
    out.ssrRps = Number(st[4]);
  }
  const rx = /reactions: (\d+) POST\+DELETE over (\d+(?:\.\d+)?)s @(\d+(?:\.\d+)?)s/.exec(md ?? "");
  if (rx) { out.reactions = Number(rx[1]); out.reactionSeconds = Number(rx[2]); out.reactionAt = Number(rx[3]); }
  const hm = /HINT_MODE=(\S+)/.exec(md ?? "");
  if (hm) out.hintMode = hm[1];
  return out;
}

export function k6View(k6, { md = null, overrides = {} } = {}) {
  const M = k6?.metrics ?? {};
  const v = (key) => M[key]?.values ?? null;
  const count = (key) => num(v(key)?.count);
  const rateN = (key) => {
    const x = v(key);
    return x ? { bad: num(x.passes), total: (num(x.passes) ?? 0) + (num(x.fails) ?? 0) } : null;
  };
  const p95 = (key) => (count(key) ? num(v(key)?.["p(95)"]) : null);
  const cfg = { ...k6ConfigFromMd(md), ...Object.fromEntries(Object.entries(overrides).filter(([, x]) => x != null)) };

  // Status evidence. viewers.js defines no status-tagged submetric today;
  // any `http_reqs{…status:NNN…}` that a future version adds is counted by
  // code. Without one, the zero-5xx claim rests on `http_req_failed` (k6's
  // built-in: a response outside 200–399 or a transport failure counts as
  // failed): 0 failed requests of ANY kind ⇒ 0 × 5xx, established. A
  // non-zero failed count does not say how many were 5xx → unestablished
  // (the per-stream error COUNTS below narrow it down, never a rate).
  const byStatus = {};
  for (const key of Object.keys(M)) {
    const m = /^http_reqs\{(?:[^}]*,)?status:(\d{3})(?:,[^}]*)?\}$/.exec(key);
    if (m) byStatus[m[1]] = (byStatus[m[1]] || 0) + (count(key) ?? 0);
  }
  const failed = rateN("http_req_failed");
  const total = count("http_reqs");
  let fivexx;
  if (Object.keys(byStatus).length) {
    fivexx = { count: Object.entries(byStatus).filter(([c]) => c >= "500" && c <= "599").reduce((a, [, n]) => a + n, 0), basis: "status-tagged http_reqs submetrics", established: true };
  } else if (failed && failed.bad === 0 && failed.total > 0) {
    fivexx = { count: 0, basis: `http_req_failed: 0 of ${failed.total} requests failed (any status ≥ 400 or transport) ⇒ 0 × 5xx`, established: true };
  } else if (failed) {
    fivexx = { count: null, basis: `http_req_failed: ${failed.bad} of ${failed.total} requests failed; their status codes are not in the k6 JSON`, established: false };
  } else {
    fivexx = { count: null, basis: "no http_req_failed metric", established: false };
  }
  const streams = {
    snapshot: rateN("snapshot_errors"), poll: rateN("snapshot_errors{scenario:poll}"), ssr: rateN("ssr_errors"),
    reactionPost: rateN("reaction_errors{op:post}"), reactionDelete: rateN("reaction_errors{op:delete}"),
    admin: rateN("admin_lost_edit"),
  };
  const pollN = count("http_reqs{scenario:poll}");
  const ssrN = count("http_reqs{scenario:ssr}");
  const posts = count("reaction_latency{op:post}");
  const dels = count("reaction_latency{op:delete}");
  const achieved = {
    poll: { n: pollN, rps: pollN != null && cfg.steadyS ? pollN / cfg.steadyS : null, configured: cfg.pollRps ?? null },
    ssr: { n: ssrN, rps: ssrN != null && cfg.steadyS ? ssrN / cfg.steadyS : null, configured: cfg.ssrRps ?? null },
    reactions: { posts, deletes: dels, pairs: posts != null && dels != null ? Math.min(posts, dels) : null, configured: cfg.reactions ?? null },
  };
  for (const k of ["poll", "ssr"]) {
    const a = achieved[k];
    a.ratio = a.rps != null && a.configured ? a.rps / a.configured : null;
  }
  achieved.reactions.ratio = achieved.reactions.pairs != null && achieved.reactions.configured ? achieved.reactions.pairs / achieved.reactions.configured : null;
  const dropped = Object.fromEntries(["poll", "ssr", "reactions"].map((s) => [s, count(`dropped_iterations{scenario:${s}}`)]));
  const droppedTotal = count("dropped_iterations");
  const ratios = [achieved.poll, achieved.ssr, achieved.reactions].filter((a) => a.configured).map((a) => a.ratio);
  const anyDropped = Object.values(dropped).some((x) => x) || !!droppedTotal;
  const generator = !ratios.length ? "unknown (no configuration: pass --k6-md or --poll-rps / --ssr-rps / --steady-s / --reactions)"
    : ratios.some((r) => r == null) ? "unknown (a configured stream has no request count)"
      : ratios.every((r) => r >= ACHIEVED_RATIO) && !anyDropped ? "OK" : "SHORT";
  return {
    config: cfg, total, failed, byStatus, fivexx, streams, achieved, dropped, droppedTotal, generator,
    p95: {
      snapshot: p95("http_req_duration{name:snapshot}"), poll: p95("http_req_duration{scenario:poll}"), ssr: p95("http_req_duration{scenario:ssr}"),
      reactionPost: p95("reaction_latency{op:post}"), reactionDelete: p95("reaction_latency{op:delete}"),
    },
    hintFetches: count("hint_fetches") ?? 0,
    setup: k6?.setup ? { startRev: k6.setup.startRev ?? null, startedAt: k6.setup.startedAt ?? null, clockOffsetMs: k6.setup.clockOffsetMs ?? null } : null,
  };
}

// ─── gates ───
export function gates(srv, fc, rec, pooler) {
  const reasons = [...(fc?.reasons ?? [])];
  if (rec.writer.status !== "ok") reasons.push(`writer lines ${rec.writer.found}/${rec.writer.expected} (${rec.writer.status})`);
  if (rec.hint.status === "shortfall" || rec.hint.status === "unknown") reasons.push(`hint-fetch lines ${rec.hint.found} vs expected ${rec.hint.expected ? `${rec.hint.expected.lo}–${rec.hint.expected.hi}` : "unknown"} (${rec.hint.status})`);
  const complete = !!fc?.complete && rec.writer.status === "ok" && (rec.hint.status === "ok" || rec.hint.status === "excess");
  const out = [];

  // EMAXCONN: any line is a FAIL whatever the completeness (positive
  // evidence); zero lines prove nothing about records the file lacks.
  const emax = srv.whole.emax + (pooler?.emax ?? 0);
  out.push({
    gate: "EMAXCONN", measured: `${srv.whole.emax} log line(s)${pooler ? `; pooler probe ${pooler.emax}` : ""}`, threshold: "0",
    verdict: emax > 0 ? "FAIL" : complete ? "PASS" : "UNESTABLISHED",
    why: emax > 0 ? "EMAXCONN present" : complete ? "complete log evidence" : reasons.join("; "),
  });

  // Σ: the estimate over the window. Instances that did database work
  // without ever logging a pool line are invisible to Σ; with any of them
  // the gate needs the pooler side-car (complete over the window and
  // below the gate) to stand.
  const sg = srv.sigma;
  const sideOk = pooler && pooler.covers && pooler.periods.find((p) => p.label === "whole window")?.max["pooler used clients"] != null
    && pooler.periods.find((p) => p.label === "whole window").max["pooler used clients"] < GATES.sigma;
  let v;
  let why;
  if (sg.peak && sg.peak.carried >= GATES.sigma) { v = "FAIL"; why = `Σ peak ${sg.peak.carried}`; }
  else if (!sg.peak) { v = "UNESTABLISHED"; why = "no `[prisma] pool` lines in the window"; }
  else if (!complete) { v = "UNESTABLISHED"; why = reasons.join("; "); }
  else if (sg.dbSilentInstances.length && !sideOk) { v = "UNESTABLISHED"; why = `${sg.dbSilentInstances.length} instance(s) did database work without a pool line and the pooler side-car does not cover the window below the gate`; }
  else { v = "PASS"; why = sg.dbSilentInstances.length ? "complete log evidence; silent DB instances covered by the pooler side-car" : "complete log evidence"; }
  out.push({ gate: "Σ (sum of per-instance pool totals)", measured: sg.peak ? `peak ${sg.peak.carried} (reported ${sg.peak.reported}) at ${iso(sg.peak.at)}` : "—", threshold: `< ${GATES.sigma}`, verdict: v, why });

  // Writer acquire: per write, direct evidence (the line exists or not).
  const pw = rec.perWrite.filter((w) => w.status != null && w.status >= 200 && w.status < 300);
  const acq = pw.map((w) => w.line?.acquireMs).filter((x) => x != null);
  const over = pw.filter((w) => w.line?.acquireMs != null && w.line.acquireMs > GATES.acquireMs);
  const miss = pw.filter((w) => !w.line);
  out.push({
    gate: "writer acquire per write", measured: acq.length ? `max ${Math.max(...acq)} ms over ${acq.length} write(s)` : "—", threshold: `≤ ${GATES.acquireMs} ms`,
    verdict: over.length ? "FAIL" : !pw.length || miss.length ? "UNESTABLISHED" : "PASS",
    why: over.length ? `rev ${over.map((w) => w.rev).join(", ")} over` : !pw.length ? "no 2xx harness writes" : miss.length ? `no \`[liveWriter]\` line for rev ${miss.map((w) => w.rev ?? "?").join(", ")}` : "every 2xx write has its line",
  });
  return { complete, reasons, gates: out };
}

// ─── the join ───
export function join(json, logText, { k6 = null, k6Md = null, k6Overrides = {}, poolerCsv = null, backendsCsv = null, addHours = null, bucketS = 5, carryS = 5, padMs = PAD_MS } = {}) {
  const h = harnessView(json);
  const fc = fetchCompleteness(logText, h.window);
  let tzSource;
  if (addHours != null) tzSource = "--add-hours";
  else if (tzToAddHours(fc.header?.tz) != null) { addHours = tzToAddHours(fc.header.tz); tzSource = `fetch header tz=${fc.header.tz}`; }
  else { addHours = 0; tzSource = "none — times assumed UTC (pass --add-hours)"; }
  const srv = serverView(logText, { addHours, h, bucketS, carryS });
  const kv = k6 ? k6View(k6, { md: k6Md, overrides: k6Overrides }) : null;
  const rec = reconcile(h, srv, { padMs, k6Hinted: kv?.hintFetches ?? 0 });
  const pooler = poolerCsv ? sidecarView(parseCsv(poolerCsv), POOLER_COLS, h, { kind: "pooler" }) : null;
  const backends = backendsCsv ? sidecarView(parseCsv(backendsCsv), BACKEND_COLS, h, { kind: "backends" }) : null;
  const g = gates(srv, fc, rec, pooler);
  return { harness: h, addHours, tzSource, fetch: fc, server: srv, reconcile: rec, k6: kv, pooler, backends, verdict: g };
}

// ─── markdown ───
const hintCells = (a) => `${a.hintTotal} | ${a.hint.satisfied} | ${a.hint.memo} | ${a.hint.deferred} | ${a.hint.fresh} | ${a.hint.none} | ${a.hint.error} | ${a.hint.other}`;
const lookupCells = (a) => `${a.lookupTotal} | ${a.lookups.hit} | ${a.lookups.miss} | ${a.lookups.timeout} | ${a.lookups["memo-miss"]} | ${a.lookups.capped} | ${a.lookups.stale + a.lookups.invalid + a.lookups.error + a.lookups.other}`;

export function toMarkdown(j, { source = "" } = {}) {
  const L = [];
  const h = j.harness;
  const ph = h.phases;
  L.push(`# Step 7 join — spam7${h.label ? ` — ${h.label}` : ""}`);
  L.push("");
  if (source) L.push(`- Inputs: ${source}`);
  L.push(`- Base ${h.base ?? "—"}; measurement window ${iso(h.window.from)} → ${iso(h.window.to)}`);
  L.push(`- Phases: baseline ${iso(ph.baselineStart)}; spam start ${iso(ph.spamStart)}; last send ${iso(ph.lastSend)}${ph.lastSend == null && ph.spamEnd != null ? ` (none — scheduled attack end ${iso(ph.spamEnd)} used)` : ""}; recovery end ${iso(ph.recoveryEnd)}; sends ${h.sends}; writes ${h.writes.length} (${h.writes.filter((w) => w.anchor).length} anchor)`);
  L.push(`- Log clock → UTC: +${j.addHours} h (${j.tzSource}). History-mode lines carry their request's START time; \`[liveWriter]\` lines carry the function's own \`at\`. Harness times are this host's clock; a comparison closer than the clock offset is indeterminate.`);
  if (h.declaredProcess) L.push(`- Declared process: \`${JSON.stringify(h.declaredProcess)}\``);
  L.push("");

  L.push("## Resource gates (server logs)");
  L.push("");
  L.push(`Evidence complete: **${j.verdict.complete ? "yes" : "no"}**${j.verdict.reasons.length ? ` — ${j.verdict.reasons.join("; ")}` : ""}. A gate without complete evidence reads UNESTABLISHED, never PASS; positive evidence of a breach is a FAIL either way. Honest latency keeps its own verdict (harness).`);
  L.push("");
  L.push("| gate | measured | threshold | verdict | basis |");
  L.push("|---|---|---|---|---|");
  for (const g of j.verdict.gates) L.push(`| ${g.gate} | ${g.measured} | ${g.threshold} | **${g.verdict}** | ${g.why.replace(/\|/g, "/")} |`);
  L.push("");

  // Completeness.
  const f = j.fetch;
  L.push("## Log completeness");
  L.push("");
  if (!f.known) L.push(`- Fetch metadata: **unknown** — ${f.reasons.join("; ")}.`);
  else {
    const c = f.coverage;
    L.push(`- Fetch: target \`${f.header.target}\`, span ${iso(c.since)} → ${iso(c.until)} (covers the window: ${c.coversWindow ? "yes" : "**no**"}), limit ${c.limit}, passes ${c.passes} (first ${f.header.fetchedAt ?? "—"}${f.header.secondPassAt ? `, second ${f.header.secondPassAt}` : ""}).`);
    L.push(`- Slices ${c.slices} (disjoint; gaps ${c.gaps.length}), request records ${c.records} (max ${c.maxPerSlice} per slice), saturated ${c.saturated}, re-split ${c.resplit ?? "—"}, failed ${c.failed}; CLI 'Fetched N' disagreeing ${c.cliMismatch ?? "—"}, absent ${c.cliUnknown ?? "—"}; marker ≠ parsed ${c.markerMismatch}.`);
    if (c.pass2) L.push(`- Second pass: identical ${c.pass2.identical}, enriched (later copy with more lines) ${c.pass2.enriched}, new ${c.pass2.new}, pass-1-only ${c.pass2.pass1Only}; slices not re-fetched completely ${c.pass2Failed}.`);
    const bad = f.slices.filter((s) => s.status !== "ok" || (c.limit != null && s.parsed >= c.limit));
    if (bad.length) {
      L.push("");
      L.push("| slice from | to | records | status | pass 1 | pass 2 |");
      L.push("|---|---|---|---|---|---|");
      for (const s of bad) L.push(`| ${iso(s.from)} | ${iso(s.to)} | ${s.parsed} | ${s.status} | ${s.pass1 ?? "—"} | ${s.pass2 ?? "—"} |`);
    }
  }
  const r = j.reconcile;
  L.push(`- Reconciliation, \`[liveWriter]\` ok=true lines vs 2xx harness writes (by rev): **${r.writer.found} / ${r.writer.expected}** (${r.writer.status})${r.writer.missing.length ? `; missing rev ${r.writer.missing.join(", ")}` : ""}; writer lines not matching a harness write near the window: ${r.writer.extra}.`);
  const e = r.hint.expected;
  L.push(`- Reconciliation, \`[setlist] hint-fetch\` lines in the window vs harness hinted requests (±${r.hint.padMs / 1000} s endpoint padding${j.k6?.hintFetches ? `, + ${j.k6.hintFetches} k6 hinted fetches on the upper bound` : ""}): **${r.hint.found}** vs expected ${e ? `${e.lo}–${e.hi} (from ${e.source})` : "unknown (the harness JSON has neither hintedStarts nor hinted bucket counts)"} → ${r.hint.status}${r.hint.status === "excess" ? " (more lines than the harness sent: another client sent hinted requests — not a completeness gap, but unexplained)" : ""}.`);
  const cv = j.server.coverage;
  L.push(`- Log span ${iso(cv.firstLog)} → ${iso(cv.lastLog)} (covers window start ${cv.coversFrom ? "yes" : "**no**"}, end ${cv.coversTo ? "yes" : "**no**"}); ${cv.entries} request records in the window; largest gap between consecutive records (window edges included) ${d(cv.maxGapMs)} ms at ${iso(cv.maxGapAt)}; ${cv.instances} distinct instance(s).`);
  L.push("");

  // Per minute / per 10 s.
  const s = j.server;
  const head = "| hint fetches | satisfied | memo | deferred | fresh | none | error (503) | other | builds | warm-job | reader | rev-reads (uncached) | of them hint=1 | rev-read timeout | lookups | hit | miss | timeout | memo-miss | capped | other | pool waiting max (lines >0) | build-failed | EMAXCONN | instances | requests |";
  // `head` lists the data columns; every table adds one label column.
  const sep = "|---".repeat(head.split("|").length - 2);
  const row = (label, a) => `| ${label} | ${hintCells(a)} | ${a.builds} | ${a.warmBuilds} | ${a.readerBuilds} | ${a.revReads} | ${a.revReadsHint} | ${a.revReadTimeouts} | ${lookupCells(a)} | ${a.poolWaitingMax} (${a.poolWaitingLines}) | ${a.buildFailed} | ${a.emax} | ${a.instances} | ${a.requests} |`;
  L.push("## Server outcomes per minute (UTC, measurement window)");
  L.push("");
  L.push("Revision reads: an uncached `verifiedRevision` read logs `[liveSnapshot] rev-read`; a memo answer has no line of its own — for hinted requests it is the `memo` column. Warm-job builds are counted at their job's start. `error (503)` = hinted requests answered 503 (text mode has no status codes; the authoritative 503 counts are the harness's and k6's).");
  L.push("");
  L.push(`| minute ${head}`);
  L.push(`|---${sep}|`);
  for (const m of s.perMinute) L.push(row(hms(m.t).slice(0, 5), m));
  L.push(row("**window**", s.whole));
  L.push("");
  L.push("## Server outcomes per 10 s (spam start → recovery end)");
  L.push("");
  L.push(`| from ${head}`);
  L.push(`|---${sep}|`);
  for (const m of s.per10s) L.push(row(`${hms(m.t)}${h.attackEnd != null && m.t <= h.attackEnd && m.t + 10_000 > h.attackEnd ? " ◂ last send" : ""}`, m));
  L.push("");
  if (s.firstMin && s.lastMin) {
    L.push("## First vs last attack minute");
    L.push("");
    L.push(`| minute ${head}`);
    L.push(`|---${sep}|`);
    L.push(row(`first (${hms(ph.spamStart)} +60 s)`, s.firstMin));
    L.push(row(`last (${hms(h.attackEnd - 60_000)} → ${hms(h.attackEnd)})`, s.lastMin));
    L.push("");
    L.push(`Σ peak: first minute ${d(s.sigma.firstMinPeak)}, last minute ${d(s.sigma.lastMinPeak)}.`);
    L.push("");
  }

  // Writes.
  L.push("## Writes — harness × `[liveWriter]` (by rev)");
  L.push("");
  L.push("| k | label | rev | HTTP | PUT start (UTC) | PUT ms | writer `at` | where | acquire ms | exec ms | instance |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const w of r.perWrite) {
    L.push(`| ${w.k ?? "—"} | ${w.anchor ? "anchor" : w.label ?? "—"} | ${w.rev ?? "—"} | ${w.status ?? "—"} | ${iso(w.putStart)} | ${w.putStart != null && w.putEnd != null ? w.putEnd - w.putStart : "—"} | ${iso(w.line?.at)} | ${w.line ? w.order : "**no line**"} | ${d(w.line?.acquireMs)} | ${d(w.line?.execMs)} | ${w.line?.instance ?? "—"} |`);
  }
  if (s.writerFailed.length) L.push("", `Writer pre-execution failures in the window: ${s.writerFailed.map((x) => `${x.route} ${x.kind} @${iso(x.at)}`).join(", ")}.`);
  L.push("");

  // Σ.
  const sg = s.sigma;
  L.push("## Σ — sum of per-instance Prisma pool totals (app-side estimate)");
  L.push("");
  L.push(`- Peak ${sg.peak ? `**${sg.peak.carried}** (carried; reported ${sg.peak.reported}) at ${iso(sg.peak.at)} over ${sg.peak.instances} instance(s)` : "— (no pool lines in the window)"}; baseline max ${d(sg.baselineMax)} / median ${d(sg.baselineMedian)}.`);
  L.push(`- Estimator: ${sg.bucketS} s buckets of per-instance MAXIMA (an upper bound within a bucket, not a simultaneous count); an instance is carried ${sg.carryS} s after its last pool line, then drops out — **silent instances expire by construction**, so a falling Σ means instances stopped logging, not that they closed their pooler clients. Times are request starts.`);
  L.push(`- Coverage: ${sg.buckets} bucket(s) in the window; ${sg.poolInstances} instance(s) logged pool lines; ${sg.silentInstances.length} instance(s) seen without any pool line${sg.silentInstances.length ? ` (${sg.silentInstances.slice(0, 8).join(", ")}${sg.silentInstances.length > 8 ? " …" : ""})` : ""}, of which ${sg.dbSilentInstances.length} did database work (rev-read / writer / build-failed) — their connections are not in Σ; largest log gap ${d(cv.maxGapMs)} ms.`);
  if (sg.drain) {
    const dr = sg.drain;
    if (dr.noPoolLinesAfter) L.push(`- After the last send (${iso(dr.from)}): no instance logged a pool line — Σ is 0 by construction (carry expired), which says nothing about connections still held; only the side-cars below can show the drain.`);
    else L.push(`- After the last send (${iso(dr.from)}): Σ peak ${d(dr.peakAfter)}; first bucket at or below the baseline max ${dr.backAtOrBelowBaselineAt != null ? `${iso(dr.backAtOrBelowBaselineAt)} (+${(dr.backAfterMs / 1000).toFixed(0)} s)` : "— (never, or no baseline)"} — an ESTIMATE (see the expiry caveat); the side-cars below are the corroboration.`);
    if (dr.series.length) {
      L.push("");
      L.push("| bucket (UTC) | Σ carried | Σ reported | instances (carried) | max waiting |");
      L.push("|---|---|---|---|---|");
    }
    for (const x of dr.series) L.push(`| ${hms(x.at)} | ${x.carried} | ${x.reported} | ${x.instances} | ${x.maxWaiting} |`);
  }
  L.push("");

  // Side-cars.
  for (const sc of [j.pooler, j.backends].filter(Boolean)) {
    L.push(`## Side-car — ${sc.kind === "pooler" ? "pooler-clients.mjs" : "supavisor-backends.mjs"}`);
    L.push("");
    L.push(`- ${sc.samples} sample(s) in the window; file spans ${iso(sc.first)} → ${iso(sc.last)} (covers the window ±5 s: ${sc.covers ? "yes" : "**no**"}); largest gap ${d(sc.maxGapMs)} ms.${sc.kind === "pooler" ? ` Probe failures ${sc.probeFail}; EMAXCONN in probe / errors ${sc.emax}.` : ""}`);
    L.push("");
    L.push(`| period | samples | ${sc.columns.map((c) => `${c} max`).join(" | ")} |`);
    L.push(`|---|---|${sc.columns.map(() => "---").join("|")}|`);
    for (const p of sc.periods) L.push(`| ${p.label} | ${p.n} | ${sc.columns.map((c) => d(p.max[c])).join(" | ")} |`);
    if (sc.drain.length) {
      L.push("");
      L.push("After the last send, per 10 s:");
      L.push("");
      L.push(`| from (UTC) | samples | ${sc.columns.join(" | ")} |`);
      L.push(`|---|---|${sc.columns.map(() => "---").join("|")}|`);
      for (const p of sc.drain) L.push(`| ${hms(p.from)} | ${p.n} | ${sc.columns.map((c) => d(p.max[c])).join(" | ")} |`);
    }
    L.push("");
  }

  // k6.
  if (j.k6) {
    const k = j.k6;
    const a = k.achieved;
    const ratio = (x) => (x.ratio == null ? "—" : pct(x.ratio));
    L.push("## k6 background (viewers.js)");
    L.push("");
    L.push(`- Configured: ${k.config.steadyS != null ? `steady ${k.config.steadyS} s, ` : ""}poll ${k.config.pollRps ?? "—"} rps, SSR ${k.config.ssrRps ?? "—"} rps, reactions ${k.config.reactions ?? "—"} pairs${k.config.reactionAt != null ? ` @${k.config.reactionAt}s over ${k.config.reactionSeconds}s` : ""}${k.config.hintMode ? `, HINT_MODE=${k.config.hintMode}` : ""}${k.setup ? `; setup start rev ${k.setup.startRev ?? "—"}, started ${k.setup.startedAt ?? "—"}` : ""}.`);
    L.push(`- **5xx: ${k.fivexx.count ?? "unestablished"}** — ${k.fivexx.basis}.${Object.keys(k.byStatus).length ? ` By status: ${Object.entries(k.byStatus).map(([c, n]) => `${c} ${n}`).join(", ")}.` : ""} Requests ${k.total ?? "—"}. Error COUNTS per stream (non-200 or transport; counts, not the thresholds' tolerated rates): ${Object.entries(k.streams).filter(([, x]) => x).map(([n, x]) => `${n} ${x.bad}/${x.total}`).join(", ") || "—"}.`);
    L.push(`- Generator: **${k.generator}** — poll ${a.poll.n ?? "—"} req = ${a.poll.rps != null ? a.poll.rps.toFixed(2) : "—"} rps (${ratio(a.poll)} of ${a.poll.configured ?? "—"}); SSR ${a.ssr.n ?? "—"} req = ${a.ssr.rps != null ? a.ssr.rps.toFixed(2) : "—"} rps (${ratio(a.ssr)} of ${a.ssr.configured ?? "—"}); reactions POST ${a.reactions.posts ?? "—"} / DELETE ${a.reactions.deletes ?? "—"} = ${a.reactions.pairs ?? "—"} pairs (${ratio(a.reactions)} of ${a.reactions.configured ?? "—"}); dropped iterations poll ${k.dropped.poll ?? "—"}, SSR ${k.dropped.ssr ?? "—"}, reactions ${k.dropped.reactions ?? "—"}${k.droppedTotal != null ? ` (total ${k.droppedTotal})` : ""}. A SHORT generator is an INVALID candidate for the orchestrator (design §0), not a service result.`);
    L.push(`- p95: snapshot ${d(k.p95.snapshot)} ms, poll ${d(k.p95.poll)} ms, SSR ${d(k.p95.ssr)} ms, reaction POST ${d(k.p95.reactionPost)} ms / DELETE ${d(k.p95.reactionDelete)} ms; k6 hinted fetches ${k.hintFetches}.`);
    L.push("");
  }
  if (h.harness503 != null) {
    L.push(`Harness 503s in the 1 s buckets: ${h.harness503}; server 503 evidence: hinted \`verify=error\` ${s.whole.hint.error}, \`build-failed\` ${s.whole.buildFailed}, error-level records ${s.whole.errorEntries}.`);
    L.push("");
  }
  return L.join("\n") + "\n";
}

// JSON-safe copy (drops nothing but turns Sets already counted; the view
// objects hold only plain values).
export const toJson = (j) => JSON.stringify(j, null, 2);

// ─── CLI ───
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const pos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return [m[1], m[2] ?? true];
  }));
  if (pos.length < 2 || !opt.out) {
    console.error("usage: node tests/load/spam7-join.mjs <browsers-spam7.json> <history.txt> [--k6=<viewers.json>] [--k6-md=<viewers.md>] [--pooler=<csv>] [--backends=<csv>] [--add-hours=N] [--bucket=5] [--carry=5] [--pad-s=5] [--poll-rps=] [--ssr-rps=] [--steady-s=] [--reactions=] --out=<file.md> [--json]");
    process.exit(2);
  }
  const read = (p) => fs.readFileSync(String(p), "utf8");
  const json = JSON.parse(read(pos[0]));
  const logText = read(pos[1]);
  const k6 = opt.k6 ? JSON.parse(read(opt.k6)) : null;
  // The k6 markdown sits next to its JSON (`<stamp>-viewers.md`).
  let k6Md = opt["k6-md"] ? read(opt["k6-md"]) : null;
  if (!k6Md && opt.k6) {
    const guess = String(opt.k6).replace(/\.json$/, ".md");
    if (guess !== String(opt.k6) && fs.existsSync(guess)) k6Md = read(guess);
  }
  const j = join(json, logText, {
    k6, k6Md,
    k6Overrides: { pollRps: num(opt["poll-rps"]), ssrRps: num(opt["ssr-rps"]), steadyS: num(opt["steady-s"]), reactions: num(opt.reactions) },
    poolerCsv: opt.pooler ? read(opt.pooler) : null,
    backendsCsv: opt.backends ? read(opt.backends) : null,
    addHours: opt["add-hours"] != null ? Number(opt["add-hours"]) : null,
    bucketS: num(opt.bucket) ?? 5, carryS: num(opt.carry) ?? 5,
    padMs: (num(opt["pad-s"]) ?? PAD_MS / 1000) * 1000,
  });
  const md = toMarkdown(j, { source: [pos[0], pos[1], opt.k6, opt.pooler, opt.backends].filter(Boolean).join(", ") });
  fs.writeFileSync(String(opt.out), md);
  if (opt.json) fs.writeFileSync(String(opt.out).replace(/\.md$/, "") + ".json", toJson(j));
  console.log(md);
}
