// Summarise a `npx vercel logs` text capture of a load run.
//
//   node tests/load/vercel-logs-summary.mjs <logfile> [--add-hours=N]
//        [--bucket=5] [--carry=5] [--out=<file.md>]
//
// Prints markdown tables (and writes them to --out when given):
//   - builds per `rev` — real executions of the snapshot builder, one
//     `[liveSnapshot] build … rev= ms= instance=` line each. This, not the
//     `x-snapshot-source` response header, is the build count: coalesced
//     waiters share the first request's result object, header included,
//     so the header over-counts;
//   - snapshot failure lines: `build-failed` (by error class), `rev-read`
//     (the bounded repair revision read; `rev=timeout` counted apart), and
//     `coalesced waiters=N`;
//   - `EMAXCONN` (Supavisor's "max client connections reached") split by
//     the request the error belongs to: an `/api/…` route vs an SSR page;
//   - `[liveWriter]` admin save timings per route (acquire = waiting for a
//     pool connection, exec = first statement → commit) and `ok=false`;
//   - `[setlist] slow-hit` cache hits that took long;
//   - hint outcomes: one `[setlist] hint-fetch event= locale= minRev=
//     verify=<kind> instance=` line per notification fetch (`hint=1`),
//     counted per verification kind (satisfied / fresh / memo / deferred
//     / none; `verify=fresh=<dbRev>` and `verify=memo=<rev>;age=<ms>` count
//     under their kind) and per minute; any other value goes to "other"
//     so a new server kind shows up instead of vanishing. The repair
//     revision reads (`rev-read`) are also split by their `hint=<0|1>`
//     field — how many of the 1-row reads the notification fetches caused
//     (lines without the field, from an older server, count as "—");
//   - writer warming (`LIVE_WARM_ENTRIES=1`, src/lib/liveWarm.ts): per
//     warm job (`[liveWarm] start` … `done`, one per committed save) the
//     start → done ms, every locale's `set` (rev, bytes, buildMs, setMs,
//     ok) and `skip` (reason), and `schedule-failed` / `job-failed` /
//     `set-error` counts; the reader's `[setlist] warm-lookup` results
//     (hit / miss / stale / invalid / error / timeout / memo-miss / capped) with ms p50 / p95,
//     per minute and per save rev (`minRev`); per save rev the builds
//     split into **warm builds** (the warm job's own `[liveSnapshot]
//     build` lines) and **reader builds** (all the others); and the
//     run-level "warm hit rate = hits ÷ hinted fetches";
//   - explicit server timestamps (step 4, src/lib/liveWarm.ts field
//     contract): every `[liveWriter]` / `[liveWarm]` line carries `at=`
//     (the function's Date.now() epoch ms — history-mode logs stamp a
//     request's lines with its START time, so the entry time cannot time
//     a warm job), the `set` / `skip` lines also `buildStartAt` /
//     `buildEndAt` / `txStartAt` / `txEndAt` / `holdMs` / `captureAt` /
//     `setStartAt`. They are parsed into the job records (additive; older
//     logs without them still parse) and the writer section lists every
//     save's `at` when a route has ≤ 12 saves;
//   - "Warm expiry": `[dataCache] expire-warm phase=start|done` lines (the
//     warm-tag expiry of a catalog edit), with the request path they
//     belong to;
//   - distinct function instances per minute (any line with `instance=`);
//   - the SUM of per-instance Prisma pool sizes per time bucket, from
//     `[prisma] pool total= idle= waiting= instance=` lines — the best
//     app-side approximation of how many pooler clients the deployment
//     holds. An instance only logs when it does pool work, so two sums are
//     given: "reported" (instances that logged in the bucket) and
//     "carried" (each instance's last reported total, held for --carry
//     seconds after its last line — set it to the pool's idle timeout; an
//     idle pool keeps its connections until then);
//   - everything else, counted by its `[tag]` under "other", so new log
//     kinds are visible before this script learns them.
//
// Input format (Vercel CLI 63, text mode): each entry is a header line
//   `HH:MM:SS.cc  <host>  <level>  [λ] <METHOD> <path>`
// followed by the entry's message line(s) and a blank line, newest first.
// Times are the CLI machine's LOCAL clock with no date: `--add-hours`
// shifts them for display (e.g. +7 turns PDT into UTC so they line up
// with the k6 / browsers reports); a capture that crosses local midnight
// is not handled. CLI preamble lines and `### capture …` markers written
// by vercel-logs-capture.mjs are skipped.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Two header shapes, one per CLI mode:
//   history  `14:03:55.97  <host>  info   λ GET /api/setlist`
//   --follow `14:50:33.25  ℹ️  GET  ---  <host>     /api/setlist`
//            (level as an icon, then the status or `---`, then a
//            `-----` rule line before the message)
const HEADER_HISTORY = /^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?\s+(\S+\.\S+)\s+(info|error|warning|warn|fatal|debug|log)\s+(?:[^\sA-Z]+\s+)?([A-Z]+)\s+(\S+)/;
const HEADER_FOLLOW = /^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?\s+(\S+)\s+([A-Z]+)\s+(\S+)\s+(\S+\.\S+)\s+(\/\S*)/;
export const META = /^(Vercel CLI\b|Resolving deployment|Fetching (project|logs)|Fetched \d+ logs|Streaming logs for|waiting for new logs|TIME\s+HOST|### capture|<claude-code-hint|-{10,}$)/;

export function parseHeader(line) {
  let m = HEADER_HISTORY.exec(line);
  if (m) return { hms: m, level: m[6], method: m[7], path: m[8] };
  m = HEADER_FOLLOW.exec(line);
  if (m) {
    // ℹ️ info, ⚠️ warning, anything else (❌ / ✖ / ⛔) error.
    const level = m[5].includes("ℹ") ? "info" : m[5].includes("⚠") ? "warning" : "error";
    return { hms: m, level, method: m[6], path: m[9] };
  }
  return null;
}

function kv(line) {
  const out = {};
  for (const m of line.matchAll(/([A-Za-z_][\w]*)=(\S+)/g)) out[m[1]] = m[2];
  return out;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// The server's verification kinds (`x-snapshot-verify`), in report order.
// "missing" is a client-side notion (no header) and is never logged.
// `error` is what the route logs for a hint request that ended in a 503
// (the response carries no header; the line is still written so every
// hint request is counted). Keeping it a kind of its own lets an overload
// run tell "503 share" from "a verify= value this script does not know".
export const HINT_KINDS = ["satisfied", "fresh", "memo", "deferred", "none", "error"];

// `verify=` value → kind: `fresh=<dbRev>` → fresh, `memo=<rev>;age=<ms>`
// → memo, the bare kinds as they are; anything else (absent, empty, a
// value this script does not know yet) → "other".
function hintKind(v) {
  if (typeof v !== "string") return "other";
  const k = v.split(/[=;]/)[0];
  return HINT_KINDS.includes(k) ? k : "other";
}

function pct(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
}

// Parse the capture into typed records. Exported for the test.
//
// First pass: group lines into entries (header + message lines). A
// capture made of overlapping `--follow` segments repeats the entries of
// the overlap, so an entry identical (header and message) to one in the
// PREVIOUS segment is dropped; within one segment nothing is deduplicated.
export function parseLog(text) {
  const entries = [];
  const loose = []; // message lines before the first header
  let cur = null;
  let seg = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (line.startsWith("### capture segment start")) { seg++; cur = null; continue; }
    const h = parseHeader(line);
    if (h) {
      cur = { key: line, h, lines: [], seg };
      entries.push(cur);
      continue;
    }
    if (META.test(line.trim())) continue;
    if (cur) { cur.lines.push(line); cur.key += `\n${line}`; } else loose.push(line);
  }
  const bySeg = new Map();
  for (const e of entries) {
    if (!bySeg.has(e.seg)) bySeg.set(e.seg, new Set());
    bySeg.get(e.seg).add(e.key);
  }
  let duplicates = 0;
  const kept = entries.filter((e) => {
    const prev = bySeg.get(e.seg - 1);
    if (prev && prev.has(e.key)) { duplicates++; return false; }
    return true;
  });

  const recs = [];
  const other = new Map();
  const classify = (line, entry) => {
    // `eid` = the log entry (request) the line came from. In history
    // mode every line of a request carries the request's START time, so
    // "same entry" is the only fine-grained link between, e.g., a warm
    // job and the builds it ran (see warming()).
    const base = { t: entry?.t ?? null, path: entry?.path ?? null, eid: entry?.eid ?? null };
    const f = kv(line);
    let kind = null;
    // Order matters: `build-failed` before `build`.
    if (/\[liveSnapshot\] build-failed\b/.test(line)) kind = "buildFailed";
    else if (/\[liveSnapshot\] build\s/.test(line)) kind = "build";
    // `rev-read-error` is the console.error companion of a `rev=error`
    // line (same read, logged twice) — keep it out of the rev-read
    // count or every error would count as two reads.
    else if (/\[liveSnapshot\] rev-read-error\b/.test(line)) kind = "revReadError";
    else if (/\[liveSnapshot\] rev-read\b/.test(line)) kind = "revRead";
    // `coalesced` (first read) and `coalesced-repair` (rev-keyed rebuild)
    // both carry `waiters=N`; one request can appear in each, so they
    // are summed as "coalesce events", not as requests.
    else if (/\[liveSnapshot\] coalesced(-repair)?\b/.test(line)) kind = "coalesced";
    else if (/\[prisma\] pool\b/.test(line)) kind = "pool";
    // `[liveWriter] failed route=… kind=…` has no acquire/exec fields;
    // it is the pre-execution failure companion of an `ok=false` line.
    else if (/\[liveWriter\] failed\b/.test(line)) kind = "writerFailed";
    else if (/\[liveWriter\]/.test(line)) kind = "writer";
    else if (/\[setlist\] slow-hit\b/.test(line)) kind = "slowHit";
    else if (/\[setlist\] hint-fetch\b/.test(line)) kind = "hintFetch";
    // Writer warming. `set-error` (the console.error companion of an
    // `ok=false` set) before `set`; `set` needs the trailing space
    // because `\b` would also match "set-error".
    else if (/\[liveWarm\] set-error\b/.test(line)) kind = "warmSetError";
    else if (/\[liveWarm\] set\s/.test(line)) kind = "warmSet";
    else if (/\[liveWarm\] skip\b/.test(line)) kind = "warmSkip";
    else if (/\[liveWarm\] start\b/.test(line)) kind = "warmStart";
    else if (/\[liveWarm\] done\b/.test(line)) kind = "warmDone";
    else if (/\[liveWarm\] schedule-failed\b/.test(line)) kind = "warmScheduleFailed";
    else if (/\[liveWarm\] job-failed\b/.test(line)) kind = "warmJobFailed";
    else if (/\[liveWarm\] lookup-error\b/.test(line)) kind = "warmLookupError";
    else if (/\[setlist\] warm-lookup\b/.test(line)) kind = "warmLookup";
    // The warm-tag expiry of revalidatePublicData() (catalog edits).
    else if (/\[dataCache\] expire-warm\b/.test(line)) kind = "expireWarm";
    else if (/EMAXCONN/.test(line)) kind = "emaxconn";
    if (kind) {
      recs.push({ kind, ...base, f, api: (entry?.path ?? "").startsWith("/api/"), emax: /EMAXCONN/.test(line) });
    } else {
      const tag = /^\s*(\[[^\]]{1,40}\]\s*\S*)/.exec(line)?.[1] ?? `untagged: ${line.trim().slice(0, 50)}`;
      other.set(tag, (other.get(tag) || 0) + 1);
    }
  };
  for (const line of loose) classify(line, null);
  for (const [eid, e] of kept.entries()) {
    const m = e.h.hms;
    const t = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (m[4] ? Number(`0.${m[4]}`) : 0);
    const entry = { t, eid, level: e.h.level, method: e.h.method, path: e.h.path };
    recs.push({ kind: "request", ...entry });
    for (const line of e.lines) classify(line, entry);
  }
  return { recs, other, entries: kept.length, duplicates };
}

// The reader's warm-lookup results, in report order (src/lib/liveWarm.ts
// `warmLookup`). Anything else goes to "other". `memo-miss` (a repeat of
// a key that just missed, answered from the 250 ms / 1 s miss memo
// without a cache get) and `capped` were added by the fault-drill work;
// they used to land in "other", which hid the memo share of a miss storm.
export const WARM_RESULTS = ["hit", "miss", "stale", "invalid", "error", "timeout", "memo-miss", "capped"];

// Writer warming, from the typed records (see the header). Exported for
// the test.
//
// Jobs: one per (event, save rev R, instance) — `start`, the per-locale
// `set` / `skip` lines (keyed by `atLeastRev` = R) and `done` all carry
// the same three fields, so they group without any timing.
//
// Warm builds vs reader builds. The warm job calls the snapshot builder
// directly, so every locale it stored (`set`) or measured and dropped
// (`skip reason=oversize`) produced exactly one `[liveSnapshot] build`
// line: same instance, same locale, and the same ACTUAL rev the `set` /
// `skip` line reports (≥ R when a later save committed first). A
// `skip reason=build-error` built nothing (its builder logged
// `build-failed` instead). Each such locale is matched to one unclaimed
// build line with those three values, preferring a line from the same
// log entry (history mode: the warm job runs in the save request's
// `after()`, so its lines land in that request's entry, all stamped with
// the request's start time), else the nearest one within the job window
// (start − 2 s … start + done ms + 2 s; follow mode stamps every line on
// its own). That is "builds on the warm job's instance within the job
// window", narrowed to the locales and rev the job reports, so a reader
// request that happens to build the same rev on the same instance at the
// same moment is not mistaken for the job's. A locale with no matching
// build line (a capture gap) is reported as unmatched, not guessed.
// Reader builds at rev n = all build lines at rev n − matched warm
// builds at rev n.
export function warming(recs) {
  const by = (k) => recs.filter((r) => r.kind === k);
  const jobs = new Map();
  const jobOf = (f, revField) => {
    const key = `${f.event ?? "?"}:${f[revField] ?? "?"}:${f.instance ?? "?"}`;
    let j = jobs.get(key);
    if (!j) {
      jobs.set(key, (j = {
        event: f.event ?? null, rev: f[revField] ?? null, instance: f.instance ?? null,
        start: null, done: null, sets: [], skips: [], jobFailed: [], warmBuilds: 0, unmatched: 0, warmBuildRevs: {},
      }));
    }
    return j;
  };
  // `at` (and the other *At fields) = the server function's Date.now()
  // epoch ms (null on a log that predates them); `fault` / `source` = a
  // drill fault the job applied (`source=header|env`).
  for (const r of by("warmStart")) jobOf(r.f, "rev").start = { t: r.t, eid: r.eid, at: num(r.f.at), fault: r.f.fault ?? null, source: r.f.source ?? null };
  for (const r of by("warmDone")) jobOf(r.f, "rev").done = { t: r.t, eid: r.eid, ms: num(r.f.ms), at: num(r.f.at) };
  for (const r of by("warmJobFailed")) jobOf(r.f, "rev").jobFailed.push(String(r.f.err ?? "?").split(":")[0]);
  for (const r of by("warmSet")) {
    jobOf(r.f, "atLeastRev").sets.push({
      locale: r.f.locale ?? "?", rev: num(r.f.rev), bytes: num(r.f.bytes), buildMs: num(r.f.buildMs),
      setMs: num(r.f.setMs), ok: r.f.ok === "true", t: r.t, eid: r.eid,
      at: num(r.f.at), setStartAt: num(r.f.setStartAt), captureAt: num(r.f.captureAt),
      buildStartAt: num(r.f.buildStartAt), buildEndAt: num(r.f.buildEndAt),
      txStartAt: num(r.f.txStartAt), txEndAt: num(r.f.txEndAt), holdMs: num(r.f.holdMs),
    });
  }
  for (const r of by("warmSkip")) {
    jobOf(r.f, "atLeastRev").skips.push({
      locale: r.f.locale ?? "?", reason: r.f.reason ?? "?", rev: num(r.f.rev), bytes: num(r.f.bytes),
      buildMs: num(r.f.buildMs), t: r.t, eid: r.eid,
      at: num(r.f.at), buildStartAt: num(r.f.buildStartAt), buildEndAt: num(r.f.buildEndAt),
    });
  }

  // Match warm builds (see above).
  const builds = by("build");
  const claimed = new Set();
  const warmAtRev = new Map(); // actual rev → matched warm builds
  for (const j of jobs.values()) {
    const t0 = j.start?.t ?? null;
    const lo = t0 == null ? null : t0 - 2;
    const hi = t0 == null ? null : t0 + (j.done?.ms ?? 0) / 1000 + 2;
    const built = [...j.sets, ...j.skips.filter((x) => x.reason === "oversize")];
    for (const b of built) {
      const cands = builds.filter((x) =>
        !claimed.has(x) && x.f.instance === j.instance && x.f.locale === b.locale &&
        num(x.f.rev) === b.rev && (j.event == null || x.f.event === j.event));
      let pick = cands.find((x) => x.eid != null && (x.eid === b.eid || x.eid === j.start?.eid));
      if (!pick) {
        let best = null;
        for (const x of cands) {
          if (x.t == null) continue;
          const inWindow = lo != null ? x.t >= lo && x.t <= hi : b.t != null && Math.abs(x.t - b.t) <= 2;
          if (!inWindow) continue;
          const d = Math.abs(x.t - (b.t ?? t0));
          if (!best || d < best.d) best = { x, d };
        }
        pick = best?.x ?? null;
      }
      if (!pick) { j.unmatched++; continue; }
      claimed.add(pick);
      j.warmBuilds++;
      const rv = String(b.rev);
      j.warmBuildRevs[rv] = (j.warmBuildRevs[rv] || 0) + 1;
      warmAtRev.set(rv, (warmAtRev.get(rv) || 0) + 1);
    }
  }

  // warm-lookup results, whole run / per minute / per save rev.
  const resultOf = (v) => (WARM_RESULTS.includes(v) ? v : "other");
  const cols = [...WARM_RESULTS, "other"];
  const zero = () => Object.fromEntries(cols.map((k) => [k, 0]));
  const lookups = by("warmLookup");
  const counts = zero();
  const msBy = Object.fromEntries(cols.map((k) => [k, []]));
  const minutes = new Map();
  for (const r of lookups) {
    const k = resultOf(r.f.result);
    counts[k]++;
    const v = num(r.f.ms);
    if (v != null) msBy[k].push(v);
    if (r.t == null) continue;
    const m = Math.floor(r.t / 60);
    let g = minutes.get(m);
    if (!g) minutes.set(m, (g = { minute: m, total: 0, ...zero() }));
    g[k]++;
    g.total++;
  }
  const msByResult = Object.fromEntries(cols.filter((k) => msBy[k].length).map((k) => [k, { n: msBy[k].length, p50: pct(msBy[k], 0.5), p95: pct(msBy[k], 0.95) }]));

  // Per save rev. Revs come from the jobs (R), the lookups (minRev), the
  // hinted fetches (minRev) and the warm builds' actual revs; `minRev=none` / non-numeric are skipped.
  // "hinted fetches" = `[setlist] hint-fetch` lines with a numeric
  // minRev: the requests that are eligible for a lookup when the flag is
  // on (a 503 is still one — it is logged with verify=error).
  const hinted = by("hintFetch").filter((r) => num(r.f.minRev) != null);
  const revKeys = new Set();
  for (const j of jobs.values()) if (num(j.rev) != null) revKeys.add(String(num(j.rev)));
  for (const r of lookups) if (num(r.f.minRev) != null) revKeys.add(String(num(r.f.minRev)));
  for (const r of hinted) revKeys.add(String(num(r.f.minRev)));
  // A job for R can store a later rev (a newer save committed before
  // its build): that rev gets a row too, so its warm build is visible.
  for (const rv of warmAtRev.keys()) revKeys.add(rv);
  const buildsAtRev = new Map();
  for (const b of builds) {
    const rv = num(b.f.rev);
    if (rv != null) buildsAtRev.set(String(rv), (buildsAtRev.get(String(rv)) || 0) + 1);
  }
  const perRev = [...revKeys].sort((a, b) => Number(a) - Number(b)).map((rv) => {
    const lk = lookups.filter((r) => String(num(r.f.minRev)) === rv);
    const c = zero();
    for (const r of lk) c[resultOf(r.f.result)]++;
    const lms = lk.map((r) => num(r.f.ms)).filter((v) => v != null);
    const total = buildsAtRev.get(rv) || 0;
    const warm = warmAtRev.get(rv) || 0;
    const h = hinted.filter((r) => String(num(r.f.minRev)) === rv).length;
    const js = [...jobs.values()].filter((j) => String(num(j.rev)) === rv);
    return {
      rev: rv, jobs: js.length, doneMs: js.map((j) => j.done?.ms ?? null),
      builds: total, warmBuilds: warm, readerBuilds: total - warm,
      hinted: h, lookups: lk.length, results: c, lookupP50: pct(lms, 0.5), lookupP95: pct(lms, 0.95),
      hitRate: h ? c.hit / h : null,
    };
  });

  const skipsByReason = {};
  for (const j of jobs.values()) for (const s of j.skips) skipsByReason[s.reason] = (skipsByReason[s.reason] || 0) + 1;
  const jobList = [...jobs.values()].sort((a, b) => (num(a.rev) ?? Infinity) - (num(b.rev) ?? Infinity) || (a.start?.t ?? 0) - (b.start?.t ?? 0));
  return {
    seen: jobs.size + lookups.length + by("warmScheduleFailed").length + by("warmLookupError").length > 0,
    jobs: jobList,
    scheduleFailed: by("warmScheduleFailed").map((r) => ({ rev: r.f.rev ?? "?", err: String(r.f.err ?? "?").split(":")[0], t: r.t })),
    jobFailed: jobList.reduce((a, j) => a + j.jobFailed.length, 0),
    setNotOk: jobList.reduce((a, j) => a + j.sets.filter((s) => !s.ok).length, 0),
    setErrorLines: by("warmSetError").length,
    lookupErrorLines: by("warmLookupError").length,
    skipsByReason,
    warmBuilds: jobList.reduce((a, j) => a + j.warmBuilds, 0),
    unmatched: jobList.reduce((a, j) => a + j.unmatched, 0),
    lookups: { total: lookups.length, counts, msByResult, perMinute: [...minutes.values()].sort((a, b) => a.minute - b.minute) },
    hinted: hinted.length,
    hitRate: hinted.length ? counts.hit / hinted.length : null,
    perRev,
  };
}

export function summarise(text, { bucketS = 5, carryS = 5 } = {}) {
  const { recs, other, entries, duplicates } = parseLog(text);
  const by = (k) => recs.filter((r) => r.kind === k);
  const requests = by("request");

  // builds per rev
  const revs = new Map();
  for (const r of by("build")) {
    const rev = r.f.rev ?? "?";
    let g = revs.get(rev);
    if (!g) revs.set(rev, (g = { rev, builds: 0, instances: new Set(), locales: {}, ms: [], tMin: Infinity, tMax: -Infinity }));
    g.builds++;
    if (r.f.instance) g.instances.add(r.f.instance);
    if (r.f.locale) g.locales[r.f.locale] = (g.locales[r.f.locale] || 0) + 1;
    const ms = num(r.f.ms);
    if (ms != null) g.ms.push(ms);
    if (r.t != null) { g.tMin = Math.min(g.tMin, r.t); g.tMax = Math.max(g.tMax, r.t); }
  }
  const builds = [...revs.values()]
    .sort((a, b) => (num(a.rev) ?? Infinity) - (num(b.rev) ?? Infinity))
    .map((g) => ({
      rev: g.rev, builds: g.builds, instances: g.instances.size, locales: g.locales,
      avgMs: g.ms.length ? Math.round(g.ms.reduce((a, b) => a + b, 0) / g.ms.length) : null,
      maxMs: g.ms.length ? Math.max(...g.ms) : null,
      from: Number.isFinite(g.tMin) ? g.tMin : null, to: Number.isFinite(g.tMax) ? g.tMax : null,
    }));

  // failures / repair / coalescing
  const failedByErr = {};
  for (const r of by("buildFailed")) {
    const cls = String(r.f.err ?? "?").split(":")[0];
    failedByErr[cls] = (failedByErr[cls] || 0) + 1;
  }
  const revReads = by("revRead");
  const revReadTimeouts = revReads.filter((r) => r.f.rev === "timeout").length;
  const revReadMs = revReads.map((r) => num(r.f.ms)).filter((v) => v != null);
  // "1" = read caused by a notification fetch, "0" = any other request,
  // "—" = a line without the field (a server that predates it).
  const revReadByHint = {};
  for (const r of revReads) {
    const h = r.f.hint === "0" || r.f.hint === "1" ? r.f.hint : "—";
    revReadByHint[h] = (revReadByHint[h] || 0) + 1;
  }

  // hint outcomes (`[setlist] hint-fetch … verify=<kind> …`)
  const hintCols = [...HINT_KINDS, "other"];
  const zero = () => Object.fromEntries(hintCols.map((k) => [k, 0]));
  const hintCounts = zero();
  const hintMinutes = new Map();
  const hintFetches = by("hintFetch");
  for (const r of hintFetches) {
    const k = hintKind(r.f.verify);
    hintCounts[k]++;
    if (r.t == null) continue;
    const m = Math.floor(r.t / 60);
    let g = hintMinutes.get(m);
    if (!g) hintMinutes.set(m, (g = { minute: m, total: 0, ...zero() }));
    g[k]++;
    g.total++;
  }
  const hint = {
    total: hintFetches.length,
    counts: hintCounts,
    perMinute: [...hintMinutes.values()].sort((a, b) => a.minute - b.minute),
  };
  const coalesced = by("coalesced");
  const waiters = coalesced.map((r) => num(r.f.waiters)).filter((v) => v != null);

  // EMAXCONN
  // Every line that names EMAXCONN: the unhandled Prisma errors (their own
  // log entries) plus any typed line that carries it in a field, e.g. a
  // `build-failed … err=…EMAXCONN…` once the route catches the error.
  const emax = recs.filter((r) => r.emax);
  const emaxconn = {
    total: emax.length,
    api: emax.filter((r) => r.api).length,
    ssr: emax.filter((r) => !r.api).length,
    inTypedLines: emax.filter((r) => r.kind !== "emaxconn").length,
  };

  // writer
  const writerRoutes = new Map();
  for (const r of by("writer")) {
    const route = r.f.route ?? "?";
    let g = writerRoutes.get(route);
    if (!g) writerRoutes.set(route, (g = { route, n: 0, acquire: [], exec: [], failed: 0, values: [] }));
    g.n++;
    // Every save, in log order, with the explicit commit time `at`
    // (epoch ms; null on an older log) — listed when n ≤ 12.
    g.values.push({ rev: r.f.rev ?? null, acquireMs: num(r.f.acquireMs), execMs: num(r.f.execMs), ok: r.f.ok === "true", at: num(r.f.at), instance: r.f.instance ?? null });
    const a = num(r.f.acquireMs);
    const e = num(r.f.execMs);
    if (a != null) g.acquire.push(a);
    if (e != null) g.exec.push(e);
    if (r.f.ok === "false") g.failed++;
  }
  // Pre-execution failure kinds (pool_acquire_timeout / pooler_cap /
  // tx_max_wait / other) per route, from the `[liveWriter] failed` lines.
  const writerFailedKinds = new Map();
  for (const r of by("writerFailed")) {
    const route = r.f.route ?? "?";
    const kinds = writerFailedKinds.get(route) ?? new Map();
    kinds.set(r.f.kind ?? "?", (kinds.get(r.f.kind ?? "?") || 0) + 1);
    writerFailedKinds.set(route, kinds);
    if (!writerRoutes.has(route)) writerRoutes.set(route, { route, n: 0, acquire: [], exec: [], failed: 0, values: [] });
  }
  const writers = [...writerRoutes.values()].map((g) => ({
    route: g.route, n: g.n, failed: g.failed,
    failedKinds: [...(writerFailedKinds.get(g.route) ?? new Map()).entries()].map(([k, v]) => `${k} ${v}`).join(", "),
    acquireP50: pct(g.acquire, 0.5), acquireP95: pct(g.acquire, 0.95),
    execP50: pct(g.exec, 0.5), execP95: pct(g.exec, 0.95),
    acquireMax: g.acquire.length ? Math.max(...g.acquire) : null,
    values: g.n <= 12 ? [...g.values].sort((a, b) => (a.at ?? 0) - (b.at ?? 0)) : null,
  }));
  const revReadErrors = by("revReadError").length;

  const slow = by("slowHit").map((r) => num(r.f.ms)).filter((v) => v != null);

  // Warm-tag expiry (`[dataCache] expire-warm phase=start|done`), with the
  // request each line belongs to (method + path of its log entry).
  const entryOf = new Map(requests.map((r) => [r.eid, r]));
  const expireWarm = by("expireWarm").map((r) => ({
    phase: r.f.phase ?? "?", ok: r.f.ok ?? null, ms: num(r.f.ms), at: num(r.f.at), instance: r.f.instance ?? null,
    t: r.t, method: entryOf.get(r.eid)?.method ?? null, path: r.path,
  })).sort((a, b) => (a.at ?? 0) - (b.at ?? 0));

  // instances per minute (any record that names an instance)
  const minutes = new Map();
  const minuteOf = (t) => Math.floor(t / 60);
  for (const r of recs) {
    if (r.t == null) continue;
    const m = minuteOf(r.t);
    let g = minutes.get(m);
    if (!g) minutes.set(m, (g = { minute: m, instances: new Set(), builds: 0, emaxconn: 0, requests: 0 }));
    if (r.f?.instance) g.instances.add(r.f.instance);
    if (r.kind === "build") g.builds++;
    if (r.emax) g.emaxconn++;
    if (r.kind === "request") g.requests++;
  }
  const perMinute = [...minutes.values()].sort((a, b) => a.minute - b.minute)
    .map((g) => ({ minute: g.minute, instances: g.instances.size, builds: g.builds, emaxconn: g.emaxconn, requests: g.requests }));

  // pool totals per bucket
  const pools = by("pool")
    .filter((r) => r.t != null && r.f.instance && num(r.f.total) != null)
    .map((r) => ({ t: r.t, inst: r.f.instance, total: num(r.f.total), idle: num(r.f.idle), waiting: num(r.f.waiting) }))
    .sort((a, b) => a.t - b.t);
  const poolBuckets = [];
  if (pools.length) {
    const first = Math.floor(pools[0].t / bucketS) * bucketS;
    const last = pools[pools.length - 1].t;
    const lastSeen = new Map(); // inst → { t, total }
    let i = 0;
    for (let b = first; b <= last; b += bucketS) {
      const inBucket = new Map(); // inst → max total in this bucket
      let waiting = 0;
      for (; i < pools.length && pools[i].t < b + bucketS; i++) {
        const p = pools[i];
        inBucket.set(p.inst, Math.max(inBucket.get(p.inst) ?? 0, p.total));
        waiting = Math.max(waiting, p.waiting ?? 0);
        lastSeen.set(p.inst, { t: p.t, total: p.total });
      }
      let carried = 0;
      let carriedN = 0;
      for (const [inst, s] of lastSeen) {
        const v = inBucket.has(inst) ? inBucket.get(inst) : b - s.t <= carryS ? s.total : null;
        if (v != null) { carried += v; carriedN++; }
      }
      const reported = [...inBucket.values()].reduce((a, v) => a + v, 0);
      poolBuckets.push({ t: b, reportingInstances: inBucket.size, reported, carriedInstances: carriedN, carried, maxWaiting: waiting });
    }
  }

  const otherSorted = [...other.entries()].sort((a, b) => b[1] - a[1]);
  return {
    entries, duplicates,
    requests: {
      total: requests.length,
      setlistApi: requests.filter((r) => r.path.startsWith("/api/setlist")).length,
      otherApi: requests.filter((r) => r.path.startsWith("/api/") && !r.path.startsWith("/api/setlist")).length,
      pages: requests.filter((r) => !r.path.startsWith("/api/")).length,
      errors: requests.filter((r) => r.level === "error").length,
    },
    builds, buildTotal: by("build").length,
    buildFailed: { total: by("buildFailed").length, byErr: failedByErr },
    revRead: { total: revReads.length, timeouts: revReadTimeouts, errors: revReadErrors, p50: pct(revReadMs, 0.5), max: revReadMs.length ? Math.max(...revReadMs) : null, byHint: revReadByHint },
    hint,
    warm: warming(recs),
    coalesced: { lines: coalesced.length, waitersSum: waiters.reduce((a, b) => a + b, 0), waitersMax: waiters.length ? Math.max(...waiters) : null },
    emaxconn, writers, expireWarm,
    slowHit: { total: slow.length, maxMs: slow.length ? Math.max(...slow) : null },
    perMinute, poolBuckets,
    poolPeak: poolBuckets.reduce((m, b) => Math.max(m, b.carried), 0),
    other: otherSorted,
  };
}

const clock = (t, addH = 0) => {
  if (t == null) return "—";
  const s = (((t + addH * 3600) % 86400) + 86400) % 86400;
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(Math.floor(s % 60)).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
};
const d = (v) => (v == null ? "—" : String(v));

const pctTxt = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)} %`);

// The "Warming" section (see warming()).
function warmingMarkdown(L, w, addHours) {
  const cols = [...WARM_RESULTS, "other"];
  L.push(`### Warming (\`[liveWarm]\` jobs: ${w.jobs.length}; \`[setlist] warm-lookup\` lines: ${w.lookups.total})`);
  L.push("");
  // The run-level line comes first and is printed even with the flag off,
  // so a control run reads "0 hits of N hinted fetches", not nothing.
  L.push(`**warm hit rate = hits ÷ hinted fetches = ${w.lookups.counts.hit} / ${w.hinted} = ${pctTxt(w.hitRate)}** (hinted fetches = \`[setlist] hint-fetch\` lines with a numeric minRev; lookups ${w.lookups.total}).`);
  L.push("");
  if (!w.seen) {
    L.push("No warming lines in this capture (`LIVE_WARM_ENTRIES` unset on this deployment, or a server without writer warming).");
    L.push("");
    return;
  }
  L.push(`schedule-failed ${w.scheduleFailed.length}${w.scheduleFailed.length ? ` (${w.scheduleFailed.map((x) => `rev ${x.rev} ${x.err}`).join(", ")})` : ""}; job-failed ${w.jobFailed}; set ok=false ${w.setNotOk} (set-error lines ${w.setErrorLines}); skips ${Object.entries(w.skipsByReason).map(([k, v]) => `${k} ${v}`).join(", ") || "0"}; lookup-error lines ${w.lookupErrorLines}; warm builds matched ${w.warmBuilds}${w.unmatched ? `, **${w.unmatched} stored/oversize locale(s) without a matching build line** (capture gap?)` : ""}.`);
  L.push("");
  if (w.jobs.length) {
    L.push("Warm jobs. start → done = the job's own `done ms=` (it starts in `after()`, i.e. right after the save's response, so it is ≈ warm-complete − commit). Per locale: actual rev, bytes, build / set ms, ok.");
    L.push("");
    L.push("| save rev | instance | start (log clock) | start → done ms | sets | skips | warm builds (unmatched) | job-failed |");
    L.push("|---|---|---|---|---|---|---|---|");
    for (const j of w.jobs) {
      const sets = j.sets.map((x) => `${x.locale} r${d(x.rev)} ${d(x.bytes)} B ${d(x.buildMs)}/${d(x.setMs)} ms${x.ok ? "" : " **ok=false**"}`).join("; ") || "—";
      const skips = j.skips.map((x) => `${x.locale} ${x.reason}${x.rev != null ? ` r${x.rev}` : ""} ${d(x.buildMs)} ms`).join("; ") || "—";
      L.push(`| ${d(j.rev)} | ${d(j.instance)} | ${clock(j.start?.t, addHours)} | ${d(j.done?.ms)}${j.done ? "" : " (no done)"} | ${sets} | ${skips} | ${j.warmBuilds}${j.unmatched ? ` (${j.unmatched})` : ""} | ${j.jobFailed.join(", ") || "—"} |`);
    }
    L.push("");
  }
  L.push("Per save rev. builds = every `[liveSnapshot] build` at that rev; warm = the ones matched to a warm job (same instance, locale, rev); reader = the rest. Lookups and hinted fetches are keyed by their `minRev`.");
  L.push("");
  L.push(`| save rev | warm jobs | start → done ms | builds | warm | reader | hinted fetches | lookups | ${cols.join(" | ")} | lookup ms p50 / p95 | hit rate |`);
  L.push(`|---|---|---|---|---|---|---|---|${cols.map(() => "---").join("|")}|---|---|`);
  for (const r of w.perRev) {
    L.push(`| ${r.rev} | ${r.jobs} | ${r.doneMs.map(d).join(", ") || "—"} | ${r.builds} | ${r.warmBuilds} | ${r.readerBuilds} | ${r.hinted} | ${r.lookups} | ${cols.map((k) => r.results[k]).join(" | ")} | ${d(r.lookupP50)} / ${d(r.lookupP95)} | ${pctTxt(r.hitRate)} |`);
  }
  L.push("");
  if (w.lookups.total) {
    L.push(`Lookup ms by result (p50 / p95, n): ${Object.entries(w.lookups.msByResult).map(([k, v]) => `${k} ${d(v.p50)} / ${d(v.p95)} (${v.n})`).join("; ")}. Whole capture: ${cols.map((k) => `${k} ${w.lookups.counts[k]}`).join(", ")}.`);
    L.push("");
    L.push(`| minute | lookups | ${cols.join(" | ")} |`);
    L.push(`|---|---|${cols.map(() => "---").join("|")}|`);
    for (const m of w.lookups.perMinute) L.push(`| ${clock(m.minute * 60, addHours).slice(0, 5)} | ${m.total} | ${cols.map((k) => m[k]).join(" | ")} |`);
    L.push("");
  }
}

export function toMarkdown(s, { addHours = 0, bucketS = 5, carryS = 5, source = "" } = {}) {
  const L = [];
  const tz = addHours ? `log clock ${addHours > 0 ? "+" : ""}${addHours} h` : "log clock (CLI machine local time)";
  L.push(`## Vercel runtime logs${source ? ` — ${source}` : ""}`);
  L.push("");
  L.push(`${s.entries} entries${s.duplicates ? ` (+${s.duplicates} repeated by overlapping capture segments, dropped)` : ""}; requests: /api/setlist ${s.requests.setlistApi}, other API ${s.requests.otherApi}, pages ${s.requests.pages}; error-level entries ${s.requests.errors}. Times: ${tz}.`);
  L.push("");
  L.push(`### Builds per rev (\`[liveSnapshot] build\` lines: ${s.buildTotal})`);
  L.push("");
  L.push("| rev | builds | distinct instances | locales | build ms avg / max | first – last |");
  L.push("|---|---|---|---|---|---|");
  for (const b of s.builds) {
    L.push(`| ${b.rev} | ${b.builds} | ${b.instances} | ${Object.entries(b.locales).map(([k, v]) => `${k} ${v}`).join(", ")} | ${d(b.avgMs)} / ${d(b.maxMs)} | ${clock(b.from, addHours)} – ${clock(b.to, addHours)} |`);
  }
  L.push("");
  L.push("### Failures, repair reads, coalescing");
  L.push("");
  L.push("| what | count | detail |");
  L.push("|---|---|---|");
  L.push(`| EMAXCONN (pooler client cap) | ${s.emaxconn.total} | API ${s.emaxconn.api}, SSR ${s.emaxconn.ssr}${s.emaxconn.inTypedLines ? ` (${s.emaxconn.inTypedLines} inside build-failed / writer lines)` : ""} |`);
  L.push(`| \`[liveSnapshot] build-failed\` | ${s.buildFailed.total} | ${Object.entries(s.buildFailed.byErr).map(([k, v]) => `${k} ${v}`).join(", ") || "—"} |`);
  L.push(`| \`[liveSnapshot] rev-read\` (repair revision read) | ${s.revRead.total} | rev=timeout ${s.revRead.timeouts}, rev=error ${s.revRead.errors}; ms p50 ${d(s.revRead.p50)} / max ${d(s.revRead.max)}; by hint: ${["1", "0", "—"].filter((k) => s.revRead.byHint[k]).map((k) => `hint=${k} ${s.revRead.byHint[k]}`).join(", ") || "—"} |`);
  L.push(`| \`[liveSnapshot] coalesced\` | ${s.coalesced.lines} | waiters sum ${s.coalesced.waitersSum}, max ${d(s.coalesced.waitersMax)} |`);
  L.push(`| \`[setlist] slow-hit\` | ${s.slowHit.total} | max ${d(s.slowHit.maxMs)} ms |`);
  L.push("");
  L.push(`### Hint outcomes (\`[setlist] hint-fetch\` lines: ${s.hint.total})`);
  L.push("");
  if (!s.hint.total) {
    L.push("No `[setlist] hint-fetch` lines in this capture (an R1 server, or no `hint=1` request).");
  } else {
    const cols = [...HINT_KINDS, "other"];
    L.push(`Whole capture: ${cols.map((k) => `${k} ${s.hint.counts[k]}`).join(", ")}. "other" = a \`verify=\` value this script does not know.`);
    L.push("");
    L.push(`| minute | hint fetches | ${cols.join(" | ")} |`);
    L.push(`|---|---|${cols.map(() => "---").join("|")}|`);
    for (const m of s.hint.perMinute) L.push(`| ${clock(m.minute * 60, addHours).slice(0, 5)} | ${m.total} | ${cols.map((k) => m[k]).join(" | ")} |`);
  }
  L.push("");
  warmingMarkdown(L, s.warm, addHours);
  if (s.writers.length) {
    L.push("### Admin writes (`[liveWriter]`)");
    L.push("");
    L.push("| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |");
    L.push("|---|---|---|---|---|---|");
    for (const w of s.writers) L.push(`| ${w.route} | ${w.n} | ${d(w.acquireP50)} / ${d(w.acquireP95)} | ${d(w.execP50)} / ${d(w.execP95)} | ${w.failed} | ${w.failedKinds || "—"} |`);
    L.push("");
    // Every save of a route with ≤ 12 saves (a drill's handful): rev,
    // acquire / exec ms, ok, and the explicit commit time `at`.
    const listed = s.writers.filter((w) => w.values && w.values.some((x) => x.at != null));
    if (listed.length) {
      L.push("Every save (routes with ≤ 12 saves; `at` = the server's commit time, epoch ms → UTC):");
      L.push("");
      L.push("| route | rev | acquire ms | exec ms | ok | at (UTC) | instance |");
      L.push("|---|---|---|---|---|---|---|");
      for (const w of listed) for (const x of w.values) L.push(`| ${w.route} | ${d(x.rev)} | ${d(x.acquireMs)} | ${d(x.execMs)} | ${x.ok} | ${x.at != null ? new Date(x.at).toISOString() : "—"} | ${d(x.instance)} |`);
      L.push("");
    }
  }
  if (s.expireWarm.length) {
    L.push(`### Warm expiry (\`[dataCache] expire-warm\` lines: ${s.expireWarm.length})`);
    L.push("");
    L.push("The warm-tag expiry run by `revalidatePublicData()` (catalog edits). start = before `expireTag`, done = when it settled. `at` = server epoch ms.");
    L.push("");
    L.push("| request | phase | ok | ms | at (UTC) | instance |");
    L.push("|---|---|---|---|---|---|");
    for (const x of s.expireWarm) L.push(`| ${x.method ?? ""} ${d(x.path)} | ${x.phase} | ${d(x.ok)} | ${d(x.ms)} | ${x.at != null ? new Date(x.at).toISOString() : "—"} | ${d(x.instance)} |`);
    L.push("");
  }
  L.push("### Per minute");
  L.push("");
  L.push("| minute | requests | distinct instances | builds | EMAXCONN |");
  L.push("|---|---|---|---|---|");
  for (const m of s.perMinute) L.push(`| ${clock(m.minute * 60, addHours).slice(0, 5)} | ${m.requests} | ${m.instances} | ${m.builds} | ${m.emaxconn} |`);
  L.push("");
  L.push(`### Prisma pool totals per ${bucketS} s (app-side estimate of pooler clients)`);
  L.push("");
  if (!s.poolBuckets.length) {
    L.push("No `[prisma] pool total=… instance=…` lines in this capture.");
  } else {
    L.push(`Peak carried sum: **${s.poolPeak}** (carry ${carryS} s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for ${carryS} s after its last line.`);
    L.push("");
    L.push("| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |");
    L.push("|---|---|---|---|---|---|");
    for (const b of s.poolBuckets) {
      if (!b.reportingInstances && !b.carriedInstances) continue;
      L.push(`| ${clock(b.t, addHours)} | ${b.reportingInstances} | ${b.reported} | ${b.carriedInstances} | ${b.carried} | ${b.maxWaiting} |`);
    }
  }
  L.push("");
  L.push("### Other lines");
  L.push("");
  if (!s.other.length) L.push("none");
  else {
    L.push("| kind | count |");
    L.push("|---|---|");
    for (const [k, v] of s.other.slice(0, 15)) L.push(`| ${k.replace(/\|/g, "/")} | ${v} |`);
    if (s.other.length > 15) L.push(`| (${s.other.length - 15} more kinds) | ${s.other.slice(15).reduce((a, [, v]) => a + v, 0)} |`);
  }
  L.push("");
  return L.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("usage: node tests/load/vercel-logs-summary.mjs <logfile> [--add-hours=N] [--bucket=5] [--carry=5] [--out=file.md]");
    process.exit(2);
  }
  const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const [k, v] = a.slice(2).split("=");
    return [k, v ?? true];
  }));
  const bucketS = parseFloat(opt.bucket ?? "5") || 5;
  const carryS = parseFloat(opt.carry ?? "5");
  const addHours = parseFloat(opt["add-hours"] ?? "0") || 0;
  const s = summarise(fs.readFileSync(file, "utf8"), { bucketS, carryS });
  const md = toMarkdown(s, { addHours, bucketS, carryS, source: file.replace(/\\/g, "/").split("/").pop() });
  if (opt.out) fs.writeFileSync(opt.out, md);
  console.log(md);
}
