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
//     from source): notification → jittered U(0, 500 ms) fetch, ≥ 1 s
//     cooldown, single-flight with one dirty follow-up; periodic repair
//     poll every 20 s ± 4 s; a `catchup` fetch at start and on every
//     SUBSCRIBED;
//   - the page's real acceptance rule + `?minRev=`
//     (`src/lib/snapshotAcceptance.ts`): `appliedRev + 1` for
//     notification-triggered requests, the highest server-shown rev
//     otherwise; 8 s deadline and n13's retry schedule
//     (`src/lib/snapshotFreshness.ts`);
//   - R3: CHANNEL_ERROR / TIMED_OUT → tear the channel down, poll every
//     5 s ± 1 s (random first phase), retry realtime after 30 s, at most
//     3 times — the same constants the page uses.
//
// On top of that, every client listens for the server's transactional
// broadcast (`rev` on the same topic — R1 sends it, R1 pages ignore it)
// and records its arrival, so one run compares the R1 notification
// (postgres_changes) with the R2 transport (broadcast) on the same
// population.
//
// What is kept per client is deliberately tiny — timestamps and revs,
// never response bodies — so a few hundred clients fit in one laptop
// process. The population is split over several worker threads so the
// JSON parsing of a notification burst (hundreds of ~80 KB snapshots
// within 0.5 s) does not delay the timestamps of other clients by
// event-loop lag on a single thread.
//
// Importing the app's .ts modules relies on Node's built-in type
// stripping (Node ≥ 22.18 / 23.6); those three files have no imports
// and no TS-only runtime syntax.
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
} from "../../../src/lib/snapshotFreshness.ts";

// Mirrors src/lib/realtimeRecovery.ts (not imported: that module also
// touches `document`).
const RECOVERY_DELAY_MS = 30_000;
const MAX_RECOVERY_ATTEMPTS = 3;

const { offset, n, base, eventId, supabaseUrl, anonKey, batch, every, localeOf } = workerData;
const EVENT = String(eventId);
const TOPIC = `event:${EVENT}`;
const CANCELLED = { kind: "cancelled" };
const OK = { kind: "ok" };
const subs = [];

function makeSub(idx) {
  const rec = {
    idx,
    locale: localeOf[idx % localeOf.length],
    subscribedAt: [], // every SUBSCRIBED (initial + rejoins)
    pgReadyAt: [], // "Subscribed to PostgreSQL" system messages
    statuses: {},
    errors: {},
    fallbacks: [], // [t, status]
    applied: [], // [t, rev] whenever the applied rev increases
    notes: [], // [t, eventType initial, row id] (scope-checked notifications)
    bcasts: [], // [t, rev]
    fetches: {}, // reason → count
    sources: {}, // x-snapshot-source → count
    failures: 0,
    attemptAt: null,
  };
  const c = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const acceptance = new SnapshotAcceptance();
  let consecutiveFailures = 0;
  let lastAppliedRev = null;
  let session = null; // { kind, disposed, scheduler, channel? }
  let recoveryAttempts = 0;
  let recoveryTimer = null;

  const runFetch = (sess) => async (reason) => {
    if (sess.disposed) return CANCELLED;
    rec.fetches[reason] = (rec.fetches[reason] || 0) + 1;
    const generation = acceptance.generation;
    const minRev = reason === "notification" ? acceptance.notificationMinRev() : acceptance.minRevToSend();
    const ctrl = new AbortController();
    const deadline = setTimeout(() => ctrl.abort(), SNAPSHOT_FETCH_TIMEOUT_MS);
    const fail = (retryAfter) => {
      if (sess.disposed) return CANCELLED;
      consecutiveFailures++;
      rec.failures++;
      return { kind: "failed", retryInMs: snapshotRetryDelayMs(consecutiveFailures, retryAfter) };
    };
    try {
      const res = await fetch(base + setlistSnapshotUrl(EVENT, rec.locale, minRev), { signal: ctrl.signal });
      if (sess.disposed) return CANCELLED;
      if (!res.ok) {
        await res.arrayBuffer().catch(() => {});
        return fail(parseRetryAfterMs(res.headers.get("retry-after")));
      }
      const src = res.headers.get("x-snapshot-source") || "none";
      rec.sources[src] = (rec.sources[src] || 0) + 1;
      const body = await res.json();
      if (sess.disposed) return CANCELLED;
      if (!body || !Array.isArray(body.items)) return fail(null);
      const v = acceptance.evaluate(generation, body);
      if (v.kind === "stale-generation") return CANCELLED;
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

  const stopSession = () => {
    if (!session) return;
    session.disposed = true;
    session.scheduler.dispose();
    if (session.channel) c.removeChannel(session.channel).catch(() => {});
    session = null;
  };

  const startPolling = () => {
    const sess = { kind: "polling", disposed: false };
    // useSetlistPolling resets the failure count per polling session.
    consecutiveFailures = 0;
    sess.scheduler = createLiveScheduler({
      runFetch: runFetch(sess),
      periodic: { intervalMs: FALLBACK_POLL_MS, spreadMs: FALLBACK_POLL_SPREAD_MS, firstTick: "random-phase" },
    });
    sess.scheduler.start();
    session = sess;
  };

  const fallBack = (status) => {
    if (!session || session.kind !== "realtime") return;
    rec.fallbacks.push([Date.now(), status]);
    stopSession();
    startPolling();
    if (recoveryAttempts < MAX_RECOVERY_ATTEMPTS && recoveryTimer === null) {
      recoveryAttempts++;
      recoveryTimer = setTimeout(() => {
        recoveryTimer = null;
        stopSession();
        startRealtime();
      }, RECOVERY_DELAY_MS);
    }
  };

  const startRealtime = () => {
    const sess = { kind: "realtime", disposed: false };
    sess.scheduler = createLiveScheduler({
      runFetch: runFetch(sess),
      periodic: { intervalMs: HEALTHY_PERIODIC_MS, spreadMs: HEALTHY_PERIODIC_SPREAD_MS, firstTick: "interval" },
    });
    sess.scheduler.start();
    sess.scheduler.requestFetch("catchup");
    session = sess;
    sess.channel = c
      .channel(TOPIC)
      .on("postgres_changes", { event: "*", schema: "public", table: "SetlistItem" }, (p) => {
        if (sess.disposed) return;
        const pushed = p.new?.eventId ?? p.old?.eventId;
        if (pushed != null && String(pushed) !== EVENT) return;
        rec.notes.push([Date.now(), (p.eventType || "?")[0], String(p.new?.id ?? p.old?.id ?? "")]);
        sess.scheduler.requestFetch("notification");
      })
      .on("broadcast", { event: "rev" }, (m) => {
        rec.bcasts.push([Date.now(), typeof m.payload?.rev === "number" ? m.payload.rev : null]);
      })
      .on("system", {}, (p) => {
        if (p?.extension === "postgres_changes" && p?.status === "ok") rec.pgReadyAt.push(Date.now());
      })
      .subscribe((status, err) => {
        rec.statuses[status] = (rec.statuses[status] || 0) + 1;
        if (err) {
          const m = String(err.message || err).slice(0, 120);
          rec.errors[m] = (rec.errors[m] || 0) + 1;
        }
        if (sess.disposed) return;
        if (status === "SUBSCRIBED") {
          rec.subscribedAt.push(Date.now());
          sess.scheduler.requestFetch("catchup");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          fallBack(status);
        }
      });
  };

  return {
    rec,
    start() {
      rec.attemptAt = Date.now();
      startRealtime();
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
      if (recoveryTimer) clearTimeout(recoveryTimer);
      stopSession();
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
