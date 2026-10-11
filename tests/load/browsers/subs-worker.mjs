// Worker thread: a slice of the SDK-subscriber population (dev only).
//
// Each subscriber is one supabase-js client with its own websocket —
// one browser tab's worth of Realtime — that behaves like the R2 live
// page (`src/hooks/useRealtimeEventChannel.ts` + `useLiveSnapshot.ts`):
//
//   - channel `event:<id>` (public) with ONE subscription: the writer's
//     transactional `rev` broadcast. No `postgres_changes` (R2 removed
//     it), so there is no registration step to wait for — SUBSCRIBED
//     means delivery is live;
//   - the broadcast handler of the hook, line for line: the payload is
//     untrusted, accepted only as `{ kind: "setlist", rev: <non-negative
//     safe integer> }`; `acceptance.noteHint(rev)` puts it in the
//     transient batch and says whether it is news (rev > the server-
//     observed watermark); only then `scheduler.requestFetch(
//     "notification")`;
//   - the page's real scheduler (`src/lib/liveScheduler.ts`, imported
//     from source), ONE per client for its whole life, wired like the
//     hook: `captureHint` drains the batch at dispatch, `onHintExhausted`
//     records a dropped ticket, healthy cadence 20 s ± 4 s, jittered
//     SUBSCRIBED catch-up, 1 s cooldown shared by notifications and
//     rechecks, single-flight + dirty follow-up, the sticky generic
//     obligation, a 503's `Retry-After` as the floor;
//   - the page's runner (`useLiveSnapshot`'s `runFetch`), mirrored: URL
//     `minRev = minRevFor(request.hint)` (= max(serverRev, H), or
//     serverRev without a ticket) and `&hint=1` iff `request.notify`;
//     8 s deadline that settles the request as a failure at once; the
//     `x-snapshot-verify` header parsed by the page's own
//     `parseSnapshotVerify`; `acceptance.evaluate(gen, body, verify,
//     hint)`; the verdict's hint resolution mapped to the scheduler's
//     outcome (satisfied / disproved / superseded → "resolved",
//     inconclusive → "inconclusive"); a server-proven gap is a failure
//     that still reports the ticket's fate; HTTP / network / deadline
//     failures report none (the retry carries the ticket); n13's retry
//     schedule (`src/lib/snapshotFreshness.ts`);
//   - the hook's channel-recovery state machine (constants imported
//     from `src/lib/realtimeRecovery.ts`): on CHANNEL_ERROR / TIMED_OUT /
//     CLOSED the channel object is KEPT (realtime-js rejoins it on its
//     own) and the same scheduler switches to the disconnected cadence
//     (5 s ± 1 s, random first tick); a recovery timer of
//     REJOIN_GRACE_MS + recreateBackoffMs(n) is armed. SUBSCRIBED before
//     it fires cancels it, restores 20 s ± 4 s and requests a jittered
//     catch-up; if it fires, the old channel is removed, a new one opened
//     and the timer re-armed for n + 1, at most MAX_RECREATE_ATTEMPTS
//     per budget; HEALTHY_BUDGET_RESET_MS of continuous health refunds
//     the budget. Statuses from a retired channel are ignored (channel
//     sequence number), exactly like the hook. The page's hidden-tab
//     teardown has no equivalent here: a worker client is always
//     "visible".
//
// What each client records (for run.mjs): every broadcast it received
// and what the handler did with it; every request as the scheduler
// described it (`{reason, generic, hint, notify}`) with the URL's
// `minRev`, the status, the verification header kind, the body rev and
// the hint resolution; per-kind counts; dropped (exhausted) tickets; the
// highest `serverRev` the acceptance state ever held — the poisoning
// drill's proof that a forged hint never entered the durable watermark.
//
// Drill: `dropNotify` (worker-wide) makes every client drop each VALID
// broadcast payload before `noteHint` — the hook's own drill point — so
// only the periodic repair poll can bring the client forward (lost-
// notification drill). The socket and the channel stay healthy.
//
// What is kept per client is deliberately tiny — timestamps, revs and
// short labels, never response bodies — so a few hundred clients fit in
// one laptop process. The population is split over several worker
// threads so the JSON parsing of a notification burst (hundreds of
// ~80 KB snapshots within 0.5 s) does not delay the timestamps of other
// clients by event-loop lag on a single thread.
//
// Importing the app's .ts modules relies on Node's built-in type
// stripping (Node ≥ 22.18 / 23.6). `snapshotAcceptance.ts` and
// `liveBroadcast.ts` have one import each, and it is `import type`
// (erased); the others have none. None uses TS-only runtime syntax. `realtimeRecovery.ts` also exports
// `document` helpers, but only touches `document` when they are called,
// which this worker never does.
import { parentPort, workerData } from "node:worker_threads";
import { createClient } from "@supabase/supabase-js";
import {
  createLiveScheduler,
  HEALTHY_PERIODIC_MS,
  HEALTHY_PERIODIC_SPREAD_MS,
  FALLBACK_POLL_MS,
  FALLBACK_POLL_SPREAD_MS,
} from "../../../src/lib/liveScheduler.ts";
import { SnapshotAcceptance, isValidRev, setlistSnapshotUrl } from "../../../src/lib/snapshotAcceptance.ts";
import { SNAPSHOT_VERIFY_HEADER, parseSnapshotVerify } from "../../../src/lib/snapshotVerify.ts";
import {
  armSnapshotDeadline,
  snapshotRetryDelayMs,
  parseRetryAfterMs,
  clampRetryAfterMs,
} from "../../../src/lib/snapshotFreshness.ts";
import {
  REJOIN_GRACE_MS,
  MAX_RECREATE_ATTEMPTS,
  HEALTHY_BUDGET_RESET_MS,
  recreateBackoffMs,
} from "../../../src/lib/realtimeRecovery.ts";
// Type-only Prisma import (erased); the runtime exports are plain.
import { LIVE_BROADCAST_EVENT, liveTopic } from "../../../src/lib/liveBroadcast.ts";

// The hook's two cadences (`HEALTHY_CADENCE` / `DISCONNECTED_CADENCE` in
// src/hooks/useRealtimeEventChannel.ts — module-private there, so
// rebuilt here from the same exported constants).
const HEALTHY_CADENCE = { intervalMs: HEALTHY_PERIODIC_MS, spreadMs: HEALTHY_PERIODIC_SPREAD_MS, firstTick: "interval" };
const DISCONNECTED_CADENCE = { intervalMs: FALLBACK_POLL_MS, spreadMs: FALLBACK_POLL_SPREAD_MS, firstTick: "random-phase" };
const { offset, n, base, eventId, supabaseUrl, anonKey, batch, every, localeOf } = workerData;
const EVENT = String(eventId);
// The writer's own topic and event name, so a rename on either side
// cannot silently leave the population listening to nothing.
const TOPIC = liveTopic(BigInt(EVENT));
const CANCELLED = { kind: "cancelled" };
const subs = [];
let dropNotify = false; // see "Drill" above

// `HintResolution` → the scheduler's `LiveHintOutcome` (useLiveSnapshot's
// `hintOutcomeFor`).
const hintOutcomeFor = (resolution) =>
  resolution === "none" ? undefined : resolution === "inconclusive" ? "inconclusive" : "resolved";

const bump = (o, k) => {
  o[k] = (o[k] || 0) + 1;
};

function makeSub(idx) {
  const rec = {
    idx,
    locale: localeOf[idx % localeOf.length],
    subscribedAt: [], // every SUBSCRIBED (initial + rejoins)
    statuses: {},
    errors: {},
    // [t, status] each time the client ENTERED the disconnected state
    // (polling at 5 s ± 1 s while realtime-js rejoins).
    fallbacks: [],
    recreates: [], // [t, attempt] channel re-creations by the recovery timer
    applied: [], // [t, rev] whenever the applied rev increases
    // [t, rev, reason] for EVERY snapshot the acceptance rule applied, in
    // order — not only increases — so the run can prove the applied rev
    // never went backwards and say which fetch reason delivered a rev.
    appliedAll: [],
    // [t, rev, what] per `rev` broadcast: "n" = news (noteHint true →
    // notification requested), "d" = not news (rev ≤ serverRev), "x" =
    // dropped by the drill, "i" = invalid payload (rev null then).
    bcasts: [],
    // [tStart, reason, generic 0/1, hint, notify 0/1, minRev, status,
    //  verify kind, body rev, hint resolution, tEnd, outcome]
    // status 0 = network error / deadline; outcome ok | failed | cancelled.
    reqs: [],
    fetches: {}, // reason → count
    sources: {}, // x-snapshot-source → count
    verifyKinds: {}, // x-snapshot-verify kind → count (200 responses)
    hintRes: {}, // satisfied / disproved / superseded / inconclusive → count
    exhausted: [], // [t, hint] tickets dropped after an inconclusive recheck
    serverRevMax: null, // highest acceptance.serverRev ever held
    serverRevFinal: null,
    failures: 0,
    failKinds: {}, // http / network / deadline / gap / body → count
    retryAfter: 0, // failed responses that carried a Retry-After
    attemptAt: null,
  };
  const c = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const acceptance = new SnapshotAcceptance();
  const generation = acceptance.generation;
  let consecutiveFailures = 0;
  let lastAppliedRev = null;
  let stopped = false;

  const noteServerRev = () => {
    const s = acceptance.serverRev;
    if (s !== null && (rec.serverRevMax === null || s > rec.serverRevMax)) rec.serverRevMax = s;
  };

  // useLiveSnapshot's runner (see header).
  const runFetch = (reason, request) =>
    new Promise((resolve) => {
      if (stopped) return resolve(CANCELLED);
      const hint = request?.hint ?? null;
      const notify = request?.notify === true;
      const minRev = acceptance.minRevFor(hint);
      const row = [Date.now(), reason, request?.generic ? 1 : 0, hint, notify ? 1 : 0, minRev, 0, null, null, null, null, null];
      rec.reqs.push(row);
      bump(rec.fetches, reason);
      let settled = false;
      const finish = (outcome) => {
        if (settled) return;
        settled = true;
        row[10] = Date.now();
        row[11] = outcome.kind;
        resolve(outcome);
      };
      const fail = (kind, retryAfterMs, hintOutcome) => {
        if (settled) return;
        if (stopped) return finish(CANCELLED);
        consecutiveFailures++;
        rec.failures++;
        bump(rec.failKinds, kind);
        if (retryAfterMs !== null) rec.retryAfter++;
        finish({
          kind: "failed",
          retryInMs: snapshotRetryDelayMs(consecutiveFailures, retryAfterMs),
          notBeforeMs: retryAfterMs === null ? null : clampRetryAfterMs(retryAfterMs),
          ...(hintOutcome ? { hint: hintOutcome } : {}),
        });
      };
      const controller = new AbortController();
      const deadline = armSnapshotDeadline(controller, () => fail("deadline", null));
      void (async () => {
        try {
          const res = await fetch(base + setlistSnapshotUrl(EVENT, rec.locale, minRev, notify), { signal: controller.signal });
          row[6] = res.status;
          if (settled) return;
          if (stopped) return finish(CANCELLED);
          if (!res.ok) {
            await res.arrayBuffer().catch(() => {});
            return fail("http", parseRetryAfterMs(res.headers.get("retry-after")));
          }
          bump(rec.sources, res.headers.get("x-snapshot-source") || "none");
          const body = await res.json();
          if (settled) return;
          if (stopped) return finish(CANCELLED);
          if (!body || !Array.isArray(body.items)) return fail("body", null);
          const verify = parseSnapshotVerify(res.headers.get(SNAPSHOT_VERIFY_HEADER));
          row[7] = verify.kind;
          row[8] = isValidRev(body.rev) ? body.rev : null;
          bump(rec.verifyKinds, verify.kind);
          const v = acceptance.evaluate(generation, body, verify, hint);
          if (v.kind === "stale-generation") return finish(CANCELLED);
          noteServerRev();
          row[9] = v.hint;
          if (v.hint !== "none") bump(rec.hintRes, v.hint);
          if (v.apply && v.version) rec.appliedAll.push([Date.now(), v.version.rev, reason]);
          if (v.apply && v.version && (lastAppliedRev === null || v.version.rev > lastAppliedRev)) {
            lastAppliedRev = v.version.rev;
            rec.applied.push([Date.now(), v.version.rev]);
          }
          const hintOutcome = hintOutcomeFor(v.hint);
          if (v.serverGap) return fail("gap", null, hintOutcome);
          consecutiveFailures = 0;
          finish(hintOutcome ? { kind: "ok", hint: hintOutcome } : { kind: "ok" });
        } catch {
          fail("network", null);
        } finally {
          deadline.clear();
        }
      })();
    });

  const scheduler = createLiveScheduler({
    runFetch,
    captureHint: () => acceptance.captureHint(),
    onHintExhausted: (h) => rec.exhausted.push([Date.now(), h]),
    periodic: HEALTHY_CADENCE,
  });

  // The hook's `handleRevBroadcast`.
  const handleRevBroadcast = (message) => {
    const payload = message?.payload;
    if (payload === null || typeof payload !== "object") {
      rec.bcasts.push([Date.now(), null, "i"]);
      return;
    }
    const { kind, rev } = payload;
    if (kind !== "setlist" || !isValidRev(rev)) {
      rec.bcasts.push([Date.now(), null, "i"]);
      return;
    }
    if (dropNotify) {
      rec.bcasts.push([Date.now(), rev, "x"]);
      return;
    }
    if (!acceptance.noteHint(rev)) {
      rec.bcasts.push([Date.now(), rev, "d"]);
      return;
    }
    rec.bcasts.push([Date.now(), rev, "n"]);
    scheduler.requestFetch("notification");
  };

  // ── channel recovery: the hook's state machine (see header) ──
  let connection = "joining"; // "joining" | "subscribed" | "disconnected"
  let channel = null;
  let channelSeq = 0;
  let recreateAttempts = 0;
  let recoveryTimer = null;
  let healthyTimer = null;

  const clearRecoveryTimer = () => {
    if (recoveryTimer !== null) { clearTimeout(recoveryTimer); recoveryTimer = null; }
  };
  const clearHealthyTimer = () => {
    if (healthyTimer !== null) { clearTimeout(healthyTimer); healthyTimer = null; }
  };

  const openChannel = () => {
    const seq = ++channelSeq;
    try {
      channel = c
        .channel(TOPIC)
        .on("broadcast", { event: LIVE_BROADCAST_EVENT }, (m) => {
          if (stopped || seq !== channelSeq) return;
          handleRevBroadcast(m);
        })
        .subscribe((status, err) => onStatus(seq, status, err));
    } catch (e) {
      // realtime-js hands back a still-registered channel for the topic
      // and re-subscribing a closed one throws; the armed recovery timer
      // is the retry (the hook does the same).
      channel = null;
      const m = `subscribe threw: ${String(e?.message || e).slice(0, 100)}`;
      rec.errors[m] = (rec.errors[m] || 0) + 1;
    }
  };

  const armRecovery = () => {
    if (recoveryTimer !== null || recreateAttempts >= MAX_RECREATE_ATTEMPTS) return;
    const attempt = recreateAttempts + 1;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      if (stopped || connection !== "disconnected") return;
      recreateAttempts = attempt;
      rec.recreates.push([Date.now(), attempt]);
      channelSeq += 1; // retire the old channel's callbacks first
      const old = channel;
      channel = null;
      void (async () => {
        if (old) await c.removeChannel(old).catch(() => {});
        if (stopped || connection !== "disconnected") return;
        openChannel();
        armRecovery();
      })();
    }, REJOIN_GRACE_MS + recreateBackoffMs(attempt));
  };

  const enterDisconnected = (status) => {
    clearHealthyTimer();
    if (connection !== "disconnected") {
      connection = "disconnected";
      rec.fallbacks.push([Date.now(), status]);
      scheduler.setPeriodic(DISCONNECTED_CADENCE);
    }
    armRecovery();
  };

  const onStatus = (seq, status, err) => {
    rec.statuses[status] = (rec.statuses[status] || 0) + 1;
    if (err) {
      const m = String(err.message || err).slice(0, 120);
      rec.errors[m] = (rec.errors[m] || 0) + 1;
    }
    if (stopped || seq !== channelSeq) return;
    if (status === "SUBSCRIBED") {
      const previous = connection;
      connection = "subscribed";
      clearRecoveryTimer();
      rec.subscribedAt.push(Date.now());
      if (previous === "disconnected") scheduler.setPeriodic(HEALTHY_CADENCE);
      if (healthyTimer === null) {
        healthyTimer = setTimeout(() => {
          healthyTimer = null;
          recreateAttempts = 0;
        }, HEALTHY_BUDGET_RESET_MS);
      }
      scheduler.requestFetch("catchup");
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      enterDisconnected(status);
    }
  };

  return {
    rec,
    acceptance,
    scheduler,
    start() {
      rec.attemptAt = Date.now();
      scheduler.start();
      scheduler.requestFetch("initial");
      openChannel();
    },
    // Network-blip drill: close the raw websocket without telling
    // realtime-js, so it goes through its own unclean-close path
    // (channel error → rejoin with backoff), exactly like a tab whose
    // connection dropped. `disconnect()` would be a clean, manual close
    // that realtime-js does not recover from on its own.
    dropSocket() {
      const conn = c.realtime?.socketAdapter?.socket?.conn ?? c.realtime?.conn;
      if (!conn || typeof conn.close !== "function") return false;
      try { conn.close(); return true; } catch { return false; }
    },
    async stop() {
      // `stopped` first: removing the channels reports CLOSED, which must
      // not look like a disconnect.
      stopped = true;
      rec.serverRevFinal = acceptance.serverRev;
      clearRecoveryTimer();
      clearHealthyTimer();
      scheduler.dispose();
      await c.removeAllChannels().catch(() => {});
      try { await c.realtime.disconnect(); } catch { /* already gone */ }
    },
  };
}

function progress() {
  let joined = 0;
  for (const s of subs) if (s.rec.subscribedAt.length) joined++;
  return { joined, total: n };
}

parentPort.on("message", async (msg) => {
  if (msg.cmd === "progress") {
    parentPort.postMessage({ type: "progress", ...progress() });
  } else if (msg.cmd === "reached") {
    // How many clients have applied a snapshot with rev ≥ msg.rev.
    let count = 0;
    for (const s of subs) {
      const a = s.rec.applied;
      if (a.length && a[a.length - 1][1] >= msg.rev) count++;
    }
    parentPort.postMessage({ type: "reached", count });
  } else if (msg.cmd === "noted") {
    // How many clients have received a valid, not-dropped `rev`
    // broadcast with rev ≥ msg.rev (news or a duplicate — either way
    // the notification reached them).
    let count = 0;
    for (const s of subs) if (s.rec.bcasts.some(([, rev, w]) => rev !== null && rev >= msg.rev && (w === "n" || w === "d"))) count++;
    parentPort.postMessage({ type: "noted", count });
  } else if (msg.cmd === "dropNotify") {
    dropNotify = !!msg.on;
    parentPort.postMessage({ type: "dropNotifyAck", on: dropNotify });
  } else if (msg.cmd === "state") {
    // The acceptance + scheduler state right now (drills read serverRev
    // and the carried ticket from here).
    const clients = subs.map((s) => ({
      idx: s.rec.idx,
      serverRev: s.acceptance.serverRev,
      pendingHint: s.acceptance.pendingHint,
      ...s.scheduler.getState(),
    }));
    parentPort.postMessage({ type: "state", clients });
  } else if (msg.cmd === "drop") {
    let ok = 0;
    for (const s of subs) if (s.dropSocket()) ok++;
    parentPort.postMessage({ type: "dropped", ok, at: Date.now() });
  } else if (msg.cmd === "stop") {
    await Promise.allSettled(subs.map((s) => s.stop()));
    parentPort.postMessage({ type: "result", clients: subs.map((s) => s.rec) });
  }
});

(async () => {
  for (let i = 0; i < n; i += batch) {
    for (let k = i; k < Math.min(n, i + batch); k++) {
      const s = makeSub(offset + k);
      subs.push(s);
      s.start();
    }
    if (i + batch < n) await new Promise((r) => setTimeout(r, every));
  }
  parentPort.postMessage({ type: "started" });
})();
