import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSetlistPolling } from "@/hooks/useSetlistPolling";

// Hoisted to keep referential identity across re-renders. The hook's first
// useEffect lists initialItems / initialReactionCounts in its deps, so a
// fresh literal on each render would re-fire it indefinitely.
const initialItems: unknown[] = [];
const initialReactionCounts = {};

describe("useSetlistPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [],
        reactionCounts: {},
        updatedAt: new Date().toISOString(),
      }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("polls every 5 seconds while enabled", async () => {
    renderHook(() =>
      useSetlistPolling({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        enabled: true,
        intervalMs: 5000,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not poll when enabled=false", async () => {
    renderHook(() =>
      useSetlistPolling({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        enabled: false,
        intervalMs: 5000,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("clears the interval on unmount (no leak)", async () => {
    const { unmount } = renderHook(() =>
      useSetlistPolling({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        enabled: true,
        intervalMs: 5000,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
