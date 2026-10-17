// Join an overlap-drill browsers run (`run.mjs --drill=overlap`) with its
// Vercel history logs: did the race each group was meant to produce
// actually happen, and what did the server do meanwhile?
//
//   node tests/load/overlap-join.mjs <browsers.json> <vercel-logs-history.txt>
//        [--add-hours=N] [--scenario=S0..S6] [--timelines=<timelines.jsonl>]
//        [--out=<file.md>]
//
// Why a separate step: the harness only sees its own requests. Whether B
// committed while A's warm job was still running, whether two builds
// held database connections at the same time, or whether a locale's entry
// was published in reverse order is only visible in the server's own
// timestamps, which the history re-fetch of the logs carries after the
// run (design §1.3: every `[liveWriter]` / `[liveWarm]` / `[dataCache]
// expire-warm` line has explicit `at*` fields — the function's
// Date.now() — because a history-mode log stamps a request's lines with
// the request's START time).
//
// THREE clocks, never mixed silently:
//   - server function clock: writer `at`, job `start at`, per-locale
//     `buildStartAt` / `buildEndAt` / `txStartAt` / `txEndAt` /
//     `setStartAt` / `at`, expire-warm `at`. Different instances are
//     different machines, so a cross-instance difference below 100 ms is
//     reported as "indeterminate", not as an order;
//   - PostgreSQL clock: `captureAt` (the snapshot's capturedAt = the
//     builder transaction's now()), the reaction `ackAt`;
//   - this machine's clock: everything in the browsers JSON (save starts,
//     probes, the catalog edit's start / ack).
// Every exposure below is therefore a PROXY derived from these fields;
// the catalog race's stale service is only PROVEN by content (a `warm`
// answer after the expiry carrying the pre-edit title).
//
// Exposure per group (design §2.5):
//   (i)   B committed during A's job: B's writer `at` < A's LAST
//         SUCCESSFUL set `at` (publication = an `ok=true` set; `ok=false`
//         and skips never count). n/a when A published nothing;
//   (ii)  builds overlapped: some A locale's [txStartAt, txEndAt]
//         intersects some B locale's (database occupancy — time queued
//         for a connection, buildStartAt → txStartAt, is excluded); the
//         build-invocation overlap (buildStartAt..buildEndAt) separately;
//   (iii) reversed publication per locale: B's successful set `at` < A's
//         for the same locale (≥ 100 ms apart across instances, else
//         "indeterminate");
//   (iv)  catalog race per locale (S5): A's `captureAt` < the catalog
//         PUT's expire-warm `phase=start at` AND that expiry's `phase=done
//         at` < A's `setStartAt` AND B's set `at` < the expiry start; then
//         the +1 s probe on B's key after the expiry should show B's entry
//         gone (source ≠ warm);
//   S3    (seterror on A): A's job ran its builds and published nothing
//         (≥ 3 `set ok=false`), AND reader lookups of A's key missed
//         (`miss` / `memo-miss`) while B's job was between its start and
//         its last set.
// A group whose intended race did not happen is "not exercised" even when
// its convergence passed; the scenario needs a minimum count of exercised
// groups fixed beforehand (≥ 4 of 6; S5 ≥ 3 of 6), else the run is NOT
// EXERCISED and is re-run once with the gap adjusted.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { parseLog, warming } from "./vercel-logs-summary.mjs";

const num = (v) => {
  const n = Number(v);
  return v == null || v === "" || v === "-" || !Number.isFinite(n) ? null : n;
};
const iso = (t) => (t == null ? "—" : new Date(t).toISOString());
const d = (v) => (v == null ? "—" : String(Math.round(v)));

// Cross-instance clock tolerance (see the header).
export const INDETERMINATE_MS = 100;

// History-mode entry time (log clock, seconds of day, local to the CLI
// machine) → epoch ms, using a reference instant from the same day. Only
// for lines that carry no `at` of their own (reader lookups, builds).
export function todToEpoch(tSec, addHours, refMs) {
  if (tSec == null || refMs == null) return null;
  const tod = ((((tSec + addHours * 3600) % 86400) + 86400) % 86400) * 1000;
  let cand = refMs - (((refMs % 86400000) + 86400000) % 86400000) + tod;
  if (cand - refMs > 43200000) cand -= 86400000;
  if (refMs - cand > 43200000) cand += 86400000;
  return Math.round(cand);
}

// The server side of the record, typed. `addHours` only matters for lines
// without an explicit `at` (lookups, builds).
export function serverRecords(logText) {
  const { recs } = parseLog(logText);
  const w = warming(recs);
  const by = (k) => recs.filter((r) => r.kind === k);
  const entries = new Map(by("request").map((r) => [r.eid, r]));
  return {
    writers: by("writer").map((r) => ({ rev: num(r.f.rev), at: num(r.f.at), acquireMs: num(r.f.acquireMs), execMs: num(r.f.execMs), ok: r.f.ok === "true", route: r.f.route ?? null, instance: r.f.instance ?? null })),
    writerFailed: by("writerFailed").map((r) => ({ route: r.f.route ?? null, kind: r.f.kind ?? "?", t: r.t })),
    jobs: w.jobs,
    expire: by("expireWarm").map((r) => ({ phase: r.f.phase ?? null, at: num(r.f.at), ok: r.f.ok ?? null, ms: num(r.f.ms), path: r.path, method: entries.get(r.eid)?.method ?? null, instance: r.f.instance ?? null })),
    lookups: by("warmLookup").map((r) => ({ minRev: num(r.f.minRev), locale: r.f.locale ?? null, result: r.f.result ?? null, at: num(r.f.at), t: r.t })),
    builds: by("build").map((r) => ({ rev: num(r.f.rev), locale: r.f.locale ?? null, instance: r.f.instance ?? null, t: r.t })),
    emaxconn: recs.filter((r) => r.emax).length,
  };
}

// The job for key R: prefer one with a start line (a capture gap can
// leave a fragment); several = the summariser's "+N more".
const jobFor = (srv, rev) => {
  const js = srv.jobs.filter((j) => num(j.rev) === rev);
  return js.find((j) => j.start) ?? js[0] ?? null;
};
const okSet = (job, locale) => job?.sets.find((x) => x.locale === locale && x.ok) ?? null;
const lastOkSetAt = (job) => {
  const ats = (job?.sets || []).filter((x) => x.ok && x.at != null).map((x) => x.at);
  return ats.length ? Math.max(...ats) : null;
};
const intervals = (job, a, b) => (job?.sets || []).filter((x) => x[a] != null && x[b] != null).map((x) => [x[a], x[b], x.locale]);
const anyOverlap = (xs, ys) => {
  if (!xs.length || !ys.length) return null;
  return xs.some(([s1, e1]) => ys.some(([s2, e2]) => s1 < e2 && s2 < e1));
};

// The fault label the server logs for a spec: `=` → `:`, `,` → `+`.
export const faultLabel = (spec) => (spec ? String(spec).replace(/\s+/g, "").replace(/=/g, ":").replace(/,/g, "+") : null);

// (iii) for one locale. `a` / `b` = the ok sets, `sameInstance` = both
// jobs on one function instance (one clock: any difference is an order).
export function publicationOrder(a, b, { sameInstance = false, tolMs = INDETERMINATE_MS } = {}) {
  if (!a || !b || a.at == null || b.at == null) return "n/a";
  const diff = a.at - b.at;
  if (!sameInstance && Math.abs(diff) < tolMs) return "indeterminate";
  return diff > 0 ? "reversed" : "in order";
}

// Classify one group. `g` = { saves: [{ who, rev, status }], catalog?,
// probes?: [{ off, who, row }] }, `srv` = serverRecords(), `opt.addHours`
// for the lookup times. `sdkRows` (optional) = timelines SDK request rows
// [locale, row] for the content proof.
export function classifyGroup(g, srv, { addHours = 0, locales = ["ja", "ko", "en"], sdkRows = [] } = {}) {
  const save = (who) => g.saves.find((x) => x.who === who && x.status >= 200 && x.status < 300 && x.rev != null) ?? null;
  const A = save("A");
  const B = save("B");
  const C = save("C");
  const wr = (s) => (s ? srv.writers.find((x) => x.rev === s.rev && x.ok) ?? null : null);
  const jA = A ? jobFor(srv, A.rev) : null;
  const jB = B ? jobFor(srv, B.rev) : null;
  const jC = C ? jobFor(srv, C.rev) : null;
  const wA = wr(A);
  const wB = wr(B);
  const wC = wr(C);
  const out = { writers: { A: wA, B: wB, C: wC }, jobs: { A: jA, B: jB, C: jC } };

  // (i)
  const aPub = lastOkSetAt(jA);
  out.i = wB?.at == null ? null : aPub == null ? null : wB.at < aPub;
  out.iWhy = wB?.at == null ? "no writer `at` for B" : aPub == null ? "A published nothing (no ok set)" : `B commit ${wB.at - (wA?.at ?? wB.at)} ms after A's; A's last ok set ${aPub - wB.at} ms after B's commit`;
  out.iC = wC?.at == null || aPub == null ? null : wC.at < aPub;
  // (ii)
  out.ii = anyOverlap(intervals(jA, "txStartAt", "txEndAt"), intervals(jB, "txStartAt", "txEndAt"));
  out.iiBuild = anyOverlap(intervals(jA, "buildStartAt", "buildEndAt"), intervals(jB, "buildStartAt", "buildEndAt"));
  out.iiC = jC ? anyOverlap([...intervals(jA, "txStartAt", "txEndAt"), ...intervals(jB, "txStartAt", "txEndAt")], intervals(jC, "txStartAt", "txEndAt")) : null;
  out.holdMs = Math.max(0, ...(jA?.sets || []).map((x) => x.holdMs ?? 0));
  // (iii)
  const same = !!(jA && jB && jA.instance && jA.instance === jB.instance);
  out.iii = Object.fromEntries(locales.map((l) => [l, publicationOrder(okSet(jA, l), okSet(jB, l), { sameInstance: same })]));
  // (iv) the catalog race
  out.iv = null;
  if (g.catalog) {
    const path = `/api/admin/songs/${g.catalog.songId}`;
    let exp = srv.expire.filter((x) => x.path === path && (x.method == null || x.method === "PUT"));
    if (!exp.some((x) => x.phase === "start")) {
      // Fallback (no matching request entry): the expiry nearest to the
      // catalog PUT on this machine's clock (cross-clock, ± 2 s).
      const lo = g.catalog.startedAt - 2000;
      const hi = (g.catalog.ackAt ?? g.catalog.startedAt) + 2000;
      const st = srv.expire.filter((x) => x.phase === "start" && x.at != null && x.at >= lo && x.at <= hi);
      exp = st.length ? [st[0], ...srv.expire.filter((x) => x.phase === "done" && x.instance === st[0].instance && x.at >= st[0].at).slice(0, 1)] : [];
    }
    const es = exp.find((x) => x.phase === "start")?.at ?? null;
    const ed = exp.find((x) => x.phase === "done")?.at ?? null;
    const probes = g.probes || [];
    const after = (t) => ed != null && t > ed;
    out.iv = { expStartAt: es, expDoneAt: ed, locales: {} };
    for (const l of locales) {
      const a = okSet(jA, l);
      const b = okSet(jB, l);
      const why = [];
      if (es == null || ed == null) why.push("no expire-warm start/done for the catalog PUT");
      if (!a) why.push("A published nothing for this locale");
      if (a && es != null && !(a.captureAt != null && a.captureAt < es)) why.push("A captured after the expiry started");
      if (a && ed != null && !(a.setStartAt != null && ed < a.setStartAt)) why.push("A's set started before the expiry finished");
      if (es != null && !(b && b.at != null && b.at < es)) why.push("B not published before the expiry");
      const race = why.length === 0;
      // B's key after the expiry: the +1 s probe(s) must not be warm.
      const bProbes = probes.filter((p) => p.who === "B" && p.off === 1000 && p.row[1] === l && after(p.row[0]));
      const bGone = bProbes.length ? bProbes.every((p) => p.row[4] !== "warm") : null;
      // Content proof: a warm answer after the expiry carrying the
      // PRE-edit title (probes + optional SDK rows).
      const stale = [
        ...probes.filter((p) => p.row[1] === l && after(p.row[0]) && p.row[4] === "warm" && p.row[7] === g.catalog.from).map((p) => ({ t: p.row[0], src: `probe ${p.who}` })),
        ...sdkRows.filter(([loc, q]) => loc === l && after(q[0]) && q[12] === "warm" && q[14] === g.catalog.from).map(([, q]) => ({ t: q[0], src: "sdk" })),
      ].sort((x, y) => x.t - y.t);
      const lastObs = Math.max(...probes.filter((p) => p.row[1] === l).map((p) => p.row[0]), -Infinity);
      out.iv.locales[l] = {
        race, why, bGone,
        captureBeforeExpiry: a?.captureAt != null && es != null ? es - a.captureAt : null,
        staleN: stale.length,
        staleFrom: stale[0]?.t ?? null, staleTo: stale[stale.length - 1]?.t ?? null,
        // Censored: still stale at the last observation of that locale.
        censored: stale.length > 0 && stale[stale.length - 1].t >= lastObs,
      };
    }
  }
  // S3: A built and published nothing; reader lookups of A's key missed
  // while B's job ran (start → its last set).
  out.s3 = null;
  if (jA) {
    const failed = jA.sets.filter((x) => !x.ok).length;
    const published = jA.sets.filter((x) => x.ok).length;
    const bFrom = jB?.start?.at ?? null;
    const bTo = jB ? Math.max(...jB.sets.map((x) => x.at ?? -Infinity), -Infinity) : null;
    const misses = A && bFrom != null && Number.isFinite(bTo)
      ? srv.lookups.filter((x) => x.minRev === A.rev && (x.result === "miss" || x.result === "memo-miss")).filter((x) => {
        const t = x.at ?? todToEpoch(x.t, addHours, bFrom);
        return t != null && t >= bFrom && t <= bTo;
      }).length
      : 0;
    out.s3 = { failedSets: failed, publishedSets: published, missesDuringB: misses, exercised: failed >= 3 && published === 0 && misses > 0 };
  }
  return out;
}

// Scenario from the run's config (overridable with --scenario).
export function scenarioOf(cfg) {
  if (!cfg) return "S1";
  const f = String(cfg.faultA ?? "");
  if (cfg.catalogAtMs > 0) return "S5";
  if (/\bslowbuild=/.test(f)) return "S6";
  if (/\bseterror\b/.test(f)) return "S3";
  if (/\bslowset=/.test(f)) return "S2";
  if (cfg.thirdAtMs > 0) return "S4";
  if (cfg.gapMs >= 3000) return "S0";
  return "S1";
}

// Was the scenario's intended race present in this group? null = the
// control (nothing intended).
export function exercisedFor(scenario, c) {
  switch (scenario) {
    case "S0": return null;
    case "S1": return c.i === true && c.ii === true;
    case "S4": return c.i === true && c.ii === true && c.jobs.C != null;
    case "S2": return Object.values(c.iii).includes("reversed");
    case "S3": return c.s3?.exercised === true;
    case "S5": return !!c.iv && Object.values(c.iv.locales).some((x) => x.race);
    case "S6": return c.ii === true && c.holdMs > 0;
    default: return null;
  }
}

// The minimum fixed beforehand: ≥ 4 of 6 groups, S5 (three parties to
// time) ≥ 3 of 6; scaled for a different group count.
export const minExercised = (scenario, n) => (scenario === "S0" ? null : scenario === "S5" ? Math.ceil(n / 2) : Math.ceil((n * 4) / 6));

export function join(json, logText, { addHours = 0, scenario = null, timelines = null } = {}) {
  const ov = json?.overlap;
  if (!ov || !Array.isArray(ov.groups)) throw new Error("browsers JSON has no `overlap` section (not a --drill=overlap run, or an older run.mjs)");
  const cfg = json.config?.overlap ?? null;
  const sc = scenario ?? scenarioOf(cfg);
  const srv = serverRecords(logText);
  const probeGroups = new Map((json.probe?.groups ?? []).map((g) => [g.k, g.probes]));
  // Optional SDK request rows from the timelines (content proof of S5).
  const sdkRows = [];
  if (timelines) {
    for (const line of timelines.split(/\r?\n/)) {
      if (!line.startsWith('{"kind":"sdk"')) continue;
      try {
        const o = JSON.parse(line);
        for (const q of o.reqs || []) sdkRows.push([o.locale, q]);
      } catch { /* partial line */ }
    }
  }
  const expectLabel = faultLabel(cfg?.faultA ?? null);
  const groups = ov.groups.map((g) => {
    const gg = { ...g, probes: probeGroups.get(g.k) ?? [] };
    const c = classifyGroup(gg, srv, { addHours, sdkRows });
    // Classifiable only when the fields the exposure conditions read are
    // actually present: for EVERY committed save, its writer `at` AND a
    // warm job in the log (a committed save on a warming-on server always
    // starts one; a save whose job lines are missing from the capture
    // would otherwise make the `every` below pass vacuously), and on every
    // job `start.at` plus `at` on each set line and `txStartAt` on the
    // successful ones. A server older than the field contract (or a
    // capture gap) leaves these null, and every comparison then resolves
    // to "no" — which would read as "the race did not happen" instead of
    // "the log cannot show it". Such a group is n/a, never "not exercised".
    // Every locale must have left a record too (a `set`, ok or not, or a
    // `skip`), each with its `at`: a capture gap that drops two locales'
    // lines would otherwise let the one remaining line carry the group.
    const committedWho = (g.anchor?.committed ?? []).map((x) => x.who);
    const jobsSeen = committedWho.map((w) => c.jobs[w]);
    const localeComplete = (j) =>
      ["ja", "ko", "en"].every((l) => {
        const s = j.sets.find((x) => x.locale === l);
        const k = (j.skips ?? []).find((x) => x.locale === l);
        return s ? s.at != null && (!s.ok || s.txStartAt != null) : !!k && k.at != null;
      });
    const classifiable =
      committedWho.length > 0 &&
      committedWho.every((w) => c.writers[w]?.at != null) &&
      jobsSeen.every((j) => !!j && j.start?.at != null && localeComplete(j));
    const exercised = classifiable ? exercisedFor(sc, c) : null;
    // Fault evidence: A's job carries exactly the intended label from the
    // header; B / C carry none.
    const aStart = c.jobs.A?.start ?? null;
    const faultOk = expectLabel
      ? aStart?.fault === expectLabel && aStart?.source === "header" && [c.jobs.B, c.jobs.C].every((j) => !j?.start?.fault)
      : [c.jobs.A, c.jobs.B, c.jobs.C].every((j) => !j?.start?.fault);
    // Server-side save gates: acquireMs ≤ 500 for every save.
    const acq = ["A", "B", "C"].map((w) => c.writers[w]?.acquireMs).filter((v) => v != null);
    // Builds (every `[liveSnapshot] build`) in [group start, +10 s], per
    // committed save. History-mode entry times (request start, log clock).
    const t0 = g.anchor?.firstStart ?? null;
    const builds = t0 == null ? null : srv.builds.filter((b) => {
      const t = todToEpoch(b.t, addHours, t0);
      return t != null && t >= t0 && t <= t0 + 10000;
    }).length;
    const committed = (g.anchor?.committed ?? []).length;
    // Commit → entry stored, per save and locale (server clock) and the
    // first warm probe of that key and locale (this machine's clock,
    // from the last save's response — an upper bound).
    const readable = [];
    for (const s of g.saves.filter((x) => x.rev != null && x.status >= 200 && x.status < 300)) {
      const job = jobFor(srv, s.rev);
      const w = c.writers[s.who];
      for (const l of ["ja", "ko", "en"]) {
        const set = okSet(job, l);
        const firstWarm = gg.probes.filter((p) => p.who === s.who && p.row[1] === l && p.row[4] === "warm").sort((a, b) => a.row[0] - b.row[0])[0] ?? null;
        readable.push({ who: s.who, rev: s.rev, locale: l, setMinusCommit: set && w?.at != null && set.at != null ? set.at - w.at : null, entryRev: set?.rev ?? null, firstWarmProbeOff: firstWarm ? firstWarm.off : null });
      }
    }
    return { k: g.k, saves: g.saves, anchor: g.anchor, c, exercised, classifiable, faultOk, acquireMax: acq.length ? Math.max(...acq) : null, acquireOk: acq.length ? acq.every((v) => v <= 500) : null, builds, buildsPerSave: builds != null && committed ? builds / committed : null, readable };
  });
  const n = groups.length;
  const exercisedN = groups.filter((x) => x.exercised === true).length;
  const min = minExercised(sc, n);
  const poolTimeouts = srv.writerFailed.filter((x) => x.kind === "pool_acquire_timeout").length;
  // A log without the explicit server timestamps (a server older than the
  // step-4 field contract) cannot show any exposure: say so instead of
  // letting it read as a race that did not happen.
  // Run level: the writer `at` alone is not enough (the warm job fields
  // are what (ii)–(iv) read), so a run in which no group is classifiable
  // is UNCLASSIFIABLE, and partially classifiable runs say how many.
  const hasAt = srv.writers.some((x) => x.at != null) && groups.some((x) => x.classifiable);
  const unclassifiable = groups.filter((x) => !x.classifiable).length;
  const verdict = !hasAt
    ? "UNCLASSIFIABLE — no explicit server timestamps (`at=`) in this log (a server older than the step-4 field contract)"
    : min == null ? "control (no exposure intended)" : exercisedN >= min ? `EXERCISED (${exercisedN}/${n} ≥ ${min})${unclassifiable ? ` — ${unclassifiable} group(s) unclassifiable (missing server timestamps)` : ""}` : `NOT EXERCISED (${exercisedN}/${n} < ${min})${unclassifiable ? `, ${unclassifiable} group(s) unclassifiable (missing server timestamps)` : ""} — re-run once with the gap adjusted; both runs stay in the record`;
  return {
    scenario: sc, groups, exercisedN, min, verdict, expectLabel,
    server: { emaxconn: srv.emaxconn, poolTimeouts, writerFailed: srv.writerFailed.length, jobs: srv.jobs.length, expire: srv.expire.length, hasAt, unclassifiable },
    client: { gates: ov.gates ?? [], pass: ov.pass ?? null },
  };
}

const yn = (v) => (v == null ? "n/a" : v ? "yes" : "no");

export function toMarkdown(j, { source = "" } = {}) {
  const L = [];
  L.push(`## Overlap join${source ? ` — ${source}` : ""}`);
  L.push("");
  L.push(`Scenario **${j.scenario}**${j.expectLabel ? ` (A's header fault, logged as \`fault=${j.expectLabel} source=header\`)` : ""}: **${j.verdict}**. Server: EMAXCONN ${j.server.emaxconn}, \`[liveWriter] failed kind=pool_acquire_timeout\` ${j.server.poolTimeouts} (all failed kinds ${j.server.writerFailed}), warm jobs ${j.server.jobs}, expire-warm lines ${j.server.expire}.`);
  L.push("");
  L.push("Exposure from server timestamps (proxies; three clocks — server function `at*`, PostgreSQL `captureAt`, this machine for probes). (iii) cross-instance differences < 100 ms = indeterminate.");
  L.push("");
  L.push("| group | saves (who rev: writer at UTC, acquire ms) | A fault ok | (i) B during A | (ii) tx overlap / build overlap | (iii) ja / ko / en | (iv) ja / ko / en | S3 (failed sets, misses during B) | exercised | acquire ≤ 500 | builds [start, +10 s] (per save) |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const g of j.groups) {
    const c = g.c;
    const saves = g.saves.map((s) => `${s.who} ${s.rev ?? s.status}: ${c.writers[s.who]?.at != null ? iso(c.writers[s.who].at).slice(11, 23) : "—"}, ${d(c.writers[s.who]?.acquireMs)}`).join("; ");
    const iv = c.iv ? ["ja", "ko", "en"].map((l) => {
      const x = c.iv.locales[l];
      return `${x.race ? "race" : "no"}${x.staleN ? `, stale ${x.staleN}${x.censored ? " (censored)" : ""}` : ""}${x.bGone === false ? ", B still warm" : ""}`;
    }).join(" / ") : "—";
    L.push(`| ${g.k} | ${saves} | ${yn(g.faultOk)} | ${yn(c.i)} | ${yn(c.ii)} / ${yn(c.iiBuild)} | ${["ja", "ko", "en"].map((l) => c.iii[l]).join(" / ")} | ${iv} | ${c.s3 ? `${c.s3.failedSets}, ${c.s3.missesDuringB}` : "—"} | ${g.classifiable === false ? "n/a (unclassifiable)" : g.exercised == null ? "n/a" : g.exercised ? "**yes**" : "no"} | ${yn(g.acquireOk)} (max ${d(g.acquireMax)}) | ${d(g.builds)} (${g.buildsPerSave == null ? "—" : g.buildsPerSave.toFixed(1)}) |`);
  }
  L.push("");
  L.push("Commit → entry stored (server clock: set `at` − writer `at`, ms; `→N` = the entry's actual rev ≠ key) and the first `warm` probe of that key (+s after the last response; an upper bound):");
  L.push("");
  L.push("| group | key (who) | ja | ko | en |");
  L.push("|---|---|---|---|---|");
  for (const g of j.groups) {
    for (const who of [...new Set(g.readable.map((x) => x.who))]) {
      const r = (l) => {
        const x = g.readable.find((y) => y.who === who && y.locale === l);
        if (!x) return "—";
        return `${d(x.setMinusCommit)}${x.entryRev != null && x.entryRev !== x.rev ? ` →${x.entryRev}` : ""}; probe ${x.firstWarmProbeOff == null ? "never warm" : `+${x.firstWarmProbeOff / 1000} s`}`;
      };
      const rev = g.readable.find((x) => x.who === who)?.rev;
      L.push(`| ${g.k} | ${rev} (${who}) | ${r("ja")} | ${r("ko")} | ${r("en")} |`);
    }
  }
  if (j.groups.some((g) => g.c.iv)) {
    L.push("");
    L.push("Catalog race (S5) per locale: expiry start / done (server clock), why a locale did NOT race, content-proven stale answers (a `warm` answer after the expiry with the pre-edit title):");
    L.push("");
    for (const g of j.groups.filter((x) => x.c.iv)) {
      const iv = g.c.iv;
      L.push(`- group ${g.k}: expire-warm ${iso(iv.expStartAt)} → ${iso(iv.expDoneAt)}; ${["ja", "ko", "en"].map((l) => {
        const x = iv.locales[l];
        return `${l}: ${x.race ? "race" : `no (${x.why.join("; ")})`}${x.captureBeforeExpiry != null ? `, captured ${x.captureBeforeExpiry} ms before the expiry` : ""}${x.bGone == null ? "" : x.bGone ? ", B's key gone after expiry" : ", **B's key still warm after expiry**"}${x.staleN ? `, **stale ${x.staleN}× ${iso(x.staleFrom)} → ${iso(x.staleTo)}${x.censored ? " (censored)" : ""}**` : ""}`;
      }).join("; ")}`);
    }
  }
  if (j.client.gates.length) {
    L.push("");
    L.push(`Client-side gates from the run (${j.client.pass === true ? "all pass" : j.client.pass === false ? "**a gate failed**" : "—"}): ${j.client.gates.map((x) => `${x.name} ${x.pass == null ? "n/a" : x.pass ? "PASS" : "FAIL"}`).join("; ")}.`);
  }
  L.push("");
  return L.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (files.length !== 2) {
    console.error("usage: node tests/load/overlap-join.mjs <browsers.json> <vercel-logs-history.txt> [--add-hours=N] [--scenario=S0..S6] [--timelines=<file.jsonl>] [--out=file.md]");
    process.exit(2);
  }
  const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const i = a.indexOf("=");
    return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
  }));
  if (opt.scenario && !/^S[0-6]$/.test(String(opt.scenario))) {
    console.error("--scenario must be S0..S6");
    process.exit(2);
  }
  const json = JSON.parse(fs.readFileSync(files[0], "utf8"));
  const j = join(json, fs.readFileSync(files[1], "utf8"), {
    addHours: parseFloat(opt["add-hours"] ?? "0") || 0,
    scenario: opt.scenario ? String(opt.scenario) : null,
    timelines: opt.timelines ? fs.readFileSync(String(opt.timelines), "utf8") : null,
  });
  const md = toMarkdown(j, { source: files.map((f) => f.replace(/\\/g, "/").split("/").pop()).join(" + ") });
  if (opt.out) fs.writeFileSync(String(opt.out), md);
  console.log(md);
}
