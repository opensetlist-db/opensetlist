// Worker thread: a slice of the SDK-subscriber population (dev only).
//
// Each subscriber is one supabase-js client with its own websocket —
// one browser tab's worth of Realtime — that behaves like the R1 live
// page (`src/hooks/useRealtimeEventChannel.ts` + `useLiveSnapshot.ts`):
//
//   - channel `event:<id>` (public), `postgres_changes` on
//     public.SetlistItem with NO server-side filter and the page's
//     client-side scope check on `new.eventId ?? old.eventId`
//     (the R1 notification source);
//   - the page's real scheduler (`src/lib/liveScheduler.ts`, imported
//     from source), ONE per client for its whole life, like the hook's
//     one-per-session: notification → jittered U(0, 500 ms) fetch;
//     SUBSCRIBED catch-up jittered U(0, CATCHUP_JITTER_MS); ≥ 1 s
//     cooldown shared by those; single-flight with one dirty follow-up;
//     an immediate `initial` seed at start; periodic repair poll every
//     20 s ± 4 s; a 503's `Retry-After` handed over as `notBeforeMs`, the
//     floor every scheduling path honours;
//   - the page's real acceptance rule + `?minRev=`
//     (`src/lib/snapshotAcceptance.ts`): `appliedRev + 1` for
//     notification-triggered requests, the highest server-shown rev
//     otherwise; 8 s deadline and n13's retry schedule
//     (`src/lib/snapshotFreshness.ts`);
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
// On top of that, every client listens for the server's transactional
// broadcast (`rev` on the same topic — R1 sends it, R1 pages ignore it)
// and records its arrival, so one run compares the R1 notification
// (postgres_changes) with the R2 transport (broadcast) on the same
// population.
//
// Drills: `dropPg` (worker-wide) makes every client ignore its
// scope-checked postgres_changes notifications — recorded in `notes` with
// type "x" instead of the change type, never scheduled — so only the
// periodic repair poll can bring the client forward (lost-notification
// drill). The socket and the channel stay healthy.
//
// What is kept per client is deliberately tiny — timestamps and revs,
// never response bodies — so a few hundred clients fit in one laptop
// process. The population is split over several worker threads so the
// JSON parsing of a notification burst (hundreds of ~80 KB snapshots
// within 0.5 s) does not delay the timestamps of other clients by
// event-loop lag on a single thread.
//
// Importing the app's .ts modules relies on Node's built-in type
// stripping (Node ≥ 22.18 / 23.6); those four files have no imports
// and no TS-only runtime syntax. `realtimeRecovery.ts` also exports
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
import { SnapshotAcceptance, setlistSnapshotUrl } from "../../../src/lib/snapshotAcceptance.ts";
import {
  SNAPSHOT_FETCH_TIMEOUT_MS,
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

// The hook's two cadences (`HEALTHY_CADENCE` / `DISCONNECTED_CADENCE` in
// src/hooks/useRealtimeEventChannel.ts — module-private there, so
// rebuilt here from the same exported constants).
const HEALTHY_CADENCE = { intervalMs: HEALTHY_PERIODIC_MS, spreadMs: HEALTHY_PERIODIC_SPREAD_MS, firstTick: "interval" };
const DISCONNECTED_CADENCE = { intervalMs: FALLBACK_POLL_MS, spreadMs: FALLBACK_POLL_SPREAD_MS, firstTick: "random-phase" };

const { offset, n, base, eventId, supabaseUrl, anonKey, batch, every, localeOf } = workerData;
const EVENT = String(eventId);
const TOPIC = `event:${EVENT}`;
const CANCELLED = { kind: "cancelled" };
const OK = { kind: "ok" };
const subs = [];
let dropPg = false; // see "Drills" above

function makeSub(idx) {
  const rec = {
    idx,
    locale: localeOf[idx % localeOf.length],
    subscribedAt: [], // every SUBSCRIBED (initial + rejoins)
    pgReadyAt: [], // "Subscribed to PostgreSQL" system messages
    statuses: {},
    errors: {},
    // [t, status] each time the client ENTERED the disconnected state
    // (polling at 5 s ± 1 s while realtime-js rejoins).
    fallbacks: [],
    recreates: [], // [t, attempt] channel re-creations by the recovery timer
    applied: [], // [t, rev] whenever the applied rev increases
    // [t, rev, reason] for EVERY snapshot the acceptance rule applied, in
    // order — not only increases — so the run can prove the applied rev
    // never went backwards (e.g. across the polling → realtime handoff)
    // and say which fetch reason delivered a revision.
    appliedAll: [],
    notes: [], // [t, eventType initial, row id] (scope-checked notifications)
    bcasts: [], // [t, rev]
    fetches: {}, // reason → count
    sources: {}, // x-snapshot-source → count
    failures: 0,
    retryAfter: 0, // failed responses that carried a Retry-After
    attemptAt: null,
  };
  const c = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const acceptance = new SnapshotAcceptance();
  let consecutiveFailures = 0;
  let lastAppliedRev = null;
  let stopped = false;

  // useLiveSnapshot's runner: URL + minRev, 8 s deadline, acceptance,
  // n13 failure bookkeeping, Retry-After → retry delay AND floor.
  const runFetch = async (reason) => {
    if (stopped) return CANCELLED;
    rec.fetches[reason] = (rec.fetches[reason] || 0) + 1;
    const generation = acceptance.generation;
    const minRev = reason === "notification" ? acceptance.notificationMinRev() : acceptance.minRevToSend();
    const ctrl = new AbortController();
    const deadline = setTimeout(() => ctrl.abort(), SNAPSHOT_FETCH_TIMEOUT_MS);
    const fail = (retryAfter) => {
      if (stopped) return CANCELLED;
      consecutiveFailures++;
      rec.failures++;
      if (retryAfter !== null) rec.retryAfter++;
      return {
        kind: "failed",
        retryInMs: snapshotRetryDelayMs(consecutiveFailures, retryAfter),
        notBeforeMs: retryAfter === null ? null : clampRetryAfterMs(retryAfter),
      };
    };
    try {
      const res = await fetch(base + setlistSnapshotUrl(EVENT, rec.locale, minRev), { signal: ctrl.signal });
      if (stopped) return CANCELLED;
      if (!res.ok) {
        await res.arrayBuffer().catch(() => {});
        return fail(parseRetryAfterMs(res.headers.get("retry-after")));
      }
      const src = res.headers.get("x-snapshot-source") || "none";
      rec.sources[src] = (rec.sources[src] || 0) + 1;
      const body = await res.json();
      if (stopped) return CANCELLED;
      if (!body || !Array.isArray(body.items)) return fail(null);
      const v = acceptance.evaluate(generation, body);
      if (v.kind === "stale-generation") return CANCELLED;
      if (v.apply && v.version) rec.appliedAll.push([Date.now(), v.version.rev, reason]);
      if (v.apply && v.version && (lastAppliedRev === null || v.version.rev > lastAppliedRev)) {
        lastAppliedRev = v.version.rev;
        rec.applied.push([Date.now(), v.version.rev]);
      }
      if (v.serverGap) return fail(null);
      consecutiveFailures = 0;
      return OK;
    } catch {
      return fail(null);
    } finally {
      clearTimeout(deadline);
    }
  };

  const scheduler = createLiveScheduler({ runFetch, periodic: HEALTHY_CADENCE });

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
        .on("postgres_changes", { event: "*", schema: "public", table: "SetlistItem" }, (p) => {
          if (stopped || seq !== channelSeq) return;
          const pushed = p.new?.eventId ?? p.old?.eventId;
          if (pushed != null && String(pushed) !== EVENT) return;
          if (dropPg) {
            rec.notes.push([Date.now(), "x", String(p.new?.id ?? p.old?.id ?? "")]);
            return;
          }
          rec.notes.push([Date.now(), (p.eventType || "?")[0], String(p.new?.id ?? p.old?.id ?? "")]);
          scheduler.requestFetch("notification");
        })
        .on("broadcast", { event: "rev" }, (m) => {
          rec.bcasts.push([Date.now(), typeof m.payload?.rev === "number" ? m.payload.rev : null]);
        })
        .on("system", {}, (p) => {
          if (p?.extension === "postgres_changes" && p?.status === "ok") rec.pgReadyAt.push(Date.now());
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
  let pgReady = 0;
  for (const s of subs) {
    if (s.rec.subscribedAt.length) joined++;
    if (s.rec.pgReadyAt.length) pgReady++;
  }
  return { joined, pgReady, total: n };
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
    // How many clients have received a (not dropped) notification of
    // change type msg.ty ("I" / "U" / "D") for row msg.id.
    let count = 0;
    for (const s of subs) if (s.rec.notes.some(([, ty, id]) => ty === msg.ty && id === msg.id)) count++;
    parentPort.postMessage({ type: "noted", count });
  } else if (msg.cmd === "dropPg") {
    dropPg = !!msg.on;
    parentPort.postMessage({ type: "dropPgAck", on: dropPg });
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
