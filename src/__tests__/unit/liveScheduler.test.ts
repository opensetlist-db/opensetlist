import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createLiveScheduler,
  HEALTHY_PERIODIC_MS,
  HEALTHY_PERIODIC_SPREAD_MS,
  type LiveFetchOutcome,
  type LiveFetchReason,
  type LiveScheduler,
  type LiveSchedulerOptions,
} from "@/lib/liveScheduler";

// Fake timers drive the scheduler's default clock (setTimeout +
// Date.now are both faked). `runFetch` is a controllable deferred so a
// test decides exactly when a request settles and how.

interface Deferred {
  reason: LiveFetchReason;
  resolve: (outcome: LiveFetchOutcome) => void;
}

function harness(opts: Partial<LiveSchedulerOptions> = {}) {
  const calls: Deferred[] = [];
  const runFetch = vi.fn(
    (reason: LiveFetchReason) =>
      new Promise<LiveFetchOutcome>((resolve) => {
        calls.push({ reason, resolve });
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
    expect(runFetch).toHaveBeenCalledWith("notification");
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

  it("jitter only applies to notifications — other triggers run immediately", async () => {
    for (const reason of ["catchup", "resume", "manual", "retry"] as const) {
      const { runFetch, scheduler } = harness({ random: () => 0.999 });
      scheduler.requestFetch(reason);
      expect(runFetch).toHaveBeenCalledTimes(1);
      expect(runFetch).toHaveBeenCalledWith(reason);
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

  it("a non-notification dirty follow-up runs immediately (ignores the cooldown)", async () => {
    const { calls, runFetch, scheduler } = harness();
    scheduler.requestFetch("notification");
    await advance(0);
    scheduler.requestFetch("catchup"); // during flight
    scheduler.requestFetch("notification"); // does not downgrade
    await advance(50);
    await settle(calls[0]);
    expect(runFetch).toHaveBeenCalledTimes(2);
    expect(runFetch).toHaveBeenLastCalledWith("catchup");
  });

  it("single-flight: an immediate trigger while in flight does not start a second request", async () => {
    const { runFetch, scheduler } = harness();
    scheduler.requestFetch("catchup");
    scheduler.requestFetch("manual");
    scheduler.requestFetch("resume");
    expect(runFetch).toHaveBeenCalledTimes(1);
    expect(scheduler.getState()).toMatchObject({ inFlight: true, dirty: true });
  });

  it("an immediate trigger supersedes a scheduled (jittered) notification fetch", async () => {
    const { runFetch, scheduler } = harness({ random: () => 0.9 });
    scheduler.requestFetch("notification"); // due t = 450
    scheduler.requestFetch("resume");
    expect(runFetch).toHaveBeenCalledTimes(1);
    expect(runFetch).toHaveBeenCalledWith("resume");
    await advance(1_000);
    // The scheduled notification fetch was cancelled, not run in
    // addition (the resume request's read covers it).
    expect(runFetch).toHaveBeenCalledTimes(1);
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
    scheduler.requestFetch("catchup");
    scheduler.requestFetch("notification"); // dirty
    await settle(calls[0], { kind: "failed", retryInMs: 2_000 });
    expect(runFetch).toHaveBeenCalledTimes(1);
    expect(scheduler.getState().retryPending).toBe(true);
    await advance(1_999);
    expect(runFetch).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(runFetch).toHaveBeenCalledTimes(2);
    expect(runFetch).toHaveBeenLastCalledWith("retry");
  });

  it("an explicit trigger supersedes a pending retry", async () => {
    const { calls, runFetch, scheduler } = harness();
    scheduler.requestFetch("catchup");
    await settle(calls[0], { kind: "failed", retryInMs: 30_000 });
    scheduler.requestFetch("resume");
    expect(runFetch).toHaveBeenCalledTimes(2);
    await settle(calls[1]);
    await advance(60_000);
    expect(runFetch).toHaveBeenCalledTimes(2);
  });

  it("a cancelled outcome schedules nothing", async () => {
    const { calls, runFetch, scheduler } = harness();
    scheduler.requestFetch("catchup");
    scheduler.requestFetch("notification");
    await settle(calls[0], { kind: "cancelled" });
    await advance(60_000);
    expect(runFetch).toHaveBeenCalledTimes(1);
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
    expect(runFetch).toHaveBeenCalledWith("periodic");
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
    scheduler.requestFetch("catchup"); // hangs
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
    scheduler.requestFetch("catchup");
    await settle(calls[0], { kind: "failed", retryInMs: 12_000 });
    await advance(11_999); // ticks at 5 s and 10 s skipped
    expect(runFetch).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(runFetch).toHaveBeenCalledTimes(2);
    expect(runFetch).toHaveBeenLastCalledWith("retry");
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
    scheduler.requestFetch("catchup");
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
    scheduler.requestFetch("catchup");
    scheduler.dispose();
    await settle(calls[0], { kind: "failed", retryInMs: 1_000 });
    await advance(10_000);
    expect(runFetch).toHaveBeenCalledTimes(1);
    expect(scheduler.getState().retryPending).toBe(false);
  });
});
