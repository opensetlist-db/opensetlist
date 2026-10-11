import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CATCHUP_JITTER_MS,
  createLiveScheduler,
  HEALTHY_PERIODIC_MS,
  HEALTHY_PERIODIC_SPREAD_MS,
  type LiveFetchOutcome,
  type LiveFetchReason,
  type LiveFetchRequest,
  type LiveScheduler,
  type LiveSchedulerOptions,
} from "@/lib/liveScheduler";
import { SnapshotAcceptance } from "@/lib/snapshotAcceptance";

// Fake timers drive the scheduler's default clock (setTimeout +
// Date.now are both faked). `runFetch` is a controllable deferred so a
// test decides exactly when a request settles and how.

interface Deferred {
  reason: LiveFetchReason;
  request: LiveFetchRequest;
  resolve: (outcome: LiveFetchOutcome) => void;
}

function harness(opts: Partial<LiveSchedulerOptions> = {}) {
  const calls: Deferred[] = [];
  const runFetch = vi.fn(
    (reason: LiveFetchReason, request: LiveFetchRequest) =>
      new Promise<LiveFetchOutcome>((resolve) => {
        calls.push({ reason, request, resolve });
      }),
  );
  const scheduler: LiveScheduler = createLiveScheduler({
    runFetch,
    random: () => 0,
    ...opts,
  });
  return { calls, runFetch, scheduler };
}

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

async function settle(d: Deferred, outcome: LiveFetchOutcome = { kind: "ok" }) {
  d.resolve(outcome);
  // Let the scheduler's post-await continuation run.
  await vi.advanceTimersByTimeAsync(0);
}

describe("liveScheduler — notifications", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("delays a notification by U(0, jitterMs) — lower bound", async () => {
    const { runFetch, scheduler } = harness({ random: () => 0 });
    scheduler.requestFetch("notification");
    expect(runFetch).not.toHaveBeenCalled(); // always via a timer
    await advance(0);
    expect(runFetch).toHaveBeenCalledTimes(1);
    expect(runFetch).toHaveBeenCalledWith("notification", expect.anything());
  });

  it("delays a notification by U(0, jitterMs) — upper bound stays under jitterMs", async () => {
    const { runFetch, scheduler } = harness({
      random: () => 0.999,
      jitterMs: 500,
    });
    scheduler.requestFetch("notification");
    await advance(498);
    expect(runFetch).not.toHaveBeenCalled();
    await advance(2);
    expect(runFetch).toHaveBeenCalledTimes(1);
  });

  it("uncorrelated triggers (initial seed, retry) run immediately", async () => {
    for (const reason of ["initial", "retry"] as const) {
      const { runFetch, scheduler } = harness({ random: () => 0.999 });
      scheduler.requestFetch(reason);
      expect(runFetch).toHaveBeenCalledTimes(1);
      expect(runFetch).toHaveBeenCalledWith(reason, expect.anything());
      scheduler.dispose();
    }
  });

  it("a notification during a request marks dirty → exactly ONE follow-up after it settles", async () => {
    const { calls, runFetch, scheduler } = harness();
    scheduler.requestFetch("notification");
    await advance(0);
    expect(runFetch).toHaveBeenCalledTimes(1);

    // Three notifications while in flight collapse into one dirty flag.
    scheduler.requestFetch("notification");
    scheduler.requestFetch("notification");
    scheduler.requestFetch("notification");
    expect(scheduler.getState()).toMatchObject({ inFlight: true, dirty: true });
    expect(runFetch).toHaveBeenCalledTimes(1);

    await advance(300);
    await settle(calls[0]);
    // Follow-up waits for the 1 s cooldown measured from the first
    // request's start (t = 0) — not a fresh jitter.
    await advance(699);
    expect(runFetch).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(runFetch).toHaveBeenCalledTimes(2);

    await settle(calls[1]);
    await advance(60_000);
    expect(runFetch).toHaveBeenCalledTimes(2);
  });

  it("cooldown: a second notification inside 1 s is deferred to the cooldown edge, never dropped", async () => {
    const { calls, runFetch, scheduler } = harness();
    scheduler.requestFetch("notification"); // starts at t = 0
    await advance(0);
    await advance(100);
    await settle(calls[0]); // done at t = 100, clean

    await advance(100); // t = 200
    scheduler.requestFetch("notification");
    expect(scheduler.getState().scheduledAt).toBe(Date.now() + 800);
    await advance(799);
    expect(runFetch).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(runFetch).toHaveBeenCalledTimes(2);
  });

  it("a notification arriving while one is already scheduled is covered by it", async () => {
    const { runFetch, scheduler } = harness({ random: () => 0.5 });
    scheduler.requestFetch("notification"); // due t = 250
    await advance(100);
    scheduler.requestFetch("notification"); // would be t = 350 → covered
    await advance(1_000);
    expect(runFetch).toHaveBeenCalledTimes(1);
  });

  it("a catch-up dirty follow-up waits out the shared cooldown (no second jitter)", async () => {
    const { calls, runFetch, scheduler } = harness();
    scheduler.requestFetch("notification");
    await advance(0); // starts at t = 0
    scheduler.requestFetch("catchup"); // during flight
    await advance(50);
    await settle(calls[0]);
    // Cooldown measured from the notification's start (t = 0).
    await advance(949);
    expect(runFetch).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(runFetch).toHaveBeenCalledTimes(2);
    expect(runFetch).toHaveBeenLastCalledWith("catchup", expect.anything());
  });

  // R1 let the notification win here (the follow-up became a hint
  // fetch). R2: the catch-up's maintenance obligation wins and the push's
  // hint rides along as minRev without hint=1 — one request, both duties.
  it("dirty: a pending maintenance obligation wins; the notification's hint rides along", async () => {
    let batch: number | null = null;
    const { calls, runFetch, scheduler } = harness({
      captureHint: () => {
        const h = batch;
        batch = null;
        return h;
      },
    });
    scheduler.requestFetch("initial");
    scheduler.requestFetch("catchup");
    batch = 9;
    scheduler.requestFetch("notification");
    scheduler.requestFetch("resume");
    await settle(calls[0]);
    await advance(0);
    expect(runFetch).toHaveBeenCalledTimes(2);
    expect(calls[1].request).toEqual({
      reason: "resume",
      generic: true,
      hint: 9,
      notify: false,
    });
    await settle(calls[1]);
    await advance(60_000);
    expect(runFetch).toHaveBeenCalledTimes(2);
  });

  it("single-flight: triggers while in flight do not start a second request", async () => {
    const { runFetch, scheduler } = harness();
    scheduler.requestFetch("initial");
    scheduler.requestFetch("boundary");
    scheduler.requestFetch("resume");
    expect(runFetch).toHaveBeenCalledTimes(1);
    expect(scheduler.getState()).toMatchObject({ inFlight: true, dirty: true });
  });

  it("an initial seed supersedes a scheduled (jittered) fetch", async () => {
    const { runFetch, scheduler } = harness({ random: () => 0.9 });
    scheduler.requestFetch("notification"); // due t = 450
    scheduler.requestFetch("initial");
    expect(runFetch).toHaveBeenCalledTimes(1);
    expect(runFetch).toHaveBeenCalledWith("initial", expect.anything());
    await advance(1_000);
    // The scheduled notification fetch was cancelled, not run in
    // addition (the initial request's read covers it).
    expect(runFetch).toHaveBeenCalledTimes(1);
  });
});

describe("liveScheduler — correlated triggers are spread (catch-up / resume / boundary)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("delays catch-up, resume and boundary by U(0, catchupJitterMs)", async () => {
    for (const reason of ["catchup", "resume", "boundary"] as const) {
      const { runFetch, scheduler } = harness({
        random: () => 0.999,
        catchupJitterMs: CATCHUP_JITTER_MS,
      });
      scheduler.requestFetch(reason);
      expect(runFetch).not.toHaveBeenCalled(); // always via a timer
      await advance(CATCHUP_JITTER_MS - 2);
      expect(runFetch).not.toHaveBeenCalled();
      await advance(2);
      expect(runFetch).toHaveBeenCalledTimes(1);
      expect(runFetch).toHaveBeenCalledWith(reason, expect.anything());
      scheduler.dispose();
    }
  });

  it("a population that reconnects at the same instant fetches spread over the window", async () => {
    // 100 clients, each with its own random draw — the SUBSCRIBED
    // catch-ups of a mass reconnect.
    const starts: number[] = [];
    const t0 = Date.now();
    const schedulers = Array.from({ length: 100 }, (_, i) =>
      createLiveScheduler({
        runFetch: () => {
          starts.push(Date.now() - t0);
          return new Promise<LiveFetchOutcome>(() => {});
        },
        random: () => (i + 0.5) / 100,
      }),
    );
    for (const s of schedulers) s.requestFetch("catchup");
    await advance(0);
    expect(starts.length).toBeLessThanOrEqual(1);
    await advance(CATCHUP_JITTER_MS);
    expect(starts).toHaveLength(100);
    // No 10 ms slice of the window holds more than ~2 % of the starts.
    const buckets = new Map<number, number>();
    for (const t of starts) {
      const b = Math.floor(t / 10);
      buckets.set(b, (buckets.get(b) ?? 0) + 1);
    }
    expect(Math.max(...buckets.values())).toBeLessThanOrEqual(2);
    expect(Math.min(...starts)).toBeLessThan(10);
    expect(Math.max(...starts)).toBeGreaterThan(CATCHUP_JITTER_MS - 10);
  });

  it("SUBSCRIBED catch-up + `online` together cost one request (cooldown / covered)", async () => {
    const t0 = Date.now();
    const { calls, runFetch, scheduler } = harness({ random: () => 0.5 });
    scheduler.requestFetch("catchup"); // due 250
    scheduler.requestFetch("resume"); // would be 250 → covered
    await advance(250);
    expect(runFetch).toHaveBeenCalledTimes(1);
    await settle(calls[0]);
    // A second catch-up right after (a flapping rejoin) waits for the
    // cooldown measured from the first start (t = 250).
    scheduler.requestFetch("catchup");
    expect(scheduler.getState().scheduledAt).toBe(t0 + 1_250);
    await advance(999);
    expect(runFetch).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(runFetch).toHaveBeenCalledTimes(2);
  });

  // R1 upgraded the covering catch-up to a notification. R2: it stays
  // a generic catch-up and takes the push's hint along (no hint=1).
  it("a notification covered by a scheduled catch-up rides on it (generic + hint)", async () => {
    const { calls, runFetch, scheduler } = harness({
      random: () => 0.2,
      captureHint: () => 12,
    });
    scheduler.requestFetch("catchup"); // due 100
    scheduler.requestFetch("notification"); // due 100 → covered
    await advance(100);
    expect(runFetch).toHaveBeenCalledTimes(1);
    expect(calls[0].request).toEqual({
      reason: "catchup",
      generic: true,
      hint: 12,
      notify: false,
    });
  });

  it("a catch-up covered by a scheduled retry leaves the retry in place", async () => {
    const { calls, runFetch, scheduler } = harness({ random: () => 0.5 });
    scheduler.requestFetch("initial");
    await settle(calls[0], { kind: "failed", retryInMs: 100 });
    scheduler.requestFetch("catchup"); // due 250 > retry at 100
    await advance(100);
    expect(runFetch).toHaveBeenCalledTimes(2);
    expect(runFetch).toHaveBeenLastCalledWith("retry", expect.anything());
    await settle(calls[1]);
    await advance(5_000);
    expect(runFetch).toHaveBeenCalledTimes(2);
  });
});

describe("liveScheduler — failures defer to the provided retry delay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("arms a retry after `retryInMs` and does not also run the dirty follow-up", async () => {
    const { calls, runFetch, scheduler } = harness();
    scheduler.requestFetch("initial");
    scheduler.requestFetch("notification"); // dirty
    await settle(calls[0], { kind: "failed", retryInMs: 2_000 });
    expect(runFetch).toHaveBeenCalledTimes(1);
    expect(scheduler.getState().retryPending).toBe(true);
    await advance(1_999);
    expect(runFetch).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(runFetch).toHaveBeenCalledTimes(2);
    // The failed request was generic, so its retry is too (R1 ran it as
    // a notification); the push's batch is captured by the retry.
    expect(calls[1].request).toMatchObject({ reason: "retry", generic: true, notify: false });
  });

  it("an explicit trigger supersedes a pending retry", async () => {
    const { calls, runFetch, scheduler } = harness();
    scheduler.requestFetch("initial");
    await settle(calls[0], { kind: "failed", retryInMs: 30_000 });
    scheduler.requestFetch("resume");
    await advance(0); // U(0, jitter) at random = 0
    expect(runFetch).toHaveBeenCalledTimes(2);
    expect(runFetch).toHaveBeenLastCalledWith("resume", expect.anything());
    await settle(calls[1]);
    await advance(60_000);
    expect(runFetch).toHaveBeenCalledTimes(2);
  });

  it("a cancelled outcome schedules nothing", async () => {
    const { calls, runFetch, scheduler } = harness();
    scheduler.requestFetch("initial");
    scheduler.requestFetch("notification");
    await settle(calls[0], { kind: "cancelled" });
    await advance(60_000);
    expect(runFetch).toHaveBeenCalledTimes(1);
  });
});

describe("liveScheduler — server-directed floor (Retry-After)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a notification inside the Retry-After window does not fetch before the floor", async () => {
    const { calls, runFetch, scheduler } = harness({ random: () => 0.5 });
    scheduler.requestFetch("initial");
    await settle(calls[0], { kind: "failed", retryInMs: 2_000, notBeforeMs: 2_000 });
    expect(scheduler.getState().notBeforeAt).toBe(Date.now() + 2_000);

    await advance(100);
    // A burst of pushes during the window — the old rule ("an explicit
    // trigger supersedes the retry") would have fetched at +250.
    scheduler.requestFetch("notification");
    scheduler.requestFetch("notification");
    await advance(1_899); // t = 1999
    expect(runFetch).toHaveBeenCalledTimes(1);
    await advance(1); // t = 2000: the retry (earlier than floor + jitter) covers them
    expect(runFetch).toHaveBeenCalledTimes(2);
    // …and runs as the (generic) retry, which also captures the pushes' batch.
    expect(calls[1].request).toMatchObject({ reason: "retry", generic: true });
    await settle(calls[1]);
    await advance(5_000);
    expect(runFetch).toHaveBeenCalledTimes(2);
  });

  it("an explicit trigger still replaces a LONGER retry, but lands at floor + jitter", async () => {
    const { calls, runFetch, scheduler } = harness({ random: () => 0.5, jitterMs: 500 });
    scheduler.requestFetch("initial");
    // Schedule-derived retry far out, short server floor.
    await settle(calls[0], { kind: "failed", retryInMs: 10_000, notBeforeMs: 2_000 });
    scheduler.requestFetch("resume");
    expect(runFetch).toHaveBeenCalledTimes(1);
    // floor (2000) + U(0, 500) at random = 0.5 → 2250.
    await advance(2_249);
    expect(runFetch).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(runFetch).toHaveBeenCalledTimes(2);
    expect(runFetch).toHaveBeenLastCalledWith("resume", expect.anything());
    expect(scheduler.getState().retryPending).toBe(false);
  });

  it("periodic ticks and immediate triggers honour an inherited floor", async () => {
    const { runFetch, scheduler } = harness({
      random: () => 0,
      periodic: { intervalMs: 1_000, spreadMs: 0, firstTick: "interval" },
      initialNotBeforeAt: Date.now() + 5_000,
    });
    scheduler.start();
    scheduler.requestFetch("initial");
    await advance(4_999); // the 1 s ticks are covered by the held request
    expect(runFetch).not.toHaveBeenCalled();
    await advance(1);
    expect(runFetch).toHaveBeenCalledTimes(1);
    expect(runFetch).toHaveBeenCalledWith("initial", expect.anything());
  });

  it("a dirty follow-up after a failed request waits for the floor too", async () => {
    const { calls, runFetch, scheduler } = harness({ random: () => 0 });
    scheduler.requestFetch("initial");
    scheduler.requestFetch("notification"); // dirty while in flight
    await settle(calls[0], { kind: "failed", retryInMs: 3_000, notBeforeMs: 3_000 });
    await advance(2_999);
    expect(runFetch).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(runFetch).toHaveBeenCalledTimes(2);
    // The retry covers the push that arrived during the failed request; the
    // failed seed was generic, so the retry is too (R1: "notification").
    expect(calls[1].request).toMatchObject({ reason: "retry", generic: true });
  });

  it("a retry after a failure with no push in between stays a plain retry", async () => {
    const { calls, runFetch, scheduler } = harness({ random: () => 0 });
    scheduler.requestFetch("initial");
    await settle(calls[0], { kind: "failed", retryInMs: 1_000 });
    await advance(1_000);
    expect(runFetch).toHaveBeenCalledTimes(2);
    expect(runFetch).toHaveBeenLastCalledWith("retry", expect.anything());
  });

  it("the floor expires: afterwards triggers follow the normal cadence again", async () => {
    const { calls, runFetch, scheduler } = harness({ random: () => 0 });
    scheduler.requestFetch("initial");
    await settle(calls[0], { kind: "failed", retryInMs: 1_000, notBeforeMs: 1_000 });
    await advance(1_000);
    expect(runFetch).toHaveBeenCalledTimes(2);
    await settle(calls[1]); // recovered

    await advance(1_000);
    scheduler.requestFetch("resume");
    await advance(0);
    expect(runFetch).toHaveBeenCalledTimes(3); // no floor: next timer turn
    await settle(calls[2]);
    await advance(2_000); // clear the notification cooldown
    scheduler.requestFetch("notification");
    await advance(0);
    expect(runFetch).toHaveBeenCalledTimes(4);
  });

  it("a failure without Retry-After sets no floor (n13 schedule only)", async () => {
    const { calls, runFetch, scheduler } = harness();
    scheduler.requestFetch("initial");
    await settle(calls[0], { kind: "failed", retryInMs: 30_000 });
    expect(scheduler.getState().notBeforeAt).toBeNull();
    scheduler.requestFetch("resume");
    await advance(0);
    expect(runFetch).toHaveBeenCalledTimes(2);
  });
});

describe("liveScheduler — periodic", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const healthy = {
    intervalMs: HEALTHY_PERIODIC_MS,
    spreadMs: HEALTHY_PERIODIC_SPREAD_MS,
    firstTick: "interval" as const,
  };

  it("fires at intervalMs − spreadMs when random = 0 (lower bound, 16 s)", async () => {
    const { calls, runFetch, scheduler } = harness({
      random: () => 0,
      periodic: healthy,
    });
    scheduler.start();
    await advance(15_999);
    expect(runFetch).not.toHaveBeenCalled();
    await advance(1);
    expect(runFetch).toHaveBeenCalledWith("periodic", expect.anything());
    await settle(calls[0]);
  });

  it("fires just under intervalMs + spreadMs when random → 1 (upper bound, 24 s)", async () => {
    const { runFetch, scheduler } = harness({
      random: () => 0.9999,
      periodic: healthy,
    });
    scheduler.start();
    await advance(23_998);
    expect(runFetch).not.toHaveBeenCalled();
    await advance(2);
    expect(runFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps ticking every interval ± spread (random = 0.5 → exactly 20 s)", async () => {
    const { calls, runFetch, scheduler } = harness({
      random: () => 0.5,
      periodic: healthy,
    });
    scheduler.start();
    for (let i = 1; i <= 3; i++) {
      await advance(20_000);
      expect(runFetch).toHaveBeenCalledTimes(i);
      await settle(calls[i - 1]);
    }
  });

  it("random-phase: the first tick lands at U(0, intervalMs)", async () => {
    const { runFetch, scheduler } = harness({
      random: () => 0.25,
      periodic: { intervalMs: 5_000, spreadMs: 1_000, firstTick: "random-phase" },
    });
    scheduler.start();
    await advance(1_249);
    expect(runFetch).not.toHaveBeenCalled();
    await advance(1);
    expect(runFetch).toHaveBeenCalledTimes(1);
  });

  it("a tick is a no-op while a request is in flight (no dirty, no extra fetch)", async () => {
    const { calls, runFetch, scheduler } = harness({
      random: () => 0.5,
      periodic: healthy,
    });
    scheduler.start();
    scheduler.requestFetch("initial"); // hangs
    await advance(20_000);
    expect(runFetch).toHaveBeenCalledTimes(1);
    expect(scheduler.getState().dirty).toBe(false);
    await settle(calls[0]);
    expect(runFetch).toHaveBeenCalledTimes(1);
  });

  it("ticks are skipped while a retry is pending (backoff holds)", async () => {
    const { calls, runFetch, scheduler } = harness({
      random: () => 0.5,
      periodic: { intervalMs: 5_000, spreadMs: 1_000, firstTick: "interval" },
    });
    scheduler.start();
    scheduler.requestFetch("initial");
    await settle(calls[0], { kind: "failed", retryInMs: 12_000 });
    await advance(11_999); // ticks at 5 s and 10 s skipped
    expect(runFetch).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(runFetch).toHaveBeenCalledTimes(2);
    expect(runFetch).toHaveBeenLastCalledWith("retry", expect.anything());
  });

  it("setPeriodic swaps the cadence on the same scheduler (healthy ↔ disconnected)", async () => {
    const { calls, runFetch, scheduler } = harness({
      random: () => 0.5,
      periodic: healthy,
    });
    scheduler.start();
    await advance(1_000);
    // Disconnected: 5 s ± 1 s with a random first tick (2.5 s here).
    scheduler.setPeriodic({ intervalMs: 5_000, spreadMs: 1_000, firstTick: "random-phase" });
    await advance(2_499);
    expect(runFetch).not.toHaveBeenCalled();
    await advance(1);
    expect(runFetch).toHaveBeenCalledTimes(1);
    await settle(calls[0]);
    await advance(5_000);
    expect(runFetch).toHaveBeenCalledTimes(2);
    await settle(calls[1]);

    // Back to healthy: the next tick is a full 20 s away.
    scheduler.setPeriodic(healthy);
    await advance(19_999);
    expect(runFetch).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(runFetch).toHaveBeenCalledTimes(3);
  });

  it("setPeriodic does not disturb a pending retry", async () => {
    const { calls, runFetch, scheduler } = harness({
      random: () => 0.5,
      periodic: healthy,
    });
    scheduler.start();
    scheduler.requestFetch("initial");
    await settle(calls[0], { kind: "failed", retryInMs: 8_000 });
    scheduler.setPeriodic({ intervalMs: 5_000, spreadMs: 1_000, firstTick: "random-phase" });
    await advance(7_999); // fallback ticks are skipped while the retry is pending
    expect(runFetch).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(runFetch).toHaveBeenLastCalledWith("retry", expect.anything());
  });

  it("start() is idempotent", async () => {
    const { runFetch, scheduler } = harness({
      random: () => 0.5,
      periodic: healthy,
    });
    scheduler.start();
    scheduler.start();
    await advance(20_000);
    expect(runFetch).toHaveBeenCalledTimes(1);
  });
});

describe("liveScheduler — dispose", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops periodic, scheduled, retry, and follow-up work", async () => {
    const { calls, runFetch, scheduler } = harness({
      random: () => 0.5,
      periodic: {
        intervalMs: HEALTHY_PERIODIC_MS,
        spreadMs: HEALTHY_PERIODIC_SPREAD_MS,
        firstTick: "interval",
      },
    });
    scheduler.start();
    scheduler.requestFetch("initial");
    scheduler.requestFetch("notification"); // dirty
    scheduler.dispose();
    await settle(calls[0]); // settles after dispose: no follow-up
    scheduler.requestFetch("resume"); // ignored
    await advance(120_000);
    expect(runFetch).toHaveBeenCalledTimes(1);
    expect(scheduler.getState().disposed).toBe(true);
  });

  it("a failure settling after dispose arms no retry", async () => {
    const { calls, runFetch, scheduler } = harness();
    scheduler.requestFetch("initial");
    scheduler.dispose();
    await settle(calls[0], { kind: "failed", retryInMs: 1_000 });
    await advance(10_000);
    expect(runFetch).toHaveBeenCalledTimes(1);
    expect(scheduler.getState().retryPending).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// R2 — hint tickets, the one bounded recheck, and the sticky
// maintenance obligation. A real `SnapshotAcceptance` supplies
// `captureHint`, so batches behave exactly as on the page.
// ────────────────────────────────────────────────────────────────────

describe("liveScheduler — R2 hint tickets + recheck", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function hinted(opts: Partial<LiveSchedulerOptions> = {}) {
    const acceptance = new SnapshotAcceptance({ rev: 5, capturedAt: "2026-11-14T07:30:00.000Z" });
    const exhausted: number[] = [];
    const h = harness({
      random: () => 0.5,
      captureHint: () => acceptance.captureHint(),
      onHintExhausted: (hint) => exhausted.push(hint),
      ...opts,
    });
    const push = (rev: number) => {
      if (acceptance.noteHint(rev)) h.scheduler.requestFetch("notification");
    };
    return { ...h, acceptance, exhausted, push };
  }

  it("a notification fetch carries the batch: hint=H, notify, not generic", async () => {
    const { calls, push } = hinted();
    push(7);
    push(9); // same batch → max
    await advance(250);
    expect(calls).toHaveLength(1);
    expect(calls[0].request).toEqual({
      reason: "notification",
      generic: false,
      hint: 9,
      notify: true,
    });
  });

  it("a duplicate / already-applied hint does no notification work", async () => {
    const { runFetch, push } = hinted();
    push(5);
    push(3);
    await advance(5_000);
    expect(runFetch).not.toHaveBeenCalled();
  });

  it("an older request completing cannot consume a newer batch", async () => {
    const { calls, push } = hinted();
    push(7);
    await advance(250); // request A dispatched with H = 7
    push(8); // arrives in flight → next batch, dirty follow-up
    await settle(calls[0], { kind: "ok", hint: "resolved" });
    // Follow-up at the cooldown edge (1 s after A's start at 250).
    await advance(999);
    expect(calls).toHaveLength(1);
    await advance(1);
    expect(calls).toHaveLength(2);
    expect(calls[1].request).toMatchObject({ hint: 8, notify: true });
  });

  it("inconclusive → ONE quiet recheck at now + max(1 s, cooldown left) + U(0, jitter), sharing the cooldown", async () => {
    const { calls, push, scheduler } = hinted();
    push(9);
    await advance(250); // dispatched at 250
    await advance(100);
    await settle(calls[0], { kind: "ok", hint: "inconclusive" }); // settles at 350
    // 350 + max(1000, 1250 − 350) + 0.5 × 500 = 1600.
    expect(scheduler.getState()).toMatchObject({
      scheduledAt: Date.now() + 1_250,
      scheduledReason: "recheck",
      carriedHint: 9,
      carriedHintPhase: "recheck",
    });
    await advance(1_249);
    expect(calls).toHaveLength(1);
    await advance(1);
    expect(calls).toHaveLength(2);
    expect(calls[1].request).toEqual({
      reason: "recheck",
      generic: false,
      hint: 9,
      notify: false,
    });
    // The recheck advanced the shared cooldown: a push right after it
    // waits for 1 s from the recheck's start.
    const recheckStart = Date.now();
    await settle(calls[1], { kind: "ok", hint: "resolved" });
    push(10);
    expect(scheduler.getState().scheduledAt).toBe(recheckStart + 1_000);
  });

  it("the recheck waits out a notification cooldown longer than the memo window", async () => {
    const t0 = Date.now();
    const { calls, push, scheduler } = hinted({ cooldownMs: 3_000 });
    push(9);
    await advance(250);
    await settle(calls[0], { kind: "ok", hint: "inconclusive" });
    // Cooldown left at 250 = 3000 > 1000 → 250 + 3000 + U(0, 500) = 3500.
    expect(scheduler.getState().scheduledAt).toBe(t0 + 3_500);
  });

  it("a second inconclusive answer drops the ticket (hint exhausted) — no third request", async () => {
    const { calls, push, scheduler, exhausted, runFetch } = hinted();
    push(9);
    await advance(250);
    await settle(calls[0], { kind: "ok", hint: "inconclusive" });
    await advance(1_250);
    expect(calls).toHaveLength(2);
    await settle(calls[1], { kind: "ok", hint: "inconclusive" });
    expect(exhausted).toEqual([9]);
    expect(scheduler.getState()).toMatchObject({ carriedHint: null, scheduledAt: null });
    await advance(60_000);
    expect(runFetch).toHaveBeenCalledTimes(2);
  });

  it("poisoning drill: a max-safe-integer hint costs two requests, then honest saves work normally", async () => {
    const { calls, push, acceptance, exhausted } = hinted();
    push(Number.MAX_SAFE_INTEGER);
    await advance(250);
    expect(calls[0].request).toMatchObject({ hint: Number.MAX_SAFE_INTEGER, notify: true });
    await settle(calls[0], { kind: "ok", hint: "inconclusive" });
    await advance(1_250);
    expect(calls[1].request).toMatchObject({
      reason: "recheck",
      hint: Number.MAX_SAFE_INTEGER,
      notify: false,
    });
    await settle(calls[1], { kind: "ok", hint: "inconclusive" });
    expect(exhausted).toEqual([Number.MAX_SAFE_INTEGER]);
    // The durable watermark never saw it.
    expect(acceptance.minRevToSend()).toBe(5);

    await advance(2_000);
    push(6); // an honest save
    await advance(250);
    expect(calls).toHaveLength(3);
    expect(calls[2].request).toEqual({
      reason: "notification",
      generic: false,
      hint: 6,
      notify: true,
    });
  });

  it("a fresh refutation (resolved) ends it: no recheck, no failure", async () => {
    const { calls, push, scheduler, runFetch } = hinted();
    push(Number.MAX_SAFE_INTEGER);
    await advance(250);
    await settle(calls[0], { kind: "ok", hint: "resolved" });
    expect(scheduler.getState()).toMatchObject({ carriedHint: null, scheduledAt: null });
    await advance(10_000);
    expect(runFetch).toHaveBeenCalledTimes(1);
  });

  it("the ticket survives an ordinary failure: the retry carries it (still a first check)", async () => {
    const { calls, push } = hinted();
    push(9);
    await advance(250);
    await settle(calls[0], { kind: "failed", retryInMs: 1_000 });
    await advance(1_000);
    expect(calls).toHaveLength(2);
    expect(calls[1].request).toEqual({
      reason: "retry",
      generic: false,
      hint: 9,
      notify: true,
    });
  });

  it("a server-proven gap that resolved the ticket retries without it", async () => {
    const { calls, push } = hinted();
    push(9);
    await advance(250);
    await settle(calls[0], { kind: "failed", retryInMs: 1_000, hint: "resolved" });
    await advance(1_000);
    expect(calls[1].request).toEqual({
      reason: "retry",
      generic: false,
      hint: null,
      notify: false,
    });
  });

  it("an inconclusive gap failure turns its retry into the recheck, and the Retry-After floor holds", async () => {
    const { calls, push, exhausted } = hinted();
    push(9);
    await advance(250);
    await settle(calls[0], {
      kind: "failed",
      retryInMs: 4_000,
      notBeforeMs: 4_000,
      hint: "inconclusive",
    });
    // No separate recheck inside the server's back-off window.
    await advance(3_999);
    expect(calls).toHaveLength(1);
    await advance(1);
    expect(calls).toHaveLength(2);
    expect(calls[1].request).toEqual({
      reason: "retry",
      generic: false,
      hint: 9,
      notify: false,
    });
    await settle(calls[1], { kind: "ok", hint: "inconclusive" });
    expect(exhausted).toEqual([9]);
  });

  it("a recheck-phase ticket does not ride on an unrelated request before it is due", async () => {
    const { calls, push, scheduler } = hinted();
    push(9);
    await advance(250); // notification dispatched at 250
    await settle(calls[0], { kind: "ok", hint: "inconclusive" }); // recheck due 1500
    await advance(350);
    scheduler.requestFetch("catchup"); // due at the cooldown edge, 1250 < 1500
    await advance(650);
    expect(calls).toHaveLength(2);
    // Inside the memo window: the catch-up runs generic WITHOUT the ticket…
    expect(calls[1].request).toEqual({
      reason: "catchup",
      generic: true,
      hint: null,
      notify: false,
    });
    await settle(calls[1]);
    // …and the recheck is re-armed for its own due time.
    expect(scheduler.getState()).toMatchObject({
      scheduledReason: "recheck",
      carriedHint: 9,
    });
    await advance(249);
    expect(calls).toHaveLength(2);
    await advance(1);
    expect(calls).toHaveLength(3);
    expect(calls[2].request).toEqual({
      reason: "recheck",
      generic: false,
      hint: 9,
      notify: false,
    });
  });

  it("an ok without a hint verdict consumes the ticket (hint-less runners)", async () => {
    const { calls, push, scheduler } = hinted();
    push(9);
    await advance(250);
    await settle(calls[0]);
    expect(scheduler.getState()).toMatchObject({ carriedHint: null, scheduledAt: null });
  });
});

describe("liveScheduler — R2 sticky maintenance obligation (genericRequired)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a periodic tick during an in-flight notification fetch is NOT dropped: one generic follow-up", async () => {
    const { calls, runFetch, scheduler } = harness({
      random: () => 0.5,
      captureHint: () => null,
      periodic: { intervalMs: 1_000, spreadMs: 0, firstTick: "interval" },
    });
    scheduler.start();
    scheduler.requestFetch("notification");
    await advance(250); // notification in flight (hangs)
    expect(calls[0].request.generic).toBe(false);
    // Three overdue ticks (1 s, 2 s, 3 s) collapse into ONE obligation.
    await advance(3_000);
    expect(runFetch).toHaveBeenCalledTimes(1);
    expect(scheduler.getState()).toMatchObject({ genericRequired: true, dirty: true });
    await settle(calls[0]);
    expect(runFetch).toHaveBeenCalledTimes(2);
    expect(calls[1].request).toMatchObject({ reason: "periodic", generic: true });
    await settle(calls[1]);
    expect(scheduler.getState().genericRequired).toBe(false);
  });

  it("a notification can neither clear nor downgrade a pending obligation", async () => {
    const { calls, scheduler } = harness({
      random: () => 0.5,
      captureHint: () => 11,
    });
    scheduler.requestFetch("catchup"); // due 250
    scheduler.requestFetch("notification"); // covered
    scheduler.requestFetch("notification");
    await advance(250);
    expect(calls).toHaveLength(1);
    expect(calls[0].request).toEqual({
      reason: "catchup",
      generic: true,
      hint: 11,
      notify: false,
    });
  });

  it("a scheduled notification takes the generic path when a tick lands before it (hint rides along)", async () => {
    const { calls, scheduler } = harness({
      random: () => 0.5,
      captureHint: () => 9,
      periodic: { intervalMs: 100, spreadMs: 0, firstTick: "interval" },
    });
    scheduler.start();
    scheduler.requestFetch("notification"); // due 250
    await advance(100); // tick at 100: scheduled exists → obligation only
    expect(calls).toHaveLength(0);
    await advance(150);
    expect(calls).toHaveLength(1);
    expect(calls[0].request).toEqual({
      reason: "periodic",
      generic: true,
      hint: 9,
      notify: false,
    });
  });

  it("a failed generic request keeps the obligation for its retry; only success clears it", async () => {
    const { calls, scheduler } = harness({ random: () => 0.5 });
    scheduler.requestFetch("initial");
    await settle(calls[0], { kind: "failed", retryInMs: 1_000 });
    expect(scheduler.getState().genericRequired).toBe(true);
    // A notification while the retry is pending: due earlier, replaces it
    // — and still runs generic.
    scheduler.requestFetch("notification");
    await advance(250);
    expect(calls[1].request).toMatchObject({ generic: true, notify: false });
    await settle(calls[1], { kind: "failed", retryInMs: 2_000 });
    expect(scheduler.getState().genericRequired).toBe(true);
    await advance(2_000);
    expect(calls[2].request).toMatchObject({ reason: "retry", generic: true });
    await settle(calls[2]);
    expect(scheduler.getState().genericRequired).toBe(false);
  });

  it("a periodic tick while a GENERIC request is in flight is covered by it", async () => {
    const { calls, runFetch, scheduler } = harness({
      random: () => 0.5,
      periodic: { intervalMs: 1_000, spreadMs: 0, firstTick: "interval" },
    });
    scheduler.start();
    scheduler.requestFetch("initial");
    await advance(2_500);
    expect(scheduler.getState().dirty).toBe(false);
    await settle(calls[0]);
    expect(runFetch).toHaveBeenCalledTimes(1);
  });

  it("a newer batch at or above a recheck ticket subsumes it (one request, a fresh first check)", async () => {
    let batch: number | null = 9;
    const { calls, runFetch, scheduler } = harness({
      random: () => 0.5,
      captureHint: () => {
        const h = batch;
        batch = null;
        return h;
      },
    });
    scheduler.requestFetch("notification");
    await advance(250);
    await settle(calls[0], { kind: "ok", hint: "inconclusive" }); // recheck due +1250
    // A newer batch at the recheck's level or above subsumes the ticket.
    await advance(1_000);
    batch = 10;
    scheduler.requestFetch("notification"); // due at the cooldown edge (1250) ≤ recheck
    await advance(0);
    await advance(250);
    expect(calls).toHaveLength(2);
    expect(calls[1].request).toMatchObject({ hint: 10, notify: true });
    await settle(calls[1], { kind: "ok", hint: "resolved" });
    await advance(10_000);
    expect(runFetch).toHaveBeenCalledTimes(2);
  });
});
