// Join an n14 step-5 browsers run (`run.mjs --phase=admission` or
// `--drill=idle-broadcast`) with what the harness cannot see itself: the
// server's history logs, the independent observer's artifact and (A1) the
// k6 admission summary.
//
//   node tests/load/admission-join.mjs <browsers.json> [<vercel-logs-history.txt>]
//        [--observer=<observer.jsonl>] [--k6=<k6-admission-summary.json>]
//        [--add-hours=N] [--carry=5] [--bucket=5] [--fault=getnull] [--out=<file.md>]
//
// What it prints (design §1.7):
//   - exposure per save (from the harness JSON) next to the server's
//     commit `at` and writer acquire for the same rev (a cross-check:
//     three clocks — this host, the function, the observer runner — are
//     never mixed silently; a server `at` outside [PUT start, PUT
//     response] by less than INDETERMINATE_MS is "indeterminate", more is
//     a clock offset, not an ordering);
//   - stale first answers, convergence per population, raw broadcast
//     receipt vs the applying fetch's reason — from the harness, plus the
//     observer's own receipt of each save;
//   - Σ reconstruction (sum of per-instance Prisma pool totals) over the
//     admission window WITH its completeness: log entries in the window,
//     the largest gap between consecutive entries, instances that never
//     logged a pool line, and the bucket-maxima caveat;
//   - the admission window view: builds per minute and per instance
//     (warm-job builds vs reader builds), instances in order of first
//     appearance, writer acquire / `at` per save, 503 (hint fetches
//     answered `verify=error`) and EMAXCONN;
//   - A4 fault evidence (`--fault=getnull`, or whenever fault lines are
//     present): the armed line, zero warm hits, the miss / memo-miss
//     outcomes, no invalid / blocked fault configuration;
//   - the I-cycle eligibility + arrival tables for the harness's cohorts
//     AND the observer's clients (admission.mjs idleEligibility /
//     idleArrivals on the observer's full timelines);
//   - the k6 admission summary (A1), when given (shape documented in
//     tests/load/README.md, "k6 summary shape for admission-join").
//
// History-mode log times are the CLI machine's local time of day:
// `--add-hours` maps them to UTC (lines with an explicit `at` need none).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLog, summarise, warming } from "./vercel-logs-summary.mjs";
import { todToEpoch, INDETERMINATE_MS } from "./overlap-join.mjs";
import { idleEligibility, idleArrivals, summarizeArrivals } from "./browsers/admission.mjs";

const iso = (t) => (t == null || !Number.isFinite(t) ? "—" : new Date(t).toISOString());
const d = (v) => (v == null ? "—" : String(Math.round(v)));
const num = (v) => {
  const n = Number(v);
  return v == null || v === "" || v === "-" || !Number.isFinite(n) ? null : n;
};

// ─── observer artifact → client records in the harness's compact shape ───
// The observer runs on another host. Its timestamps are NTP-close to this
// host's, not identical: step 2 saw ~0.4 s of unexplained cross-host
// discrepancy. Every comparison of an observer time with a harness PUT
// time therefore carries this margin — receipts may be stamped up to this
// much before the PUT start and still belong to the save, and the 6 s /
// max-age eligibility bounds are tightened by it on both sides, so an
// observer client is called eligible only when it would be under any
// offset within the margin. Without it the join emitted definite counts
// from an indeterminate comparison.
export const OBSERVER_CLOCK_MARGIN_MS = 1000;

export function observerClients(jsonlText) {
  const lines = [];
  for (const l of String(jsonlText).split(/\r?\n/)) {
    if (!l.trim()) continue;
    try { lines.push(JSON.parse(l)); } catch { /* partial line */ }
  }
  const meta = lines.find((l) => l.kind === "meta") ?? null;
  const by = new Map();
  const get = (c) => {
    if (!by.has(c)) by.set(c, { idx: `obs-${c}`, cohort: "observer", bcasts: [], applied: [], subscribedAt: [], connLog: null, fallbacks: [] });
    return by.get(c);
  };
  for (const l of lines) {
    if (l.kind === "broadcast" && Number.isSafeInteger(l.rev)) get(l.client).bcasts.push([l.t, l.rev, l.what]);
    else if (l.kind === "applied") get(l.client).applied.push([l.t, l.rev, l.reason]);
    else if (l.kind === "client") {
      const c = get(l.client);
      c.locale = l.locale;
      c.subscribedAt = l.subscribedAtAll ?? (l.firstSubscribedAt != null ? [l.firstSubscribedAt] : []);
      c.connLog = l.connLog ?? null;
      c.fallbacks = l.fallbacksAll ?? [];
      c.timelines = Array.isArray(l.connLog);
    }
  }
  for (const c of by.values()) {
    c.bcasts.sort((a, b) => a[0] - b[0]);
    c.applied.sort((a, b) => a[0] - b[0]);
  }
  return { meta, clients: [...by.values()] };
}

// ─── server side ───
export function serverView(logText, { addHours = 0, refMs, from, to, bucketS = 5, carryS = 5 }) {
  const { recs } = parseLog(logText);
  const s = summarise(logText, { bucketS, carryS });
  const w = warming(recs);
  const ep = (t) => todToEpoch(t, addHours, refMs);
  const inWin = (t) => t != null && t >= from && t <= to;
  const requests = recs.filter((r) => r.kind === "request").map((r) => ({ ...r, at: ep(r.t) }));
  const winReq = requests.filter((r) => inWin(r.at)).sort((a, b) => a.at - b.at);
  let maxGap = null;
  for (let i = 1; i < winReq.length; i++) maxGap = Math.max(maxGap ?? 0, winReq[i].at - winReq[i - 1].at);
  const firstLog = requests.length ? Math.min(...requests.map((r) => r.at)) : null;
  const lastLog = requests.length ? Math.max(...requests.map((r) => r.at)) : null;

  // Builds per minute / per instance; warm-job builds placed at their
  // job's start (history mode stamps a job's lines with the save
  // request's start anyway).
  const builds = recs.filter((r) => r.kind === "build").map((r) => ({ at: ep(r.t), instance: r.f.instance ?? "?", rev: num(r.f.rev), locale: r.f.locale ?? null })).filter((b) => inWin(b.at));
  const minuteOf = (t) => Math.floor(t / 60000) * 60000;
  const perMinute = new Map();
  const bump = (m, k, n = 1) => { if (!perMinute.has(m)) perMinute.set(m, { minute: m, builds: 0, warm: 0, instances: new Set() }); perMinute.get(m)[k] += n; };
  for (const b of builds) { bump(minuteOf(b.at), "builds"); perMinute.get(minuteOf(b.at)).instances.add(b.instance); }
  const jobsInWin = w.jobs.map((j) => ({ ...j, startEpoch: j.start?.at ?? (j.start?.t != null ? ep(j.start.t) : null) })).filter((j) => inWin(j.startEpoch));
  for (const j of jobsInWin) bump(minuteOf(j.startEpoch), "warm", j.warmBuilds);
  const perInstance = new Map();
  for (const b of builds) {
    if (!perInstance.has(b.instance)) perInstance.set(b.instance, { instance: b.instance, firstSeen: null, builds: 0, warm: 0 });
    perInstance.get(b.instance).builds++;
  }
  for (const j of jobsInWin) if (perInstance.has(j.instance)) perInstance.get(j.instance).warm += j.warmBuilds;
  // First appearance of every instance on ANY line in the window.
  for (const r of recs) {
    const inst = r.f?.instance;
    if (!inst) continue;
    const t = r.f.at != null ? num(r.f.at) : ep(r.t);
    if (!inWin(t)) continue;
    if (!perInstance.has(inst)) perInstance.set(inst, { instance: inst, firstSeen: null, builds: 0, warm: 0 });
    const x = perInstance.get(inst);
    if (x.firstSeen == null || t < x.firstSeen) x.firstSeen = t;
  }
  const writers = recs.filter((r) => r.kind === "writer").map((r) => ({ rev: num(r.f.rev), at: num(r.f.at), acquireMs: num(r.f.acquireMs), execMs: num(r.f.execMs), ok: r.f.ok === "true", route: r.f.route ?? null, instance: r.f.instance ?? null }));
  const writerFailed = recs.filter((r) => r.kind === "writerFailed").map((r) => ({ route: r.f.route, kind: r.f.kind ?? "?", at: ep(r.t) }));
  const hint503 = recs.filter((r) => r.kind === "hintFetch" && String(r.f.verify ?? "").startsWith("error") && inWin(ep(r.t))).length;
  const emax = recs.filter((r) => r.emax && inWin(ep(r.t))).length;
  const buildFailed = recs.filter((r) => r.kind === "buildFailed" && inWin(ep(r.t))).length;
  const errorEntries = winReq.filter((r) => r.level === "error").length;

  // Σ over the window (pool buckets are in log seconds-of-day).
  const buckets = s.poolBuckets.map((b) => ({ ...b, at: ep(b.t) })).filter((b) => inWin(b.at));
  const peak = buckets.reduce((m, b) => (b.carried > (m?.carried ?? -1) ? b : m), null);
  const poolInstances = new Set(recs.filter((r) => r.kind === "pool" && inWin(ep(r.t))).map((r) => r.f.instance));
  const silent = [...perInstance.keys()].filter((i) => !poolInstances.has(i));
  return {
    window: { from, to },
    coverage: { entries: winReq.length, firstLog, lastLog, coversFrom: firstLog != null && firstLog <= from, coversTo: lastLog != null && lastLog >= to, maxGapMs: maxGap },
    perMinute: [...perMinute.values()].sort((a, b) => a.minute - b.minute).map((m) => ({ minute: m.minute, builds: m.builds, warm: m.warm, reader: m.builds - m.warm, instances: m.instances.size })),
    perInstance: [...perInstance.values()].sort((a, b) => (a.firstSeen ?? Infinity) - (b.firstSeen ?? Infinity)),
    writers, writerFailed, hint503, emax, buildFailed, errorEntries,
    sigma: { peak: peak ? { at: peak.at, carried: peak.carried, reported: peak.reported, instances: peak.carriedInstances } : null, buckets: buckets.length, poolInstances: poolInstances.size, silentInstances: silent, carryS, bucketS },
    lookups: w.lookups,
    jobs: jobsInWin.length,
  };
}

// A4: fault evidence from the raw text (the `fault` lines land in the
// summariser's "other" bucket, so they are scanned here directly).
export function faultEvidence(logText, mode = "getnull") {
  const lines = String(logText).split(/\r?\n/);
  const armed = lines.filter((l) => /\[liveWarm\] fault armed\b/.test(l) && l.includes(`mode=${mode}`)).length;
  const armedOther = lines.filter((l) => /\[liveWarm\] fault armed\b/.test(l) && !l.includes(`mode=${mode}`)).length;
  const invalid = lines.filter((l) => /\[liveWarm\] fault-invalid\b/.test(l)).length;
  const blocked = lines.filter((l) => /\[liveWarm\] fault-blocked\b/.test(l)).length;
  const lookups = lines.filter((l) => /\[setlist\] warm-lookup\b/.test(l));
  const results = {};
  let tagged = 0;
  for (const l of lookups) {
    const r = /\bresult=(\S+)/.exec(l)?.[1] ?? "?";
    results[r] = (results[r] || 0) + 1;
    // `fault=` carries one token (liveWarm's `oneToken`), so compare it
    // whole — a spec like `slow:400+locale:ja` holds regex metacharacters.
    if (/\bfault=(\S+)/.exec(l)?.[1] === mode) tagged++;
  }
  const hits = results.hit ?? 0;
  const complete = armed > 0 && hits === 0 && invalid === 0 && blocked === 0 && armedOther === 0 && lookups.length > 0 && tagged === lookups.length;
  return { mode, armed, armedOther, invalid, blocked, lookups: lookups.length, tagged, results, hits, complete };
}

// ─── the join ───
/**
 * Normalise a k6 admission summary to the shape toMarkdown renders. Two
 * producers exist: the documented minimal shape (`T0`, `arrivals.p95Ms`,
 * `saves[].admitted`, …) and the file `viewers.js` writes in `ADMISSION=1`
 * mode (`kind: "k6-admission"`, `t0`, `arrivals.latency.p95`,
 * `saves[].exposure.atPutEnd.admitted`, `errors.http5xx.total`, …). The
 * k6 side is the richer record and is kept verbatim under `raw`; the join
 * only needs the handful of fields below, so the mapping lives here rather
 * than forcing k6 to emit two files. Unknown shapes pass through untouched.
 */
export function normaliseK6(k) {
  if (!k || k.kind !== "k6-admission") return k;
  const ex = (s) => s?.exposure?.atPutEnd ?? s?.exposure?.atPutStart ?? {};
  return {
    T0: k.t0 ?? null,
    arrivals: {
      total: k.arrivals?.total ?? null,
      byShape: k.arrivals?.byShape ?? {},
      p95Ms: k.arrivals?.latency?.p95 != null ? Math.round(k.arrivals.latency.p95) : null,
      fivexx: k.errors?.http5xx?.total ?? null,
      s503: k.errors?.http503?.total ?? null,
      transport: k.errors?.transport?.total ?? null,
    },
    saves: (k.saves ?? []).map((s) => ({
      rev: s.rev, putStart: s.putStart, putEnd: s.putEnd, status: s.status,
      admitted: ex(s).admitted ?? null, outstanding: ex(s).outstanding ?? null, httpInFlight: ex(s).inFlight ?? null,
    })),
    shapes: k.shapeFinal ?? null,
    ssr: k.ssr ? { rps: k.ssr.rps, requests: k.ssr.requests, p95Ms: k.ssr.latency?.p95 != null ? Math.round(k.ssr.latency.p95) : null, errorRate: k.ssr.errorRate ?? null } : null,
    gates: k.gates ?? null,
    raw: k,
  };
}

export function join(json, { logText = null, observerText = null, k6 = null, addHours = 0, bucketS = 5, carryS = 5, fault = null } = {}) {
  const adm = json?.admission ?? null;
  const idle = json?.idle ?? null;
  if (!adm && !idle) throw new Error("browsers JSON has neither an `admission` nor an `idle` section (not a step-5 run, or an older run.mjs)");
  const saves = adm ? adm.saves : (idle.cycles ?? []).map((c) => c.save).concat((idle.later ?? []).map((x) => x.save));
  const T0 = adm ? adm.T0 : Math.min(...saves.map((s) => s.putStart));
  const lastSave = saves.length ? Math.max(...saves.map((s) => s.putEnd)) : T0;
  // The window: 10 s before T0 (the redeploy's own traffic ends there at
  // the latest) to 30 s after the last save's response, or the end of the
  // harness's edit window when that is later.
  const editsEnd = Date.parse(json.window?.editsEnd ?? "");
  const win = { from: T0 - 10_000, to: Math.max(lastSave + 30_000, Number.isFinite(editsEnd) ? editsEnd : 0) };
  const out = { kind: adm ? "admission" : "idle", label: json.config?.label ?? null, base: json.config?.base ?? null, T0, window: win };

  // Server cross-check per save.
  const srv = logText ? serverView(logText, { addHours, refMs: T0, from: win.from, to: win.to, bucketS, carryS }) : null;
  out.saves = saves.map((s) => {
    const w = srv ? srv.writers.find((x) => x.rev === s.rev && x.ok) ?? null : null;
    let order = "n/a";
    if (w?.at != null) {
      if (w.at >= s.putStart && w.at <= s.putEnd) order = "inside [PUT start, PUT response]";
      else {
        const off = w.at < s.putStart ? w.at - s.putStart : w.at - s.putEnd;
        order = Math.abs(off) < INDETERMINATE_MS ? `indeterminate (${off > 0 ? "+" : ""}${off} ms outside, < ${INDETERMINATE_MS} ms)` : `outside by ${off > 0 ? "+" : ""}${off} ms → clock offset between this host and the function`;
      }
    }
    return { ...s, writer: w, commitOrder: order };
  });

  // Observer.
  let obs = null;
  if (observerText) {
    const o = observerClients(observerText);
    obs = {
      meta: o.meta, clients: o.clients.length, withTimelines: o.clients.filter((c) => c.timelines).length,
      receipts: out.saves.map((s) => {
        const rows = idleArrivals(o.clients, s, { timeoutMs: 60_000, clockMarginMs: OBSERVER_CLOCK_MARGIN_MS });
        return { k: s.k, rev: s.rev, ...summarizeArrivals(rows) };
      }),
      raw: o,
    };
  }

  // I-cycles: the harness cohorts (as judged by run.mjs) + the observer's
  // clients judged by the SAME rule on the same save.
  const cycles = (idle?.cycles ?? adm?.final?.cycles ?? []).map((c) => {
    const ob = obs ? (() => {
      const maxAgeS = idle?.config?.maxAgeS ?? 90;
      const marginS = OBSERVER_CLOCK_MARGIN_MS / 1000;
      // The margin eats into both bounds; below --max-age=8 no observer client
      // could ever qualify, which must read as an invalid configuration, not
      // as a cohort that silently failed eligibility.
      const invalid = maxAgeS - marginS <= 6 + marginS ? `--max-age=${maxAgeS} leaves no observer eligibility interval under the ${OBSERVER_CLOCK_MARGIN_MS} ms clock margin (need ≥ ${Math.ceil(6 + 2 * marginS) + 1} s)` : null;
      const elig = invalid
        ? { per: obs.raw.clients.map((cl) => ({ idx: cl.idx, cohort: cl.cohort ?? null, since: null, ageS: null, eligible: false, why: invalid })), eligible: 0, total: obs.raw.clients.length, spreadS: null, spreadOk: false, exercised: false, invalid }
        : idleEligibility(obs.raw.clients, c.save, { maxAgeS: maxAgeS - marginS, minAgeS: 6 + marginS });
      const rows = idleArrivals(obs.raw.clients, c.save, { timeoutMs: 60_000, clockMarginMs: OBSERVER_CLOCK_MARGIN_MS });
      return { elig, rows, clockMarginMs: OBSERVER_CLOCK_MARGIN_MS, invalid, boundsS: { minAgeS: 6 + marginS, maxAgeS: maxAgeS - marginS }, sum: summarizeArrivals(rows.filter((r) => elig.per.find((p) => p.idx === r.idx)?.eligible)) };
    })() : null;
    return { ...c, observer: ob };
  });
  out.cycles = cycles;
  out.observer = obs ? { meta: obs.meta, clients: obs.clients, withTimelines: obs.withTimelines, receipts: obs.receipts } : null;
  out.server = srv;
  out.fault = logText && (fault || /\[liveWarm\] fault/.test(logText)) ? faultEvidence(logText, fault ?? "getnull") : null;
  out.k6 = normaliseK6(k6);
  out.harness = adm
    ? { verdict: adm.verdict, gates: adm.gates, exercised: adm.exercised, boundary: { outbound: adm.boundary?.outbound?.length ?? null, waitMs: adm.boundary?.waitMs ?? null } }
    : { verdict: idle.verdict };
  return out;
}

// ─── markdown ───
export function toMarkdown(j, { source = "" } = {}) {
  const L = [];
  L.push(`# Step 5 join — ${j.kind}${j.label ? ` — ${j.label}` : ""}`);
  L.push("");
  if (source) L.push(`- Inputs: ${source}`);
  L.push(`- Base ${j.base ?? "—"}; T0 ${iso(j.T0)}; window ${iso(j.window.from)} → ${iso(j.window.to)}`);
  if (j.kind === "admission") L.push(`- Harness verdict: **${j.harness.verdict.verdict}** (SDK ${j.harness.verdict.sdk}, page ${j.harness.verdict.page}); outbound during the boundary wait: ${j.harness.boundary.outbound ?? "—"}`);
  else L.push(`- Harness verdict: **${j.harness.verdict}**`);
  L.push("- Clocks: harness = this host (save PUT start / response), server = the function's `at` (per instance), observer = the runner. Comparisons across clocks within the offset uncertainty are indeterminate; UTC does not synchronise them.");
  L.push("");
  L.push("## Saves — exposure and the server's commit");
  L.push("");
  L.push("| save | label | rev | PUT start (UTC) | PUT ms | server commit `at` | where | acquire ms | exec ms | SDK connected / not yet | pages in flight / future | stale first SDK / pages | convergence SDK before / after (p95 / missing) | pages before / after | broadcast received / pop. | observer received / n |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const s of j.saves) {
    const ob = j.observer?.receipts.find((x) => x.k === s.k);
    const cv = (c) => (c ? `${d(c.p95)} / ${c.missing}` : "—");
    L.push(`| ${s.k} | ${s.label ?? s.mode ?? "—"} | ${s.rev} | ${iso(s.putStart)} | ${d(s.putMs)} | ${iso(s.writer?.at)} | ${s.commitOrder} | ${d(s.writer?.acquireMs)} | ${d(s.writer?.execMs)} | ${s.sdkExposure ? `${s.sdkExposure.connected} / ${s.sdkExposure.notYet}` : "—"} | ${s.pageExposure ? `${s.pageExposure.inflight} / ${s.pageExposure.future}` : "—"} | ${s.stale ? `${s.stale.sdk.stale}/${s.stale.sdk.eligible} / ${s.stale.pages.stale}/${s.stale.pages.eligible}` : "—"} | ${s.sdkConv ? `${cv(s.sdkConv.before)} · ${cv(s.sdkConv.after)}` : "—"} | ${s.pageConv ? `${cv(s.pageConv.before)} · ${cv(s.pageConv.after)}` : "—"} | ${s.receipt ? `${s.receipt.received} / ${s.receipt.population}` : "—"} | ${ob ? `${ob.received} / ${ob.n}` : "—"} |`);
  }
  const acq = j.saves.map((s) => s.writer?.acquireMs).filter((v) => v != null);
  if (j.server) L.push("", `Writer acquire max ${acq.length ? Math.max(...acq) : "—"} ms (gate ≤ 500: ${acq.length ? (Math.max(...acq) <= 500 ? "**PASS**" : "**FAIL**") : "n/a"}); writer pre-execution failures ${j.server.writerFailed.length}${j.server.writerFailed.length ? ` (${j.server.writerFailed.map((x) => `${x.route} ${x.kind}`).join(", ")})` : ""}.`);
  L.push("");
  if (j.server) {
    const s = j.server;
    L.push("## Admission window (server)");
    L.push("");
    L.push(`- Coverage: ${s.coverage.entries} log entries in the window; log spans ${iso(s.coverage.firstLog)} → ${iso(s.coverage.lastLog)} (covers the window start: ${s.coverage.coversFrom ? "yes" : "**no**"}, end: ${s.coverage.coversTo ? "yes" : "**no**"}); largest gap between consecutive entries ${d(s.coverage.maxGapMs)} ms.`);
    L.push(`- Errors: EMAXCONN ${s.emax} (gate 0: ${s.emax === 0 ? "**PASS**" : "**FAIL**"}); hint fetches answered 503 (\`verify=error\`) ${s.hint503}; build-failed ${s.buildFailed}; entries at level error ${s.errorEntries}. (Page / SDK 5xx are counted client-side in the harness gates.)`);
    const sg = s.sigma;
    L.push(`- **Σ (sum of per-instance Prisma pool totals)**: peak ${sg.peak ? `${sg.peak.carried} (carried; reported ${sg.peak.reported}) at ${iso(sg.peak.at)} over ${sg.peak.instances} instance(s)` : "— (no pool lines in the window)"} — gate < 300: ${sg.peak ? (sg.peak.carried < 300 ? "**PASS**" : "**FAIL**") : "n/a"}.`);
    L.push(`  - Completeness: ${sg.buckets} bucket(s) of ${sg.bucketS} s; ${sg.poolInstances} instance(s) logged pool lines; ${sg.silentInstances.length} instance(s) seen in the window WITHOUT any pool line${sg.silentInstances.length ? ` (${sg.silentInstances.slice(0, 6).join(", ")}${sg.silentInstances.length > 6 ? " …" : ""}) — their connections are not in Σ` : ""}; an instance is carried ≤ ${sg.carryS} s after its last line; each bucket holds per-instance MAXIMA (an upper bound within the bucket, not a simultaneous count); a gap in the capture (largest ${d(s.coverage.maxGapMs)} ms) is time Σ cannot see. Σ is an app-side estimate, not the pooler's own client count.`);
    L.push("");
    L.push("| minute (UTC) | builds | warm-job builds | reader builds | building instances |");
    L.push("|---|---|---|---|---|");
    for (const m of s.perMinute) L.push(`| ${iso(m.minute).slice(11, 16)} | ${m.builds} | ${m.warm} | ${m.reader} | ${m.instances} |`);
    L.push("");
    L.push("| instance (by first appearance) | first seen (UTC) | builds | warm-job builds |");
    L.push("|---|---|---|---|");
    for (const x of s.perInstance) L.push(`| ${x.instance} | ${iso(x.firstSeen)} | ${x.builds} | ${x.warm} |`);
    L.push("");
    L.push(`Warm lookups (whole log): ${JSON.stringify(s.lookups.counts)}; warm jobs started in the window: ${s.jobs}.`);
    L.push("");
  }
  if (j.fault) {
    const f = j.fault;
    L.push(`## A4 fault evidence (\`${f.mode}\`)`);
    L.push("");
    L.push(`- \`[liveWarm] fault armed mode=${f.mode}\` lines: ${f.armed}; other armed modes: ${f.armedOther}; \`fault-invalid\`: ${f.invalid}; \`fault-blocked\`: ${f.blocked}`);
    L.push(`- warm lookups ${f.lookups} (tagged \`fault=${f.mode}\`: ${f.tagged}); results ${JSON.stringify(f.results)}; **warm hits ${f.hits}** (must be 0)`);
    L.push(`- Evidence complete: ${f.complete ? "**yes**" : "**no** — the drill cannot claim the fault was in force"}`);
    L.push("");
  }
  if (j.cycles.length) {
    L.push("## I-cycles (eligibility + arrivals, harness cohorts and the observer)");
    L.push("");
    for (const c of j.cycles) {
      L.push(`### ${c.name} — save ${c.save.k} rev ${c.save.rev}: harness **${c.verdict}**`);
      L.push("");
      L.push(`- Harness: eligible ${c.elig.eligible}/${c.elig.total} (spread ${c.elig.spreadS == null ? "—" : c.elig.spreadS.toFixed(1)} s); eligible clients received the broadcast ${c.eligible.received}/${c.eligible.n}, applied ${c.eligible.applied}/${c.eligible.n} by ${JSON.stringify(c.eligible.reasons)}; repair max ${d(c.eligible.repair.max)} ms (healthy periodic repair 20 s ± 4 s — measured, not a bound)`);
      if (c.observer) {
        const o = c.observer;
        if (o.invalid) L.push(`- Observer: **INVALID configuration** — ${o.invalid}`);
        L.push(`- Observer (runner clock; judged with a ${o.clockMarginMs} ms cross-host clock margin: age must be within [${o.boundsS.minAgeS} s, ${o.boundsS.maxAgeS} s], receipts up to ${o.clockMarginMs} ms before the PUT start still count): eligible ${o.elig.eligible}/${o.elig.total} (spread ${o.elig.spreadS == null ? "—" : o.elig.spreadS.toFixed(1)} s, exercised ${o.elig.exercised ? "yes" : "**no**"}); eligible received ${o.sum.received}/${o.sum.n}, applied ${o.sum.applied}/${o.sum.n} by ${JSON.stringify(o.sum.reasons)}${o.elig.per.filter((p) => !p.eligible).length ? `; not eligible: ${o.elig.per.filter((p) => !p.eligible).map((p) => `${p.idx} (${p.why})`).join(", ")}` : ""}`);
        L.push("");
        L.push("| observer client | connected since | age s | eligible | broadcast ms after PUT response | applying fetch | repair ms |");
        L.push("|---|---|---|---|---|---|---|");
        for (const r of o.rows) {
          const e = o.elig.per.find((p) => p.idx === r.idx);
          L.push(`| ${r.idx} | ${iso(e?.since)} | ${e?.ageS == null ? "—" : e.ageS.toFixed(1)} | ${e?.eligible ? "yes" : `no — ${e?.why ?? "?"}`} | ${d(r.bcastMs)} | ${r.reason} | ${d(r.repairMs)} |`);
        }
      }
      L.push("");
    }
  }
  if (j.observer) {
    L.push(`Observer: ${j.observer.clients} client(s), ${j.observer.withTimelines} with full timelines${j.observer.meta?.connectAt ? `; connect-at ${j.observer.meta.connectAt}, connected ${j.observer.meta.connectedAt ?? "—"}, ready ${j.observer.meta.readyAt ?? "—"}` : ""}.`);
    L.push("");
  }
  if (j.k6) {
    const k = j.k6;
    L.push("## k6 admission (A1)");
    L.push("");
    L.push(`- T0 ${iso(k.T0)}; arrivals ${k.arrivals?.total ?? "—"} by shape ${JSON.stringify(k.arrivals?.byShape ?? {})}${k.arrivals?.p95Ms != null ? `; wave p95 ${k.arrivals.p95Ms} ms (soft 1 s)` : ""}; 5xx ${k.arrivals?.fivexx ?? k.fivexx ?? "—"}, 503 ${k.arrivals?.s503 ?? k.s503 ?? "—"}, transport ${k.arrivals?.transport ?? k.transport ?? "—"}`);
    for (const s of k.saves ?? []) L.push(`- save rev ${s.rev}: PUT ${iso(s.putStart)} → ${iso(s.putEnd)}${s.status != null ? ` (${s.status})` : ""}${s.admitted != null ? `; admitted ${s.admitted}, outstanding arrivals ${s.outstanding ?? "—"}, HTTP in flight ${s.httpInFlight ?? "—"}` : ""}`);
    if (k.shapes) L.push(`- shapes: ${JSON.stringify(k.shapes)}`);
    if (k.ssr) L.push(`- SSR: ${JSON.stringify(k.ssr)}`);
    L.push("");
  }
  return L.join("\n") + "\n";
}

// ─── CLI ───
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const pos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return [m[1], m[2] ?? true];
  }));
  if (!pos[0]) {
    console.error("usage: node tests/load/admission-join.mjs <browsers.json> [<vercel-logs-history.txt>] [--observer=<observer.jsonl>] [--k6=<summary.json>] [--add-hours=N] [--fault=getnull] [--out=<file.md>]");
    process.exit(2);
  }
  const json = JSON.parse(fs.readFileSync(pos[0], "utf8"));
  const logText = pos[1] ? fs.readFileSync(pos[1], "utf8") : null;
  const observerText = opt.observer ? fs.readFileSync(String(opt.observer), "utf8") : null;
  const k6 = opt.k6 ? JSON.parse(fs.readFileSync(String(opt.k6), "utf8")) : null;
  const j = join(json, {
    logText, observerText, k6,
    addHours: parseFloat(opt["add-hours"] ?? "0") || 0,
    bucketS: parseFloat(opt.bucket ?? "5") || 5,
    carryS: parseFloat(opt.carry ?? "5") || 5,
    fault: opt.fault ? String(opt.fault) : null,
  });
  const md = toMarkdown(j, { source: [pos[0], pos[1], opt.observer, opt.k6].filter(Boolean).join(", ") });
  if (opt.out) fs.writeFileSync(String(opt.out), md);
  console.log(md);
}
