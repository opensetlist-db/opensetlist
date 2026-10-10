import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CATCHUP_JITTER_MS,
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

  it("uncorrelated triggers (initial seed, retry) run immediately", async () => {
    for (const reason of ["initial", "retry"] as const) {
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
    expect(runFetch).toHaveBeenLastCalledWith("catchup");
  });

  it("dirty: a notification wins over a catch-up (the follow-up carries the push hint)", async () => {
    const { calls, runFetch, scheduler } = harness();
    scheduler.requestFetch("initial");
    scheduler.requestFetch("catchup");
    scheduler.requestFetch("notification");
    scheduler.requestFetch("resume"); // does not downgrade
    await settle(calls[0]);
    await advance(0);
    expect(runFetch).toHaveBeenCalledTimes(2);
    expect(runFetch).toHaveBeenLastCalledWith("notification");
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
    expect(runFetch).toHaveBeenCalledWith("initial");
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
      expect(runFetch).toHaveBeenCalledWith(reason);
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

  it("a notification covered by a scheduled catch-up upgrades it to carry the push hint", async () => {
    const { runFetch, scheduler } = harness({ random: () => 0.2 });
    scheduler.requestFetch("catchup"); // due 100
    scheduler.requestFetch("notification"); // due 100 → covered
    await advance(100);
    expect(runFetch).toHaveBeenCalledTimes(1);
    expect(runFetch).toHaveBeenCalledWith("notification");
  });

  it("a catch-up covered by a scheduled retry leaves the retry in place", async () => {
    const { calls, runFetch, scheduler } = harness({ random: () => 0.5 });
    scheduler.requestFetch("initial");
    await settle(calls[0], { kind: "failed", retryInMs: 100 });
    scheduler.requestFetch("catchup"); // due 250 > retry at 100
    await advance(100);
    expect(runFetch).toHaveBeenCalledTimes(2);
    expect(runFetch).toHaveBeenLastCalledWith("retry");
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
    expect(runFetch).toHaveBeenLastCalledWith("retry");
  });

  it("an explicit trigger supersedes a pending retry", async () => {
    const { calls, runFetch, scheduler } = harness();
    scheduler.requestFetch("initial");
    await settle(calls[0], { kind: "failed", retryInMs: 30_000 });
    scheduler.requestFetch("resume");
    await advance(0); // U(0, jitter) at random = 0
    expect(runFetch).toHaveBeenCalledTimes(2);
    expect(runFetch).toHaveBeenLastCalledWith("resume");
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
    // …and, having covered a push, carries the notification hint.
    expect(runFetch).toHaveBeenLastCalledWith("notification");
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
    expect(runFetch).toHaveBeenLastCalledWith("resume");
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
    expect(runFetch).toHaveBeenCalledWith("initial");
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
