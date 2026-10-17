// Transition sampler (n14 qualification step 8, check C): read-only
// sampling of the event page and /api/setlist on the production domain
// while the operator promotes a deployment / runs Instant Rollback in
// Vercel, to time the switch as visitors see it.
//
//   node tests/load/transition-sampler.mjs --prod-readonly --base=https://opensetlist.com
//        --event-id=<n> --path=/<locale>/events/<n>/<slug> --expect=<dpl_… after the switch>
//        [--duration-s=300] [--interval-ms=250] [--stop-file=<path>] [--out=<dir>] [--label=<name>]
//
// --event-id AND --path are both required (no dev defaults); --path must
// be the canonical path (no redirect hop) and name the same event;
// --prod-readonly is required for any base but the dev alias / localhost;
// only these flags are accepted (prod-readonly.mjs `validateSampler`).
//
// Two independent loops on a fixed schedule (`interval-ms`, default
// 250 ms each, the API loop offset by half an interval), each allowing at
// most 4 requests in flight so a cold-start stall does not pile up:
//   doc  GET <base><path> (redirect: manual) — the body's `data-dpl-id`
//        (Skew Protection stamps the SERVING deployment on <html>; same
//        reading as browsers/transition.mjs `dplIdOf`) is the positive
//        attribution of who answered;
//   api  GET /api/setlist?eventId=<n>&locale=<path locale> — no header
//        names the deployment, so x-vercel-id is recorded for a later
//        join with `vercel logs` per deployment (transition-join.mjs /
//        attribution-smoke.mjs do that join; mapping ids to deployments
//        with `vercel inspect` is the operator's side).
// ~8 GETs/s against the production domain for a few minutes: well
// inside normal traffic, and nothing but GETs.
//
// Derived (pure `samplerSummary`, covered by transition-sampler.test.mjs):
// the doc answers' deployment timeline (runs of the same data-dpl-id),
// the first answer from --expect, the last answer from any other
// deployment (the old one's tail), "sustained from" = the first expected
// answer after which no other deployment answered, flip count, statuses
// per loop and the 5xx / transport errors around the switch.
//
// Times: this host's clock, epoch ms, rendered in UTC. Write the
// operator's click time (Vercel UI / `vercel promote` output) next to
// the timeline: the switch latency is "first expected answer − click".
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, validateSampler } from "./prod-readonly.mjs";
import { dplIdOf } from "./browsers/transition.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAX_INFLIGHT = 4;
export const MAX_UNATTRIBUTED = 0.2;
const TIMEOUT_MS = 15_000;
const iso = (t) => (t == null ? "–" : new Date(t).toISOString().slice(11, 23));

// ─── analysis (pure) ───

// `samples`: [{ kind: "doc" | "api", tStart, tEnd, status, dpl, vercelId,
// error }]; doc samples are ordered by tStart for the timeline.
export function samplerSummary(samples, expect) {
  const docs = samples.filter((s) => s.kind === "doc").sort((a, b) => a.tStart - b.tStart);
  const api = samples.filter((s) => s.kind === "api").sort((a, b) => a.tStart - b.tStart);
  const attributed = docs.filter((s) => s.dpl);
  const runs = [];
  for (const s of attributed) {
    const cur = runs.at(-1);
    if (cur && cur.dpl === s.dpl) { cur.to = s.tStart; cur.n++; } else runs.push({ dpl: s.dpl, from: s.tStart, to: s.tStart, n: 1 });
  }
  const firstExpected = attributed.find((s) => s.dpl === expect) ?? null;
  const others = attributed.filter((s) => s.dpl !== expect);
  const lastOld = others.at(-1) ?? null;
  const sustained = lastOld == null ? firstExpected : attributed.find((s) => s.dpl === expect && s.tStart > lastOld.tStart) ?? null;
  const flips = Math.max(0, runs.length - 1);
  const statuses = (list) => list.reduce((a, s) => { const k = s.error ? `error:${s.error}` : String(s.status); a[k] = (a[k] || 0) + 1; return a; }, {});
  const bad = (s) => s.error != null || s.status >= 500;
  const oldIds = [...new Set(others.map((s) => s.dpl))];
  // Document answers without a data-dpl-id (errors, 5xx, an error page,
  // a body cut short) say nothing about who served them. They are
  // counted, and when they are more than MAX_UNATTRIBUTED of the
  // document samples the timeline has holes big enough to hide an old
  // deployment's tail — no SWITCHED / ALREADY SWITCHED is claimed then.
  const unattributed = docs.length - attributed.length;
  const unattributedShare = docs.length ? unattributed / docs.length : 1;
  let verdict;
  if (!attributed.length) verdict = "NO DATA";
  else if (unattributedShare > MAX_UNATTRIBUTED) verdict = "INSUFFICIENT ATTRIBUTION";
  else if (!firstExpected) verdict = "NOT SWITCHED";
  else if (!others.length) verdict = "ALREADY SWITCHED";
  else if (attributed.at(-1).dpl !== expect) verdict = "NOT SUSTAINED";
  else verdict = "SWITCHED";
  return {
    expect, verdict, runs, flips, oldIds,
    firstExpected: firstExpected ? { tStart: firstExpected.tStart, tEnd: firstExpected.tEnd } : null,
    lastOld: lastOld ? { tStart: lastOld.tStart, tEnd: lastOld.tEnd, dpl: lastOld.dpl } : null,
    sustainedFrom: sustained ? sustained.tStart : null,
    // The old deployment's tail: how long after the first expected
    // answer the old one still answered (negative = clean cut-over).
    overlapMs: firstExpected && lastOld ? lastOld.tStart - firstExpected.tStart : null,
    docs: { n: docs.length, attributed: attributed.length, unattributed, unattributedShare: +unattributedShare.toFixed(3), statuses: statuses(docs), bad: docs.filter(bad).length },
    api: { n: api.length, statuses: statuses(api), bad: api.filter(bad).length, badAfterSwitch: firstExpected ? api.filter((s) => bad(s) && s.tStart >= firstExpected.tStart - 5000).length : null },
  };
}

// Process exit code per verdict, so a caller (the step 8 operator script,
// a CI job) cannot mistake "the sampler ran" for "the switch happened":
// 0 only for SWITCHED; 1 when the switch was observed to fail (NOT
// SWITCHED, NOT SUSTAINED); 4 (NOT EXERCISED) when the run holds no
// evidence either way — ALREADY SWITCHED (the target was serving before
// sampling started), INSUFFICIENT ATTRIBUTION, NO DATA. The same 0/1/4
// vocabulary as wake-check.mjs and run.mjs.
export function samplerExitCode(verdict) {
  if (verdict === "SWITCHED") return 0;
  if (verdict === "NOT SWITCHED" || verdict === "NOT SUSTAINED") return 1;
  return 4;
}

export function samplerMarkdown(s, meta) {
  const L = [];
  L.push(`# Transition sampler${meta.label ? ` — ${meta.label}` : ""} — ${s.verdict}`, "");
  L.push(`- base ${meta.base} (${meta.baseKind}) · path \`${meta.path}\` · event ${meta.eventId} · expected after the switch: ${s.expect}`);
  L.push(`- host \`${meta.host}\` · window ${meta.startedAt} → ${meta.endedAt} (UTC) · ended by ${meta.endReason} · every ${meta.intervalMs} ms per loop`);
  L.push("- clock: this host's clock, UTC. Switch latency = first expected answer − the operator's promote / rollback click time.");
  L.push("");
  L.push(`- first answer from ${s.expect}: ${s.firstExpected ? `${iso(s.firstExpected.tStart)} (request start) → ${iso(s.firstExpected.tEnd)}` : "**none**"}`);
  L.push(`- last answer from another deployment: ${s.lastOld ? `${iso(s.lastOld.tStart)} (${s.lastOld.dpl})` : "none in the window"}${s.overlapMs != null ? ` · old tail after the first expected answer: ${s.overlapMs} ms` : ""}`);
  L.push(`- sustained on ${s.expect} from: ${iso(s.sustainedFrom)} · flips: ${s.flips} · other deployments seen: ${s.oldIds.join(", ") || "–"}`);
  L.push(`- doc samples ${s.docs.n} (attributed ${s.docs.attributed}, **unattributed ${s.docs.unattributed}** = ${Math.round(s.docs.unattributedShare * 100)} %; > ${MAX_UNATTRIBUTED * 100} % → INSUFFICIENT ATTRIBUTION) statuses ${JSON.stringify(s.docs.statuses)} · 5xx/errors ${s.docs.bad}`);
  L.push(`- api samples ${s.api.n} statuses ${JSON.stringify(s.api.statuses)} · 5xx/errors ${s.api.bad}${s.api.badAfterSwitch != null ? ` (${s.api.badAfterSwitch} from 5 s before the first expected answer on)` : ""}`);
  L.push("", "## Deployment timeline (document answers, by request start)", "", "| from (UTC) | to (UTC) | data-dpl-id | samples |", "|---|---|---|---|");
  for (const r of s.runs) L.push(`| ${iso(r.from)} | ${iso(r.to)} | ${r.dpl}${r.dpl === s.expect ? " (expected)" : ""} | ${r.n} |`);
  L.push("", "API answers carry no deployment id; their x-vercel-id values are in the JSON for a `vercel logs` join per deployment.");
  return L.join("\n") + "\n";
}

// ─── runner ───

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const { errors, config: cfg } = validateSampler(args, argv.filter((a) => !a.startsWith("--")));
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(2);
  }
  const now = new Date();
  const startedAt = Date.now();
  const outDir = cfg.out ?? path.join(HERE, "results", now.toISOString().slice(0, 10));
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const outBase = path.join(outDir, `${stamp}-transition-sampler${cfg.label ? `-${cfg.label}` : ""}`);
  const stopFile = cfg.stopFile ?? path.join(outDir, "transition-sampler.STOP");
  const log = (m) => console.log(`${new Date().toISOString().slice(11, 23)} ${m}`);
  const locale = cfg.path.split("/")[1];
  const meta = {
    host: os.hostname(), base: cfg.base, baseKind: cfg.baseKind, eventId: cfg.eventId, path: cfg.path, expect: cfg.expect,
    intervalMs: cfg.intervalMs, durationS: cfg.durationS, label: cfg.label, stopFile,
    startedAt: now.toISOString(), endedAt: null, endReason: null,
  };
  const samples = [];
  const inflight = { doc: new Set(), api: new Set() };
  let lastDpl = null;
  let stopping = false;

  const one = async (kind) => {
    const url = kind === "doc" ? `${cfg.base}${cfg.path}` : `${cfg.base}/api/setlist?eventId=${encodeURIComponent(cfg.eventId)}&locale=${locale}`;
    const s = { kind, tStart: Date.now(), tEnd: null, status: 0, dpl: null, vercelId: null, cache: null, source: null, rev: null, error: null };
    try {
      const res = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
      s.status = res.status;
      s.vercelId = res.headers.get("x-vercel-id");
      s.cache = res.headers.get("x-vercel-cache");
      const txt = await res.text().catch(() => "");
      if (kind === "doc") s.dpl = dplIdOf(txt);
      else {
        s.source = res.headers.get("x-snapshot-source");
        const i = txt.lastIndexOf('"rev":');
        if (i >= 0) { const v = parseInt(txt.slice(i + 6), 10); if (Number.isSafeInteger(v)) s.rev = v; }
      }
    } catch (e) {
      s.error = String(e?.name || e).slice(0, 40);
    }
    s.tEnd = Date.now();
    samples.push(s);
    if (kind === "doc" && s.dpl && s.dpl !== lastDpl) {
      log(`document now answered by ${s.dpl}${s.dpl === cfg.expect ? " (expected)" : ""} (request start ${iso(s.tStart)})`);
      lastDpl = s.dpl;
    }
  };
  const loop = (kind) => {
    let next = Date.now() + (kind === "api" ? Math.round(cfg.intervalMs / 2) : 0);
    const tick = () => {
      if (stopping) return;
      if (inflight[kind].size < MAX_INFLIGHT) {
        const p = one(kind).finally(() => inflight[kind].delete(p));
        inflight[kind].add(p);
      }
      next += cfg.intervalMs;
      setTimeout(tick, Math.max(0, next - Date.now()));
    };
    setTimeout(tick, Math.max(0, next - Date.now()));
  };
  log(`sampling ${cfg.base}${cfg.path} + /api/setlist every ${cfg.intervalMs} ms for ${cfg.durationS} s (or ${stopFile}); expecting ${cfg.expect} after the switch`);
  loop("doc");
  loop("api");

  const endReason = await new Promise((resolve) => {
    const end = setTimeout(() => { clearInterval(watch); resolve("duration"); }, cfg.durationS * 1000);
    const watch = setInterval(() => {
      try { if (fs.statSync(stopFile).mtimeMs >= startedAt) { clearTimeout(end); clearInterval(watch); resolve("STOP file"); } } catch { /* none */ }
    }, 1000);
    const sig = () => { clearTimeout(end); clearInterval(watch); resolve("SIGINT"); };
    process.once("SIGINT", sig);
    process.once("SIGTERM", sig);
  });
  stopping = true;
  await Promise.allSettled([...inflight.doc, ...inflight.api]);
  meta.endedAt = new Date().toISOString();
  meta.endReason = endReason;
  const s = samplerSummary(samples, cfg.expect);
  fs.writeFileSync(`${outBase}.json`, JSON.stringify({ meta, summary: s, samples }, null, 2));
  const md = samplerMarkdown(s, meta);
  fs.writeFileSync(`${outBase}.md`, md);
  console.log(md);
  log(`wrote ${outBase}.{json,md}`);
  process.exit(samplerExitCode(s.verdict));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
