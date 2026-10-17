import { describe, it, expect, vi, afterEach } from "vitest";
import {
  SNAPSHOT_FETCH_TIMEOUT_MS,
  SNAPSHOT_RETRY_AFTER_CAP_MS,
  SNAPSHOT_RETRY_SCHEDULE_MS,
  armSnapshotDeadline,
  clampRetryAfterMs,
  freshnessStateFor,
  parseRetryAfterMs,
  snapshotRetryDelayMs,
} from "@/lib/snapshotFreshness";

describe("snapshotRetryDelayMs", () => {
  it("follows 1/2/4/8/15/30 s and stays at 30 s after the last step (no jitter at random=0.5)", () => {
    const mid = () => 0.5;
    const delays = [1, 2, 3, 4, 5, 6, 7, 20].map((n) =>
      snapshotRetryDelayMs(n, null, mid),
    );
    expect(delays).toEqual([
      1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 30_000, 30_000,
    ]);
  });

  it("keeps jitter within ±20 % of each step", () => {
    SNAPSHOT_RETRY_SCHEDULE_MS.forEach((base, i) => {
      const low = snapshotRetryDelayMs(i + 1, null, () => 0);
      const high = snapshotRetryDelayMs(i + 1, null, () => 0.999999);
      expect(low).toBe(Math.round(base * 0.8));
      expect(high).toBeLessThanOrEqual(Math.round(base * 1.2));
      expect(high).toBeGreaterThan(base);
    });
  });

  it("uses Retry-After verbatim (no jitter) and caps it", () => {
    expect(snapshotRetryDelayMs(1, 5_000, () => 0)).toBe(5_000);
    expect(snapshotRetryDelayMs(6, 0, () => 0)).toBe(0);
    expect(snapshotRetryDelayMs(1, 86_400_000)).toBe(
      SNAPSHOT_RETRY_AFTER_CAP_MS,
    );
  });
});

describe("clampRetryAfterMs", () => {
  it("bounds the server floor to [0, cap] — the same bound the retry delay uses", () => {
    expect(clampRetryAfterMs(2_000)).toBe(2_000);
    expect(clampRetryAfterMs(-5)).toBe(0);
    expect(clampRetryAfterMs(86_400_000)).toBe(SNAPSHOT_RETRY_AFTER_CAP_MS);
    expect(clampRetryAfterMs(86_400_000)).toBe(snapshotRetryDelayMs(1, 86_400_000));
  });
});

describe("parseRetryAfterMs", () => {
  it("parses delta-seconds", () => {
    expect(parseRetryAfterMs("5")).toBe(5_000);
    expect(parseRetryAfterMs(" 0 ")).toBe(0);
  });

  it("parses an HTTP-date relative to now", () => {
    const now = Date.UTC(2026, 10, 14, 7, 0, 0);
    expect(
      parseRetryAfterMs("Sat, 14 Nov 2026 07:00:10 GMT", now),
    ).toBe(10_000);
    // A date in the past means "retry now", never a negative delay.
    expect(parseRetryAfterMs("Sat, 14 Nov 2026 06:00:00 GMT", now)).toBe(0);
  });

  it("returns null for absent or garbage values", () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs(undefined)).toBeNull();
    expect(parseRetryAfterMs("")).toBeNull();
    expect(parseRetryAfterMs("soon")).toBeNull();
  });
});

describe("freshnessStateFor", () => {
  it("maps consecutive failures to live → retrying → delayed", () => {
    expect(freshnessStateFor(0)).toBe("live");
    expect(freshnessStateFor(1)).toBe("retrying");
    expect(freshnessStateFor(2)).toBe("retrying");
    expect(freshnessStateFor(3)).toBe("delayed");
    expect(freshnessStateFor(10)).toBe("delayed");
  });
});

describe("armSnapshotDeadline", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts the controller and reports timedOut after the deadline", () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const onTimeout = vi.fn();
    const deadline = armSnapshotDeadline(controller, onTimeout);

    vi.advanceTimersByTime(SNAPSHOT_FETCH_TIMEOUT_MS - 1);
    expect(controller.signal.aborted).toBe(false);
    expect(deadline.timedOut()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(controller.signal.aborted).toBe(true);
    expect(deadline.timedOut()).toBe(true);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("does nothing once cleared, and a manual abort is not a timeout", () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const deadline = armSnapshotDeadline(controller);
    controller.abort();
    deadline.clear();
    vi.advanceTimersByTime(SNAPSHOT_FETCH_TIMEOUT_MS * 2);
    expect(deadline.timedOut()).toBe(false);
  });
});
