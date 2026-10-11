// Independent observer (dev only): a handful of R2 live-page clients on
// a DIFFERENT host than the load harness, timestamping every `rev`
// broadcast arrival and every snapshot fetch, so a latency spike seen by
// the harness can be attributed to the service or to the load host.
//
// Why a second vantage point: the browsers harness runs on the
// operator's laptop and drives hundreds of clients + Chromium pages from
// one machine. When a save's notification looks late in its report, two
// explanations fit the same numbers — the service (Realtime fan-out,
// /api/setlist) was slow, or the laptop was saturated (event-loop lag,
// CPU, its own uplink) and stamped the arrival late. An observer on
// another network (GitHub Actions runner, see
// .github/workflows/n14-observer.yml) subscribed to the same event sees
// the same saves: if it got the broadcast on time and the harness did
// not, the load host is the suspect; if both were late, the service is.
//
// What runs:
//   - N SDK clients = ONE worker thread running
//     tests/load/browsers/subs-worker.mjs unchanged. That file is the
//     harness's model of the live page (rev broadcast handler, the real
//     scheduler / acceptance / verify / retry modules imported from
//     src/lib, hinted fetches, channel recovery). It cannot be imported
//     as a library — it talks to `parentPort` at module top level — but
//     it does not need to be: spawned as a Worker with the same
//     `workerData` contract run.mjs uses, it is the identical client, and
//     any change to the page model reaches the observer automatically.
//     The cost is that its records only arrive at stop time (the worker
//     answers `stop` with every client's record), so the jsonl is written
//     at the end, not streamed. The record layout this file decodes is
//     documented in subs-worker.mjs's `makeSub` (`reqs` row indices).
//   - 1 plain poller on the main thread: GET /api/setlist every 5 s with
//     no minRev and no Realtime — a floor for plain server latency from
//     this host, independent of the notification path.
//   - an event-loop lag sampler on the main thread every 100 ms (the
//     delay of a 100 ms timer past its due time). The SDK clients run in
//     the worker, so this measures the HOST, not the clients' thread
//     directly; the worker's own event-loop utilisation is reported too.
//     With 5 clients neither should move — a runner whose lag p95 is in
//     the hundreds of ms is itself suspect, which is the point of
//     recording it.
//
// Output (<out>/<stamp>-observer[-<label>].{jsonl,md}):
//   jsonl — one object per line, `kind` ∈ meta | broadcast | request |
//     applied | poll | lag | client. Times `t` are epoch ms (UTC wall
//     clock). Cross-host comparison relies on both hosts' NTP-synced
//     clocks (tens of ms of skew at worst) — fine for the second-scale
//     spikes this is meant to attribute, not for sub-50 ms differences.
//   md — per-rev table (first arrival, spread across clients, hinted
//     fetch duration p50/p95 + sources, applied time), poller latency,
//     lag p95/max, host.
//
// Usage:
//   node --no-warnings tests/load/observer.mjs \
//     --base=https://opensetlist-git-dev-opensetlist-projects.vercel.app \
//     --event=111 --clients=5 --minutes=10 --out=tests/load/results --label=laptop
//
// Env: NEXT_PUBLIC_SUPABASE_URL (must be the dev project) and
// NEXT_PUBLIC_SUPABASE_ANON_KEY — both public values, no DB URL, no
// admin password. Read from the environment, else .env.local / .env
// (ENV_DIR as in realtime/lib.mjs).
import { Worker } from "node:worker_threads";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { loadEnv, parseArgs, isAllowedBaseUrl, DEV_REF, pct } from "./realtime/lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const POLL_MS = 5000;
const LAG_MS = 100;
// Same per-fetch ceiling the page's own deadline is far below; a poll
// that takes longer than this is recorded as status 0.
const POLL_TIMEOUT_MS = 15000;
const LOCALES = ["ja", "ko", "en"];

// ─── summariser (pure; covered by observer.test.mjs) ───

const dist = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return { n: s.length, p50: pct(s, 0.5), p95: pct(s, 0.95), max: s.length ? s[s.length - 1] : null };
};

// `lines`: the parsed jsonl objects. Returns plain data; `toMarkdown`
// renders it. Per rev (every valid rev that arrived by broadcast):
//   - arrivals: each client's FIRST broadcast of that rev (news or a
//     duplicate — either way the notification reached it); spread =
//     last − first arrival across clients;
//   - hinted fetches: requests with notify=1 whose ticket is that rev —
//     the fetch the notification itself triggered — duration and
//     `x-snapshot-source` (warm = served from the writer-warmed entry);
//   - applied: each client's first applied snapshot with rev ≥ R,
//     relative to the first arrival (negative = a periodic poll beat
//     the broadcast);
//   - poller: the first plain poll that returned rev ≥ R (its end time).
export function summarize(lines) {
  const meta = lines.find((l) => l.kind === "meta") ?? {};
  const by = (k) => lines.filter((l) => l.kind === k);
  const bcasts = by("broadcast").filter((b) => Number.isSafeInteger(b.rev));
  const reqs = by("request");
  const applied = by("applied");
  const polls = by("poll");
  const lags = by("lag").map((l) => l.lagMs);

  const revs = [...new Set(bcasts.map((b) => b.rev))].sort((a, b) => a - b).map((rev) => {
    const firstByClient = new Map();
    for (const b of bcasts) {
      if (b.rev !== rev) continue;
      const cur = firstByClient.get(b.client);
      if (cur === undefined || b.t < cur) firstByClient.set(b.client, b.t);
    }
    const arrivals = [...firstByClient.values()].sort((a, b) => a - b);
    const first = arrivals[0];
    const hinted = reqs.filter((r) => r.notify === 1 && r.hint === rev);
    const sources = {};
    for (const r of hinted) {
      const s = r.source ?? `status ${r.status}`;
      sources[s] = (sources[s] || 0) + 1;
    }
    const appliedByClient = new Map();
    for (const a of applied) {
      if (a.rev < rev) continue;
      const cur = appliedByClient.get(a.client);
      if (cur === undefined || a.t < cur) appliedByClient.set(a.client, a.t);
    }
    const appliedRel = [...appliedByClient.values()].map((t) => t - first);
    const poll = polls.filter((p) => Number.isSafeInteger(p.rev) && p.rev >= rev).sort((a, b) => a.tEnd - b.tEnd)[0];
    return {
      rev,
      clients: arrivals.length,
      firstArrival: first,
      spreadMs: arrivals[arrivals.length - 1] - first,
      hinted: { ...dist(hinted.map((r) => r.durationMs).filter((d) => d !== null)), sources },
      applied: { n: appliedRel.length, ...(appliedRel.length ? { min: Math.min(...appliedRel), max: Math.max(...appliedRel) } : {}) },
      pollerSeenAt: poll ? poll.tEnd - first : null,
    };
  });

  // Revs the clients applied that NO client received as a broadcast —
  // a save whose notification never reached this host (or happened
  // before the clients joined). The lowest applied rev is USUALLY the
  // state the clients started on, not a save of the window — but it is
  // also exactly what a lost first-save broadcast looks like (the clients
  // then first apply that rev from a periodic poll). So it is never
  // dropped: it is kept and flagged `maybeStart` with the clients' first
  // SUBSCRIBED time, so the reader can tell "initial state" (applied by
  // the `initial`/`catchup` fetch right after the join) from "first save
  // whose broadcast went missing" (applied later, by `periodic`).
  const broadcastRevs = new Set(bcasts.map((b) => b.rev));
  const startRev = applied.length ? Math.min(...applied.map((a) => a.rev)) : null;
  const subscribedAts = by("client").map((c) => c.firstSubscribedAt).filter((t) => Number.isFinite(t));
  const firstSubscribedAt = subscribedAts.length ? Math.min(...subscribedAts) : null;
  const unnotified = [...new Set(applied.map((a) => a.rev))]
    .filter((rev) => !broadcastRevs.has(rev))
    .sort((a, b) => a - b)
    .map((rev) => {
      const first = applied.filter((a) => a.rev === rev).sort((a, b) => a.t - b.t)[0];
      const maybeStart = rev === startRev && (first.reason === "initial" || first.reason === "catchup");
      return { rev, firstAppliedAt: first.t, reason: first.reason, maybeStart, firstSubscribedAt };
    });

  const pollStatus = {};
  for (const p of polls) pollStatus[p.status] = (pollStatus[p.status] || 0) + 1;
  const reqStatus = {};
  for (const r of reqs) reqStatus[r.status] = (reqStatus[r.status] || 0) + 1;
  return {
    meta,
    revs,
    unnotified,
    requests: { n: reqs.length, statuses: reqStatus, duration: dist(reqs.map((r) => r.durationMs).filter((d) => d !== null)) },
    poller: { statuses: pollStatus, duration: dist(polls.filter((p) => p.status === 200).map((p) => p.durationMs)) },
    lag: dist(lags),
    clients: by("client"),
  };
}

const iso = (t) => (t == null ? "–" : new Date(t).toISOString().slice(11, 23));
const fmtD = (d) => (d.n ? `${d.p50} / ${d.p95}` : "–");

export function toMarkdown(s) {
  const m = s.meta;
  const out = [];
  out.push(`# Independent observer${m.label ? ` — ${m.label}` : ""}`, "");
  out.push(`- host: \`${m.host}\` (${m.platform}, node ${m.node})`);
  out.push(`- base: ${m.base} · event ${m.event} · ${m.clients} SDK clients + 1 plain poller (${POLL_MS / 1000} s)`);
  out.push(`- window: ${m.startedAt ?? "–"} → ${m.endedAt ?? "–"} (UTC)${m.interrupted ? " · stopped by SIGINT" : ""}`);
  if (m.workerError) out.push(`- **SDK worker failed:** ${m.workerError} (poller + lag only)`);
  out.push(`- event-loop lag (main thread, ${LAG_MS} ms timer): p50 ${s.lag.p50 ?? "–"} · p95 ${s.lag.p95 ?? "–"} · max ${s.lag.max ?? "–"} ms (n=${s.lag.n})`);
  if (m.workerElu != null) out.push(`- SDK worker event-loop utilisation over the run: ${m.workerElu}`);
  out.push(`- all SDK requests: n=${s.requests.n} · statuses ${JSON.stringify(s.requests.statuses)} · duration p50/p95/max ${s.requests.duration.p50 ?? "–"} / ${s.requests.duration.p95 ?? "–"} / ${s.requests.duration.max ?? "–"} ms`);
  out.push(`- plain poller: statuses ${JSON.stringify(s.poller.statuses)} · 200 duration p50/p95/max ${s.poller.duration.p50 ?? "–"} / ${s.poller.duration.p95 ?? "–"} / ${s.poller.duration.max ?? "–"} ms`);
  out.push("", "Times are UTC wall clock of this host. Compare a rev's first arrival with the harness report's arrival for the same rev.", "");
  out.push("## Per rev (broadcast arrivals)", "");
  if (!s.revs.length) out.push("No `rev` broadcast arrived during the window.");
  else {
    out.push("| rev | first arrival (UTC) | clients | spread ms | hinted fetch p50 / p95 ms | n | sources | applied − first arrival ms (min…max) | poller saw it (ms after) |");
    out.push("|---|---|---|---|---|---|---|---|---|");
    for (const r of s.revs) {
      const src = Object.entries(r.hinted.sources).map(([k, v]) => `${k} ${v}`).join(", ") || "–";
      const ap = r.applied.n ? `${r.applied.min}…${r.applied.max} (${r.applied.n})` : "–";
      out.push(`| ${r.rev} | ${iso(r.firstArrival)} | ${r.clients} | ${r.spreadMs} | ${fmtD(r.hinted)} | ${r.hinted.n} | ${src} | ${ap} | ${r.pollerSeenAt ?? "–"} |`);
    }
  }
  if (s.unnotified.length) {
    out.push("", "## Revs applied without any broadcast", "");
    out.push("No client received these revs' `rev` broadcast; a poll brought them. Check the clients' first SUBSCRIBED time below — a save before it is expected here.", "");
    for (const u of s.unnotified) {
      const tag = u.maybeStart
        ? " — lowest applied rev, applied by the join's own fetch: probably the clients' starting state, not a lost broadcast"
        : u.firstSubscribedAt != null && u.firstAppliedAt < u.firstSubscribedAt
          ? " — applied before the first SUBSCRIBED: the save predates the clients"
          : " — the clients were subscribed; this save's broadcast did not reach them";
      out.push(`- rev ${u.rev}: first applied ${iso(u.firstAppliedAt)} by a \`${u.reason}\` fetch${tag}`);
    }
  }
  if (s.clients.length) {
    out.push("", "## Clients", "", "| client | locale | first SUBSCRIBED (UTC) | SUBSCRIBED | statuses | fallbacks | recreates | errors |", "|---|---|---|---|---|---|---|---|");
    for (const c of s.clients) {
      out.push(`| ${c.client} | ${c.locale} | ${iso(c.firstSubscribedAt)} | ${c.subscribed} | ${JSON.stringify(c.statuses)} | ${c.fallbacks} | ${c.recreates} | ${Object.keys(c.errors || {}).length ? JSON.stringify(c.errors) : "–"} |`);
    }
  }
  return out.join("\n") + "\n";
}

// subs-worker record → jsonl lines. Request row layout (subs-worker.mjs
// `makeSub`): [tStart, reason, generic, hint, notify, minRev, status,
// verify, body rev, hint resolution, tEnd, outcome, source].
export function recordToLines(rec) {
  const client = rec.idx;
  const out = [];
  for (const [t, rev, what] of rec.bcasts) out.push({ kind: "broadcast", client, t, rev, what });
  for (const r of rec.reqs) {
    out.push({
      kind: "request", client, t: r[0], reason: r[1], generic: r[2], hint: r[3], notify: r[4], minRev: r[5],
      status: r[6], verify: r[7], rev: r[8], hintRes: r[9], tEnd: r[10], outcome: r[11], source: r[12],
      durationMs: r[10] === null ? null : r[10] - r[0],
    });
  }
  for (const [t, rev, reason] of rec.appliedAll) out.push({ kind: "applied", client, t, rev, reason });
  out.push({
    kind: "client", client, locale: rec.locale, subscribed: rec.subscribedAt.length,
    firstSubscribedAt: rec.subscribedAt[0] ?? null, statuses: rec.statuses,
    errors: rec.errors, fallbacks: rec.fallbacks.length, recreates: rec.recreates.length,
    failKinds: rec.failKinds, exhausted: rec.exhausted.length,
  });
  return out;
}

// ─── runner ───

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const base = String(args.base || process.env.BASE_URL || "https://opensetlist-git-dev-opensetlist-projects.vercel.app").replace(/\/$/, "");
  const eventId = String(args.event ?? "111");
  const clients = Number(args.clients ?? 5);
  const minutes = Number(args.minutes ?? 10);
  const label = args.label ? String(args.label).replace(/[^a-zA-Z0-9_-]/g, "_") : "";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  // Dev-only guards, the same allow-list the harness uses for HTTP
  // targets and the same project check for the websocket target. No DB
  // URL is involved, so `assertDev` (which also demands
  // DATABASE_URL_UNPOOLED) is not used: the observer must run on a CI
  // runner that only has the two public values.
  if (!isAllowedBaseUrl(base)) return fail("refusing: --base is not localhost or the dev preview alias");
  let host = null;
  try { host = new URL(supabaseUrl); } catch { /* checked below */ }
  if (!host || host.protocol !== "https:" || host.hostname !== `${DEV_REF}.supabase.co`) {
    return fail(`refusing: NEXT_PUBLIC_SUPABASE_URL is not the dev project (${DEV_REF})`);
  }
  if (!anonKey) return fail("missing NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!/^\d+$/.test(eventId)) return fail("--event must be a numeric id");
  if (!Number.isInteger(clients) || clients < 1 || clients > 50) return fail("--clients must be 1..50");
  if (!(minutes > 0 && minutes <= 60)) return fail("--minutes must be in (0, 60]");

  const now = new Date();
  const outDir = args.out ? String(args.out) : path.join(HERE, "results", now.toISOString().slice(0, 10));
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const outBase = path.join(outDir, `${stamp}-observer${label ? `-${label}` : ""}`);

  const meta = {
    kind: "meta", host: os.hostname(), platform: `${os.platform()} ${os.release()} ${os.arch()}`, node: process.version,
    base, event: eventId, clients, minutes, label, startedAt: now.toISOString(), endedAt: null, interrupted: false,
    workerError: null, workerElu: null,
  };
  const lines = [];
  const log = (m) => console.log(`${new Date().toISOString().slice(11, 23)} ${m}`);
  log(`observer on ${meta.host}: ${clients} clients, event ${eventId}, ${minutes} min → ${outBase}.{jsonl,md}`);

  // Lag sampler: a self-rescheduling 100 ms timer; lag = how late it
  // fired. setTimeout (not setInterval) so one long stall is one big
  // sample, not a burst of catch-up callbacks.
  let lagTimer = null;
  let due = performance.now() + LAG_MS;
  const lagTick = () => {
    const nowP = performance.now();
    lines.push({ kind: "lag", t: Date.now(), lagMs: Math.max(0, Math.round(nowP - due)) });
    due = nowP + LAG_MS;
    lagTimer = setTimeout(lagTick, LAG_MS);
  };
  lagTimer = setTimeout(lagTick, LAG_MS);

  // Plain poller: fixed 5 s schedule from the start (not from the end of
  // the previous poll), single request at a time — a hung poll delays
  // the next one rather than piling up.
  let pollTimer = null;
  // Every poll still in flight, not just the latest: the loop is on a
  // fixed 5 s cadence and does not wait for the previous request, so a
  // slow server (the very case the poller exists to measure) makes polls
  // overlap, and shutdown must wait for all of them or the slow rows are
  // the ones that go missing from the record.
  const pollsInflight = new Set();
  let stopping = false;
  const poll = async () => {
    const t = Date.now();
    const row = { kind: "poll", client: "poller", t, tEnd: null, durationMs: null, status: 0, rev: null, verify: null, source: null };
    try {
      const res = await fetch(`${base}/api/setlist?eventId=${eventId}&locale=ja`, { signal: AbortSignal.timeout(POLL_TIMEOUT_MS) });
      row.status = res.status;
      row.source = res.headers.get("x-snapshot-source");
      row.verify = res.headers.get("x-snapshot-verify");
      const body = res.ok ? await res.json().catch(() => null) : (await res.arrayBuffer().catch(() => {}), null);
      if (Number.isSafeInteger(body?.rev)) row.rev = body.rev;
    } catch (e) {
      row.error = String(e?.name || e).slice(0, 60);
    }
    row.tEnd = Date.now();
    row.durationMs = row.tEnd - t;
    lines.push(row);
  };
  const pollLoop = () => {
    if (stopping) return;
    const p = poll().finally(() => pollsInflight.delete(p));
    pollsInflight.add(p);
    pollTimer = setTimeout(pollLoop, POLL_MS);
  };
  pollLoop();

  // SDK clients: subs-worker.mjs, one worker thread, all clients started
  // at once (batch = clients) — 5 joins are nothing for Realtime.
  const worker = new Worker(path.join(HERE, "browsers", "subs-worker.mjs"), {
    workerData: {
      offset: 0, n: clients, base, eventId, supabaseUrl, anonKey,
      batch: clients, every: 1000, localeOf: LOCALES,
    },
  });
  const waiters = {};
  worker.on("message", (m) => {
    const q = waiters[m.type];
    if (q && q.length) q.shift()(m);
  });
  worker.on("error", (e) => {
    meta.workerError = String(e?.message || e).slice(0, 200);
    log(`worker error: ${meta.workerError}`);
    for (const q of Object.values(waiters)) while (q.length) q.shift()(null);
  });
  const ask = (cmd, type, timeoutMs) => new Promise((resolve) => {
    if (meta.workerError) return resolve(null);
    const timer = setTimeout(() => resolve(null), timeoutMs);
    (waiters[type] ||= []).push((m) => { clearTimeout(timer); resolve(m); });
    worker.postMessage({ cmd });
  });
  const eluStart = worker.performance.eventLoopUtilization();

  // Progress line once a minute (joined / total), so a CI log shows the
  // clients are actually subscribed.
  const progressTimer = setInterval(async () => {
    const p = await ask("progress", "progress", 5000);
    if (p) log(`joined ${p.joined}/${p.total} · polls ${lines.filter((l) => l.kind === "poll").length}`);
  }, 60000);

  let finished = false;
  const finish = async (interrupted) => {
    if (finished) return;
    finished = true;
    stopping = true;
    meta.interrupted = interrupted;
    clearTimeout(pollTimer);
    clearInterval(progressTimer);
    clearTimeout(endTimer);
    log(interrupted ? "SIGINT — stopping" : "window over — stopping");
    if (!meta.workerError) {
      try {
        const elu = worker.performance.eventLoopUtilization(eluStart);
        meta.workerElu = +elu.utilization.toFixed(3);
      } catch { /* worker already gone */ }
    }
    // The worker answers `stop` after removing every channel and closing
    // its socket; 15 s caps a wedged Realtime disconnect.
    const result = await ask("stop", "result", 15000);
    await worker.terminate().catch(() => {});
    // Each poll has its own POLL_TIMEOUT_MS abort, so this is bounded.
    if (pollsInflight.size) await Promise.allSettled([...pollsInflight]);
    clearTimeout(lagTimer);
    meta.endedAt = new Date().toISOString();
    if (!result && !meta.workerError) meta.workerError = "no result from the SDK worker within 15 s";
    for (const rec of result?.clients ?? []) lines.push(...recordToLines(rec));
    // Only timestamped records are ordered by time; `client` records
    // (no `t`) would make the comparator NaN and scramble the order, so
    // they go last.
    const timed = lines.filter((l) => Number.isFinite(l.t)).sort((a, b) => a.t - b.t);
    const untimed = lines.filter((l) => !Number.isFinite(l.t));
    const all = [meta, ...timed, ...untimed];
    fs.writeFileSync(`${outBase}.jsonl`, all.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const summary = summarize(all);
    fs.writeFileSync(`${outBase}.md`, toMarkdown(summary));
    log(`wrote ${outBase}.jsonl / .md — ${summary.revs.length} rev(s) seen, lag p95 ${summary.lag.p95} ms`);
    process.exit(meta.workerError && !result ? 1 : 0);
  };
  const endTimer = setTimeout(() => void finish(false), minutes * 60000);
  process.once("SIGINT", () => void finish(true));
  process.once("SIGTERM", () => void finish(true));
}

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
