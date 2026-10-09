import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MAX_TIMEOUT_MS, setTimeoutAt } from "@/lib/timeoutAt";

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-10T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("setTimeoutAt", () => {
  it("fires at a near target", () => {
    const cb = vi.fn();
    setTimeoutAt(Date.now() + 1000, cb);
    vi.advanceTimersByTime(999);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("does not fire early for a target beyond the 32-bit setTimeout limit", () => {
    const cb = vi.fn();
    const target = Date.now() + 36 * DAY;
    expect(target - Date.now()).toBeGreaterThan(MAX_TIMEOUT_MS);
    setTimeoutAt(target, cb);
    vi.advanceTimersByTime(1);
    expect(cb).not.toHaveBeenCalled();
    // First hop (~24.8 days) re-arms instead of firing.
    vi.advanceTimersByTime(MAX_TIMEOUT_MS);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(36 * DAY - MAX_TIMEOUT_MS - 2);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("past target fires on the next macrotask, not synchronously", () => {
    const cb = vi.fn();
    setTimeoutAt(Date.now() - 5, cb);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("cancel stops a pending long wait", () => {
    const cb = vi.fn();
    const cancel = setTimeoutAt(Date.now() + 36 * DAY, cb);
    vi.advanceTimersByTime(MAX_TIMEOUT_MS);
    cancel();
    vi.advanceTimersByTime(36 * DAY);
    expect(cb).not.toHaveBeenCalled();
  });
});
