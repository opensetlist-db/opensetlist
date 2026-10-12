// Production read-only observer (n14 step 8) — the runner behind
// `node tests/load/observer.mjs --prod-readonly …`. See observer.mjs for
// the dispatch, prod-readonly.mjs for the flags and refusals, and
// tests/load/README.md "Production read-only observer" for usage.
//
// What it does, and deliberately nothing more:
//   - N listeners (default 3), each its own supabase-js client = its own
//     websocket, subscribed to the PUBLIC channel `event:<id>` with ONE
//     handler: the writer's `rev` broadcast. Exactly what an R2 live page
//     subscribes to (src/hooks/useRealtimeEventChannel.ts), with the
//     public anon key. No presence, no postgres_changes, and never a
//     `channel.send()` — the channel is public, so anyone holding the
//     anon key COULD publish to it; this tool must not (there is no
//     channel send / httpSend call anywhere in this file);
//   - optionally ONE more, fresh listener spawned --add-listener-after-s
//     into the run (the runbook's "a listener that joined after the
//     first save still gets the second one" check);
//   - per listener, every channel status callback and a 1 s sample of
//     the socket's `isConnected()`, so the report can say when it
//     connected, when it was SUBSCRIBED (and whether that was before the
//     save), and every close / rejoin;
//   - per broadcast receipt: the RAW receipt time and the exact rev from
//     the payload — a receipt is the broadcast itself, never inferred
//     from a later fetch's content. Then, separately, one hinted GET
//     `/api/setlist?eventId&locale&minRev=<rev>&hint=1` per listener and
//     rev (the URL shape a live page sends for a notification), with its
//     own start / end, status, x-snapshot-source, x-snapshot-verify,
//     x-vercel-id and body rev. 3 listeners → 3 GETs per save. Plus one
//     plain GET at start (the event exists; the starting rev);
//   - stops at --duration-s or when the --stop-file appears (newer than
//     the start), writes <stamp>-observer-prod[-label].{json,md}.
//
// The first receipt time of a rev is the proof that committed-broadcast
// delivery works on that project: whether today's `realtime.messages`
// partition exists is not visible to a client, so it is not checked here
// (the operator's prod SQL check covers it).
//
// Why not reuse subs-worker.mjs like the dev observer: that worker is
// the full page model (scheduler, periodic polls every 20 s, retries,
// recovery, drill hooks). For a production check that adds polling load
// and code paths irrelevant to the question "did each listener get each
// save's broadcast, and what did the hinted fetch answer?" — a small,
// auditable client is the safer thing to aim at production.
//
// Clock: every time is this RECEIVER host's clock, epoch ms, rendered in
// UTC; compare with the save time from the admin UI / `vercel logs`
// (`[liveWriter] at=`) knowing both clocks are NTP-synced to within tens
// of ms, not exactly.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { pct } from "./realtime/lib.mjs";
import { maskRef } from "./prod-readonly.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FETCH_TIMEOUT_MS = 15000;
// The live page's acceptance rule for a broadcast payload
// (src/lib/liveBroadcast.ts contract): `{ kind: "setlist", rev: <non-
// negative safe integer> }`. Anything else is recorded as invalid and
// does not trigger a GET (the payload is untrusted on a public channel).
export function parseRevPayload(p) {
  if (!p || typeof p !== "object") return null;
  if (p.kind !== "setlist") return null;
  return Number.isSafeInteger(p.rev) && p.rev >= 0 ? p.rev : null;
}

// Up to 300 chars of the payload for the record — a public channel can
// carry anything, so it is truncated and never interpreted further.
const payloadSample = (p) => {
  try { return JSON.stringify(p).slice(0, 300); } catch { return null; }
};

const iso = (t) => (t == null ? "–" : new Date(t).toISOString().slice(11, 23));

// ─── summary (pure; covered by observer-prod.test.mjs) ───
//
// `rep` = { meta, baseline, listeners: [{ id, locale, late, attemptAt,
// statusLog: [[t, status]], connLog: [[t, up]], recreates: [t],
// stoppedAt }], receipts: [{ listener, t, rev|null, payload, dup }],
// fetches: [{ listener, rev, t, tEnd, status, source, verify, vercelId,
// bodyRev, error }] }.
//
// Eligibility: a listener can only be expected to receive rev R if it
// was SUBSCRIBED before R's first arrival at any listener (the closest
// observable stand-in for "before the save"). The per-rev table counts
// receipts among eligible listeners; a listener that joined later is
// listed but does not fail the rev.
export function summarizeProd(rep) {
  const subsOf = (l) => l.statusLog.filter(([, s]) => s === "SUBSCRIBED").map(([t]) => t);
  const firstSubOf = new Map(rep.listeners.map((l) => [l.id, subsOf(l)[0] ?? null]));
  const valid = rep.receipts.filter((r) => r.rev != null);
  const revs = [...new Set(valid.map((r) => r.rev))].sort((a, b) => a - b).map((rev) => {
    const firstBy = new Map();
    for (const r of valid) {
      if (r.rev !== rev) continue;
      const cur = firstBy.get(r.listener);
      if (cur === undefined || r.t < cur) firstBy.set(r.listener, r.t);
    }
    const arr = [...firstBy.values()].sort((a, b) => a - b);
    const first = arr[0];
    const eligible = rep.listeners.filter((l) => firstSubOf.get(l.id) != null && firstSubOf.get(l.id) < first).map((l) => l.id);
    const receivedEligible = eligible.filter((id) => firstBy.has(id));
    const fetches = rep.fetches.filter((f) => f.rev === rev);
    const ok = fetches.filter((f) => f.status === 200 && Number.isSafeInteger(f.bodyRev) && f.bodyRev >= rev);
    const sources = {};
    for (const f of fetches) {
      const k = f.source ?? (f.error ? "error" : `status ${f.status}`);
      sources[k] = (sources[k] || 0) + 1;
    }
    const el = fetches.filter((f) => f.tEnd != null).map((f) => f.tEnd - f.t).sort((a, b) => a - b);
    return {
      rev, firstArrival: first, received: arr.length, total: rep.listeners.length,
      eligible: eligible.length, receivedEligible: receivedEligible.length,
      missing: eligible.filter((id) => !firstBy.has(id)),
      lateReceivers: [...firstBy.keys()].filter((id) => !eligible.includes(id)),
      spreadMs: arr[arr.length - 1] - first,
      fetches: fetches.length, fetchesOk: ok.length, sources,
      elapsed: { p50: pct(el, 0.5), max: el.length ? el[el.length - 1] : null },
      allReceived: eligible.length > 0 && receivedEligible.length === eligible.length,
      allFetchedOk: fetches.length > 0 && ok.length === fetches.length,
    };
  });
  const firstSaveAt = revs[0]?.firstArrival ?? null;
  const listeners = rep.listeners.map((l) => {
    const subs = subsOf(l);
    const firstSub = subs[0] ?? null;
    // A close = any non-SUBSCRIBED channel status after the first
    // SUBSCRIBED (CHANNEL_ERROR / TIMED_OUT / CLOSED) — except the CLOSED
    // our own shutdown causes (at or after stoppedAt).
    const closes = l.statusLog.filter(([t, s]) => firstSub != null && t > firstSub && s !== "SUBSCRIBED" && !(l.stoppedAt != null && t >= l.stoppedAt));
    const sockDowns = [];
    for (let i = 1; i < l.connLog.length; i++) {
      const [t, up] = l.connLog[i];
      if (!up && l.connLog[i - 1][1] && !(l.stoppedAt != null && t >= l.stoppedAt)) sockDowns.push(t);
    }
    const got = [...new Set(valid.filter((r) => r.listener === l.id).map((r) => r.rev))].sort((a, b) => a - b);
    const lastStatus = l.statusLog.filter(([t]) => l.stoppedAt == null || t < l.stoppedAt).at(-1)?.[1] ?? null;
    return {
      id: l.id, locale: l.locale, late: !!l.late, attemptAt: l.attemptAt, firstSubscribedAt: firstSub,
      joinMs: firstSub != null && l.attemptAt != null ? firstSub - l.attemptAt : null,
      // null = no save observed in the window (nothing to compare with).
      subscribedBeforeFirstSave: firstSaveAt == null ? null : firstSub != null && firstSub < firstSaveAt,
      subscribed: subs.length, rejoins: Math.max(0, subs.length - 1), closes: closes.map(([t, s]) => [t, s]),
      socketDrops: sockDowns, recreates: l.recreates.length, revsReceived: got,
      invalid: rep.receipts.filter((r) => r.listener === l.id && r.rev == null).length,
      connectedAtEnd: lastStatus === "SUBSCRIBED",
      // "Stayed connected": SUBSCRIBED once, never closed or dropped
      // until our own stop.
      stayedConnected: firstSub != null && closes.length === 0 && sockDowns.length === 0 && lastStatus === "SUBSCRIBED",
    };
  });
  const late = listeners.filter((l) => l.late);
  // The fresh-listener check: a late listener that was SUBSCRIBED before
  // some rev's first arrival must have received that rev.
  const lateCheck = !late.length ? null : late.map((l) => {
    const due = revs.filter((r) => l.firstSubscribedAt != null && l.firstSubscribedAt < r.firstArrival).map((r) => r.rev);
    return { id: l.id, due, received: due.filter((rev) => l.revsReceived.includes(rev)) };
  });
  const verdict = {
    allListenersSubscribed: listeners.every((l) => l.firstSubscribedAt != null),
    allSubscribedBeforeFirstSave: firstSaveAt == null ? null : listeners.filter((l) => !l.late).every((l) => l.subscribedBeforeFirstSave),
    allStayedConnected: listeners.every((l) => l.stayedConnected),
    broadcasts: revs.length,
    everyRevReachedAll: revs.length > 0 && revs.every((r) => r.allReceived),
    everyHintedFetchOk: revs.length > 0 && revs.every((r) => r.allFetchedOk),
    lateListener: lateCheck == null ? null : lateCheck.every((x) => x.due.length > 0 && x.received.length === x.due.length) ? "PASS" : lateCheck.every((x) => x.due.length === 0) ? "NOT EXERCISED" : "FAIL",
    fiveXX: rep.fetches.filter((f) => f.status >= 500).length + (rep.baseline?.status >= 500 ? 1 : 0),
  };
  return { meta: rep.meta, baseline: rep.baseline ?? null, revs, listeners, lateCheck, verdict };
}

export function prodMarkdown(s, rep) {
  const m = s.meta;
  const yes = (b) => (b == null ? "–" : b ? "yes" : "**no**");
  const L = [];
  L.push(`# Production read-only observer${m.label ? ` — ${m.label}` : ""}`, "");
  L.push(`- host \`${m.host}\` (${m.platform}, node ${m.node})`);
  L.push(`- base ${m.base} (${m.baseKind}) · event ${m.eventId} · ${m.listeners} listeners${m.addListenerAfterS ? ` + 1 fresh listener at +${m.addListenerAfterS} s` : ""} on \`event:${m.eventId}\` · Supabase project ${m.supabaseRefMasked} · key: ${m.keyKind} anon (from \`${m.anonKeyEnv}\`, not recorded)`);
  L.push(`- window ${m.startedAt} → ${m.endedAt ?? "–"} (UTC) · ended by ${m.endReason ?? "–"}`);
  L.push("- **clock:** every time below is THIS receiver host's clock, in UTC. Compare with the save time from the admin UI / `vercel logs` (`[liveWriter]`) allowing for NTP skew (tens of ms).");
  if (s.baseline) L.push(`- start: GET /api/setlist (ja) → ${s.baseline.status} rev ${s.baseline.bodyRev ?? "–"} source ${s.baseline.source ?? "–"} in ${s.baseline.tEnd != null ? s.baseline.tEnd - s.baseline.t : "–"} ms`);
  L.push("");
  L.push("## Verdict", "");
  L.push(`- every listener SUBSCRIBED: ${yes(s.verdict.allListenersSubscribed)}`);
  L.push(`- every (initial) listener SUBSCRIBED before the first save's broadcast: ${s.verdict.allSubscribedBeforeFirstSave == null ? "– (no save in the window)" : yes(s.verdict.allSubscribedBeforeFirstSave)}`);
  L.push(`- every listener stayed connected (no close / socket drop before stop): ${yes(s.verdict.allStayedConnected)}`);
  L.push(`- broadcasts (distinct revs) received: ${s.verdict.broadcasts}${s.verdict.broadcasts ? ` · every rev reached every listener subscribed before it: ${yes(s.verdict.everyRevReachedAll)} · every hinted GET 200 with body rev ≥ rev: ${yes(s.verdict.everyHintedFetchOk)}` : " — no save happened in the window (nothing to judge)"}`);
  if (s.verdict.lateListener) L.push(`- fresh listener (joined late) received every later save: ${s.verdict.lateListener}${s.lateCheck.map((x) => ` · listener ${x.id}: ${x.received.length}/${x.due.length} rev(s) after its SUBSCRIBED`).join("")}`);
  L.push(`- 5xx answers: ${s.verdict.fiveXX}`);
  L.push("");
  L.push("## Per rev (broadcast receipts)", "");
  if (!s.revs.length) L.push("No `rev` broadcast arrived during the window.");
  else {
    L.push("A receipt is the `rev` broadcast frame itself (rev read from its payload). \"Eligible\" = SUBSCRIBED before the rev's first arrival.", "");
    L.push("| rev | first receipt (UTC) | received / total | received / eligible | missing (eligible) | spread ms | hinted GETs ok | sources | GET elapsed p50 / max ms |", "|---|---|---|---|---|---|---|---|---|");
    for (const r of s.revs) {
      const src = Object.entries(r.sources).map(([k, v]) => `${k} ${v}`).join(", ") || "–";
      L.push(`| ${r.rev} | ${iso(r.firstArrival)} | ${r.received}/${r.total} | ${r.receivedEligible}/${r.eligible} | ${r.missing.length ? r.missing.join(", ") : "–"} | ${r.spreadMs} | ${r.fetchesOk}/${r.fetches} | ${src} | ${r.elapsed.p50 ?? "–"} / ${r.elapsed.max ?? "–"} |`);
    }
    L.push("", "### Receipts, then the follow-up hinted GET (separate times)", "");
    L.push("| rev | listener | locale | broadcast received (UTC) | Δ first ms | GET start (UTC) | GET end (UTC) | GET status | x-snapshot-source | x-snapshot-verify | body rev | GET ms | x-vercel-id |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const r of s.revs) {
      const recs = rep.receipts.filter((x) => x.rev === r.rev && !x.dup).sort((a, b) => a.t - b.t);
      for (const x of recs) {
        const f = rep.fetches.find((y) => y.rev === r.rev && y.listener === x.listener);
        const loc = rep.listeners.find((l) => l.id === x.listener)?.locale ?? "–";
        L.push(`| ${r.rev} | ${x.listener} | ${loc} | ${iso(x.t)} | ${x.t - r.firstArrival} | ${iso(f?.t)} | ${iso(f?.tEnd)} | ${f ? (f.error ? `0 (${f.error})` : f.status) : "–"} | ${f?.source ?? "–"} | ${f?.verify ?? "–"} | ${f?.bodyRev ?? "–"} | ${f?.tEnd != null ? f.tEnd - f.t : "–"} | ${f?.vercelId ?? "–"} |`);
      }
    }
  }
  const invalid = rep.receipts.filter((r) => r.rev == null);
  if (invalid.length) {
    L.push("", `### Invalid payloads on the channel (${invalid.length})`, "", "Not `{kind:\"setlist\", rev:<int>}` — ignored, no GET. The channel is public; anything here was sent by someone holding the anon key.", "");
    for (const r of invalid.slice(0, 20)) L.push(`- ${iso(r.t)} listener ${r.listener}: \`${r.payload ?? "?"}\``);
  }
  L.push("", "## Per listener", "");
  L.push("| listener | locale | connect attempt (UTC) | first SUBSCRIBED (UTC) | join ms | subscribed before first save | SUBSCRIBED | rejoins | closes (status @ UTC) | socket drops | recreates | revs received | connected at end |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const l of s.listeners) {
    const closes = l.closes.length ? l.closes.map(([t, st]) => `${st} @ ${iso(t)}`).join(", ") : "0";
    L.push(`| ${l.id}${l.late ? " (fresh)" : ""} | ${l.locale} | ${iso(l.attemptAt)} | ${iso(l.firstSubscribedAt)} | ${l.joinMs ?? "–"} | ${yes(l.subscribedBeforeFirstSave)} | ${l.subscribed} | ${l.rejoins} | ${closes} | ${l.socketDrops.length ? l.socketDrops.map(iso).join(", ") : "0"} | ${l.recreates} | ${l.revsReceived.join(", ") || "–"} | ${yes(l.connectedAtEnd)} |`);
  }
  return L.join("\n") + "\n";
}

// ─── runner ───

export async function runObserverProd(cfg) {
  const now = new Date();
  const startedAt = Date.now();
  const outDir = cfg.out ?? path.join(HERE, "results", now.toISOString().slice(0, 10));
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const outBase = path.join(outDir, `${stamp}-observer-prod${cfg.label ? `-${cfg.label}` : ""}`);
  const stopFile = cfg.stopFile ?? path.join(outDir, "observer-prod.STOP");
  const log = (msg) => console.log(`${new Date().toISOString().slice(11, 23)} ${msg}`);
  const topic = `event:${cfg.eventId}`;

  const meta = {
    host: os.hostname(), platform: `${os.platform()} ${os.release()} ${os.arch()}`, node: process.version,
    base: cfg.base, baseKind: cfg.baseKind, eventId: cfg.eventId, listeners: cfg.listeners, durationS: cfg.durationS,
    addListenerAfterS: cfg.addListenerAfterS ?? null,
    // The project ref is masked and the key never leaves memory: the
    // report records only which env var held it and its kind.
    supabaseRefMasked: maskRef(cfg.supabaseRef), anonKeyEnv: cfg.anonKeyEnv, keyKind: cfg.keyKind,
    label: cfg.label, stopFile, startedAt: now.toISOString(), endedAt: null, endReason: null,
    clock: "receiver host clock, epoch ms, UTC",
  };
  const rep = { meta, baseline: null, listeners: [], receipts: [], fetches: [] };
  log(`observer --prod-readonly: ${cfg.listeners} listeners on ${topic} (project ${meta.supabaseRefMasked}), base ${cfg.base}, ${cfg.durationS} s or ${stopFile}`);

  const get = async (locale, minRev) => {
    const q = `eventId=${encodeURIComponent(cfg.eventId)}&locale=${locale}${minRev != null ? `&minRev=${minRev}&hint=1` : ""}`;
    const row = { t: Date.now(), tEnd: null, status: 0, source: null, verify: null, vercelId: null, bodyRev: null, error: null, locale };
    try {
      const res = await fetch(`${cfg.base}/api/setlist?${q}`, { method: "GET", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      row.status = res.status;
      row.source = res.headers.get("x-snapshot-source");
      row.verify = res.headers.get("x-snapshot-verify");
      row.vercelId = res.headers.get("x-vercel-id");
      const body = res.ok ? await res.json().catch(() => null) : (await res.arrayBuffer().catch(() => {}), null);
      if (Number.isSafeInteger(body?.rev)) row.bodyRev = body.rev;
    } catch (e) {
      row.error = String(e?.name || e).slice(0, 60);
    }
    row.tEnd = Date.now();
    return row;
  };

  // The event must exist and answer before we sit on its channel for
  // 15 minutes: a typo'd id would otherwise "pass" with zero broadcasts.
  rep.baseline = await get("ja", null);
  log(`start GET → ${rep.baseline.status} rev ${rep.baseline.bodyRev ?? "–"} (${rep.baseline.source ?? "–"})`);
  if (rep.baseline.status !== 200) {
    console.error(`refusing to wait: GET /api/setlist?eventId=${cfg.eventId} answered ${rep.baseline.status}${rep.baseline.error ? ` (${rep.baseline.error})` : ""}`);
    process.exit(2);
  }

  const pending = new Set();
  let stopping = false;
  const clients = [];

  const spawn = (i, late) => {
    const l = { id: i, locale: cfg.locales[i % cfg.locales.length], late, attemptAt: null, statusLog: [], connLog: [], recreates: [], stoppedAt: null };
    rep.listeners.push(l);
    const fetched = new Set();
    const c = createClient(cfg.supabaseUrl, cfg.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const st = { c, l, channel: null, recreateTimer: null };
    const open = () => {
      st.channel = c
        .channel(topic)
        .on("broadcast", { event: "rev" }, (m) => {
          if (stopping) return;
          // Raw receipt first, before anything else runs.
          const t = Date.now();
          const rev = parseRevPayload(m?.payload);
          const dup = rev != null && fetched.has(rev);
          rep.receipts.push({ listener: i, t, rev, dup, payload: rev == null ? payloadSample(m?.payload) : null });
          if (rev == null || dup) return;
          fetched.add(rev);
          log(`listener ${i} rev ${rev}`);
          const p = get(l.locale, rev).then((row) => { rep.fetches.push({ listener: i, rev, ...row }); }).finally(() => pending.delete(p));
          pending.add(p);
        })
        .subscribe((status) => {
          const t = Date.now();
          if (!stopping) l.statusLog.push([t, status]);
          if (status === "SUBSCRIBED") log(`listener ${i}${late ? " (fresh)" : ""} SUBSCRIBED`);
          else if (!stopping) log(`listener ${i} ${status}`);
          // realtime-js rejoins after CHANNEL_ERROR / TIMED_OUT on its
          // own. A CLOSED channel stays closed; reopen it once after 5 s
          // (recorded as a recreate — itself a "did not stay connected"
          // finding) so the observer keeps observing.
          if (status === "CLOSED" && !stopping && st.recreateTimer == null) {
            st.recreateTimer = setTimeout(async () => {
              st.recreateTimer = null;
              if (stopping) return;
              l.recreates.push(Date.now());
              await c.removeChannel(st.channel).catch(() => {});
              open();
            }, 5000);
          }
        });
    };
    l.attemptAt = Date.now();
    open();
    clients.push(st);
  };
  for (let i = 0; i < cfg.listeners; i++) spawn(i, false);
  const lateTimer = cfg.addListenerAfterS
    ? setTimeout(() => { if (!stopping) { log("spawning the fresh listener"); spawn(cfg.listeners, true); } }, cfg.addListenerAfterS * 1000)
    : null;

  // Socket state sampler: 1 s is enough to place a drop between saves.
  const sockTimer = setInterval(() => {
    for (const { c, l } of clients) {
      let up = false;
      try { up = c.realtime.isConnected(); } catch { /* treat as down */ }
      const last = l.connLog.at(-1);
      if (!last || !!last[1] !== up) l.connLog.push([Date.now(), up ? 1 : 0]);
    }
  }, 1000);

  const endReason = await new Promise((resolve) => {
    const end = setTimeout(() => { clearInterval(watch); resolve("duration"); }, cfg.durationS * 1000);
    const watch = setInterval(() => {
      try {
        if (fs.statSync(stopFile).mtimeMs >= startedAt) { clearTimeout(end); clearInterval(watch); resolve("STOP file"); }
      } catch { /* not yet */ }
    }, 1000);
    const sig = () => { clearTimeout(end); clearInterval(watch); resolve("SIGINT"); };
    process.once("SIGINT", sig);
    process.once("SIGTERM", sig);
  });

  stopping = true;
  clearInterval(sockTimer);
  if (lateTimer) clearTimeout(lateTimer);
  const stopAt = Date.now();
  for (const st of clients) {
    st.l.stoppedAt = stopAt;
    if (st.recreateTimer) clearTimeout(st.recreateTimer);
  }
  if (pending.size) await Promise.allSettled([...pending]);
  await Promise.allSettled(clients.map(async ({ c }) => {
    await c.removeAllChannels().catch(() => {});
    try { c.realtime.disconnect(); } catch { /* gone */ }
  }));
  meta.endedAt = new Date().toISOString();
  meta.endReason = endReason;
  const s = summarizeProd(rep);
  fs.writeFileSync(`${outBase}.json`, JSON.stringify({ ...rep, summary: s }, null, 2));
  const md = prodMarkdown(s, rep);
  fs.writeFileSync(`${outBase}.md`, md);
  console.log(md);
  log(`wrote ${outBase}.{json,md}`);
  process.exit(0);
}
