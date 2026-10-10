import { describe, it, expect } from "vitest";
import {
  HEALTHY_BUDGET_RESET_MS,
  MAX_RECREATE_ATTEMPTS,
  RECREATE_BACKOFF_BASE_MS,
  RECREATE_BACKOFF_MAX_BASE_MS,
  REJOIN_GRACE_MS,
  recreateBackoffMs,
} from "@/lib/realtimeRecovery";

// realtime-js 2.105 backoff ceilings (RealtimeClient RECONNECT_INTERVALS
// last step, phoenix rejoinAfterMs last explicit step). The grace must
// leave their own recovery alone.
const REALTIME_JS_RECONNECT_CEILING_MS = 10_000;
const REALTIME_JS_REJOIN_STEP_MS = 5_000;

describe("realtimeRecovery constants", () => {
  it("the rejoin grace exceeds realtime-js's own backoff ceilings by a wide margin", () => {
    expect(REJOIN_GRACE_MS).toBeGreaterThan(
      REALTIME_JS_RECONNECT_CEILING_MS + REALTIME_JS_REJOIN_STEP_MS,
    );
    expect(REJOIN_GRACE_MS).toBeGreaterThanOrEqual(
      3 * (REALTIME_JS_RECONNECT_CEILING_MS + REALTIME_JS_REJOIN_STEP_MS),
    );
  });

  it("a refund needs minutes of continuous health, so a flapping network cannot reset its own budget", () => {
    expect(HEALTHY_BUDGET_RESET_MS).toBeGreaterThanOrEqual(5 * 60_000);
    expect(MAX_RECREATE_ATTEMPTS).toBeGreaterThan(0);
  });
});

describe("recreateBackoffMs", () => {
  it("attempt n waits U(base, 3·base), base doubling from 5 s and capped at 20 s", () => {
    const ranges = [1, 2, 3, 4, 10].map((n) => [
      recreateBackoffMs(n, () => 0),
      recreateBackoffMs(n, () => 0.999999),
    ]);
    expect(ranges[0][0]).toBe(RECREATE_BACKOFF_BASE_MS); // 5 s
    expect(ranges[0][1]).toBeLessThanOrEqual(15_000);
    expect(ranges[1][0]).toBe(10_000);
    expect(ranges[1][1]).toBeLessThanOrEqual(30_000);
    expect(ranges[2][0]).toBe(RECREATE_BACKOFF_MAX_BASE_MS); // 20 s
    expect(ranges[2][1]).toBeLessThanOrEqual(60_000);
    // Capped from here on.
    expect(ranges[3]).toEqual(ranges[2]);
    expect(ranges[4]).toEqual(ranges[2]);
  });

  it("spreads a population that hit the grace edge together over ≥ 10 s", () => {
    // 500 tabs whose sockets dropped at the same instant: their first
    // re-creations must not land in the same second (the n12 lesson).
    const delays = Array.from({ length: 500 }, (_, i) =>
      recreateBackoffMs(1, () => i / 500),
    );
    const perSecond = new Map<number, number>();
    for (const d of delays) {
      const s = Math.floor(d / 1000);
      perSecond.set(s, (perSecond.get(s) ?? 0) + 1);
    }
    expect(Math.max(...delays) - Math.min(...delays)).toBeGreaterThanOrEqual(9_900);
    // Uniform over 10 s → ~50 joins per second, never the whole audience.
    expect(Math.max(...perSecond.values())).toBeLessThanOrEqual(60);
  });
});
