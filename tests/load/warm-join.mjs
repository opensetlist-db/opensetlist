// Join a browsers run (writer warming on) with its Vercel history logs:
// did the notification fetches arrive before or after the save's warm
// entry existed, and did the ones that came after actually hit it?
//
//   node tests/load/warm-join.mjs <browsers.json> <vercel-logs-history.txt>
//        [--add-hours=N] [--warm-concurrency=2] [--locales=ko,ja,en]
//        [--out=<file.md>]
//
// Why a separate step: the harness sees its own requests (send time,
// `x-snapshot-source`) but not the server's warm job, which only shows
// up in the Vercel logs — and those are re-fetched in history mode after
// the run (the `--follow` capture is not the record). run.mjs writes, per
// save, the commit proxy and every client's FIRST notification fetch of
// that save into the JSON's `warm` section; this script reads the warm
// jobs from the logs (the summariser's own parser, vercel-logs-summary.mjs
// `warming()`), and puts the two side by side per save and locale.
//
// The timeline, all relative to the commit proxy (the end of the PUT
// that succeeded, on this machine's clock — the server commits, answers,
// then starts the warm job in `after()`, so job start ≈ commit):
//
//   - request arrival − commit: the client's send time − commit (SDK:
//     the scheduler's dispatch; pages: the browser's request start). The
//     server sees it about half a round trip later; the lookup happens
//     right on arrival.
//   - warm-complete − commit, per locale: when that locale's entry was
//     stored, measured from the job start. A history-mode log stamps
//     every line of the save request (the warm job's lines included)
//     with the request's START time, so the per-locale offsets are
//     REBUILT from the job's own numbers: the job runs the locales from a
//     queue in `--locales` order with `--warm-concurrency` workers (the
//     server's default 2; 1 when LIVE_WARM_CONCURRENCY=1), each locale
//     taking buildMs + setMs from its `set` line. The job's `done ms=`
//     minus the last rebuilt completion is printed as "unaccounted"
//     (encode, module load, scheduling) — when it is large, the rebuilt
//     offsets are early by up to that much. A follow-mode log, where
//     each line has its own time, gives the offsets directly
//     (set line time − start line time) and is used when present.
//   - "after" = arrival − commit > that locale's warm-complete − commit:
//     the entry existed when the request left (± half a round trip).
//     A hit is `x-snapshot-source: warm`. The design question is whether
//     hits ≈ "after" (the entry is used as soon as it exists) and how many
//     notification fetches come before the entry can exist at all.
//
// A request whose minRev differs from the save's rev (its ticket was
// merged into a later save, or the client already knew a newer rev)
// looks up a different key; it is counted under "minRev ≠ rev".
//
// `--add-hours` is only used for a sanity column: the log's `[liveWriter]`
// entry time for the save (log clock + N h → UTC) against the harness's
// PUT start, which should differ by a few hundred ms (clock skew + one-
// way latency). A difference of minutes means the two files do not
// belong together.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { parseLog, warming } from "./vercel-logs-summary.mjs";

function pct(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
}
const d = (v) => (v == null ? "—" : String(Math.round(v)));
const share = (a, b) => (b ? `${a}/${b} (${((a / b) * 100).toFixed(0)} %)` : "0/0");

// Per-locale completion offsets (ms from job start) — see the header.
// Returns { offsets: {locale: ms}, how: "log" | "rebuilt", unaccounted }.
export function localeOffsets(job, { concurrency = 2, order = ["ko", "ja", "en"] } = {}) {
  const lines = [...job.sets.map((x) => ({ ...x, kind: "set" })), ...job.skips.map((x) => ({ ...x, kind: "skip" }))];
  const t0 = job.start?.t ?? null;
  // Follow mode: every line has its own time, distinct from the start's.
  const ownTimes = t0 != null && lines.length > 0 && lines.every((x) => x.t != null && x.eid !== job.start.eid && x.t >= t0);
  if (ownTimes) {
    const offsets = {};
    for (const x of lines) offsets[x.locale] = Math.round((x.t - t0) * 1000);
    const last = Math.max(...Object.values(offsets));
    return { offsets, how: "log", unaccounted: job.done?.ms != null ? job.done.ms - last : null };
  }
  const dur = (x) => (x.buildMs ?? 0) + (x.kind === "set" ? x.setMs ?? 0 : 0);
  const byLocale = new Map(lines.map((x) => [x.locale, x]));
  const queue = [...order.filter((l) => byLocale.has(l)), ...[...byLocale.keys()].filter((l) => !order.includes(l))];
  const free = Array.from({ length: Math.max(1, concurrency) }, () => 0);
  const offsets = {};
  for (const l of queue) {
    let w = 0;
    for (let i = 1; i < free.length; i++) if (free[i] < free[w]) w = i;
    free[w] += dur(byLocale.get(l));
    offsets[l] = free[w];
  }
  const last = queue.length ? Math.max(...Object.values(offsets)) : 0;
  return { offsets, how: "rebuilt", unaccounted: job.done?.ms != null ? job.done.ms - last : null };
}

export function join(json, logText, { addHours = 0, concurrency = 2, order = ["ko", "ja", "en"] } = {}) {
  const saves = json?.warm?.saves;
  if (!Array.isArray(saves)) throw new Error("browsers JSON has no `warm.saves` section (written by an older run.mjs?)");
  const { recs } = parseLog(logText);
  const w = warming(recs);
  const writers = recs.filter((r) => r.kind === "writer" && r.f.ok === "true");
  const out = [];
  for (const s of saves) {
    const rev = String(s.rev);
    const jobs = w.jobs.filter((j) => String(j.rev) === rev);
    const job = jobs[0] ?? null;
    const off = job ? localeOffsets(job, { concurrency, order }) : null;
    const stored = new Set(job ? job.sets.filter((x) => x.ok).map((x) => x.locale) : []);
    // Sanity: log writer time (UTC seconds of day) − harness PUT start.
    const wr = writers.find((r) => String(r.f.rev) === rev);
    let skewMs = null;
    if (wr && wr.t != null && s.putStart != null) {
      const logTod = (((wr.t + addHours * 3600) % 86400) + 86400) % 86400;
      const putTod = ((s.putStart / 1000) % 86400 + 86400) % 86400;
      let diff = logTod - putTod;
      if (diff > 43200) diff -= 86400;
      if (diff < -43200) diff += 86400;
      skewMs = Math.round(diff * 1000);
    }
    const perRev = w.perRev.find((x) => x.rev === rev) ?? null;
    const rank = (l) => (order.includes(l) ? order.indexOf(l) : order.length);
    const locales = [...new Set([...s.sdk.map((x) => x[1]), ...s.pages.map((x) => x[1]), ...(off ? Object.keys(off.offsets) : [])])]
      .sort((a, b) => rank(a) - rank(b));
    const rows = locales.map((locale) => {
      const complete = off && stored.has(locale) ? off.offsets[locale] ?? null : null;
      const pop = (list) => {
        const mine = list.filter((x) => x[1] === locale);
        const sameKey = mine.filter((x) => String(x[6]) === rev);
        const after = complete == null ? [] : sameKey.filter((x) => x[2] > complete);
        const before = complete == null ? sameKey : sameKey.filter((x) => x[2] <= complete);
        const hits = (xs) => xs.filter((x) => x[4] === "warm").length;
        return {
          n: mine.length, otherKey: mine.length - sameKey.length,
          arrivalP50: pct(mine.map((x) => x[2]), 0.5), arrivalP95: pct(mine.map((x) => x[2]), 0.95),
          after: after.length, afterHits: hits(after), before: before.length, beforeHits: hits(before),
          hits: hits(mine),
        };
      };
      return { locale, stored: stored.has(locale), complete, sdk: pop(s.sdk), pages: pop(s.pages) };
    });
    out.push({
      k: s.k, rev, putEndIso: s.putEndIso, job: job ? { instance: job.instance, doneMs: job.done?.ms ?? null, jobs: jobs.length } : null,
      how: off?.how ?? null, unaccounted: off?.unaccounted ?? null, skewMs,
      logLookups: perRev ? { lookups: perRev.lookups, hits: perRev.results.hit, hinted: perRev.hinted, reader: perRev.readerBuilds, warm: perRev.warmBuilds } : null,
      rows,
    });
  }
  // Run level, per population.
  const total = (pop) => {
    const t = { n: 0, after: 0, afterHits: 0, before: 0, beforeHits: 0, hits: 0, otherKey: 0 };
    for (const s of out) for (const r of s.rows) for (const k of Object.keys(t)) t[k] += r[pop][k];
    return t;
  };
  return { saves: out, sdk: total("sdk"), pages: total("pages"), jobsInLogs: w.jobs.length };
}

export function toMarkdown(j, { source = "" } = {}) {
  const L = [];
  L.push(`## Warm join${source ? ` — ${source}` : ""}`);
  L.push("");
  L.push("Per save and locale: warm-complete − commit (commit proxy = the PUT's response), and each client's FIRST notification fetch of the save split by whether it left after that locale's entry existed. hit = `x-snapshot-source: warm`.");
  L.push("");
  for (const [name, t] of [["SDK", j.sdk], ["pages", j.pages]]) {
    L.push(`- **${name}**: first hinted fetches ${t.n}; arrived after warm-complete ${share(t.after, t.n - t.otherKey)}; hit rate after ${share(t.afterHits, t.after)}, before ${share(t.beforeHits, t.before)}; all hits ${t.hits}; minRev ≠ rev ${t.otherKey}`);
  }
  L.push(`- warm jobs in the logs: ${j.jobsInLogs}`);
  L.push("");
  L.push("| # | rev | warm job (start → done ms) | offsets | log PUT − harness PUT ms | log: lookups / hits / hinted; builds warm / reader | locale | entry | warm-complete − commit ms | SDK: n, arrival p50 / p95, after (hits) / before (hits) | pages: same |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const s of j.saves) {
    const job = s.job ? `${s.job.instance} (${d(s.job.doneMs)})${s.job.jobs > 1 ? ` +${s.job.jobs - 1} more` : ""}` : "none in the logs";
    const how = s.how ? `${s.how}${s.unaccounted != null ? `, unaccounted ${d(s.unaccounted)} ms` : ""}` : "—";
    const lg = s.logLookups ? `${s.logLookups.lookups} / ${s.logLookups.hits} / ${s.logLookups.hinted}; ${s.logLookups.warm} / ${s.logLookups.reader}` : "—";
    const cell = (p) => `${p.n}, ${d(p.arrivalP50)} / ${d(p.arrivalP95)}, ${p.after} (${p.afterHits}) / ${p.before} (${p.beforeHits})${p.otherKey ? `, minRev ≠ rev ${p.otherKey}` : ""}`;
    s.rows.forEach((r, i) => {
      const head = i === 0 ? `| ${s.k} | ${s.rev} | ${job} | ${how} | ${d(s.skewMs)} | ${lg} ` : "| | | | | | ";
      L.push(`${head}| ${r.locale} | ${r.stored ? "stored" : "—"} | ${d(r.complete)} | ${cell(r.sdk)} | ${cell(r.pages)} |`);
    });
    if (!s.rows.length) L.push(`| ${s.k} | ${s.rev} | ${job} | ${how} | ${d(s.skewMs)} | ${lg} | — | — | — | — | — |`);
  }
  L.push("");
  return L.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (files.length !== 2) {
    console.error("usage: node tests/load/warm-join.mjs <browsers.json> <vercel-logs-history.txt> [--add-hours=N] [--warm-concurrency=2] [--locales=ko,ja,en] [--out=file.md]");
    process.exit(2);
  }
  const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const [k, v] = a.slice(2).split("=");
    return [k, v ?? true];
  }));
  const json = JSON.parse(fs.readFileSync(files[0], "utf8"));
  const j = join(json, fs.readFileSync(files[1], "utf8"), {
    addHours: parseFloat(opt["add-hours"] ?? "0") || 0,
    concurrency: parseInt(opt["warm-concurrency"] ?? "2", 10) || 2,
    order: String(opt.locales ?? "ko,ja,en").split(","),
  });
  const md = toMarkdown(j, { source: files.map((f) => f.replace(/\\/g, "/").split("/").pop()).join(" + ") });
  if (opt.out) fs.writeFileSync(opt.out, md);
  console.log(md);
}
