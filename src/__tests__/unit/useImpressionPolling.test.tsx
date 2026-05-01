import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useImpressionPolling } from "@/hooks/useImpressionPolling";

describe("useImpressionPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        // The /api/impressions GET response shape gained `nextCursor`
        // and `totalCount` for cursor-paginated "see older" support;
        // the polling hook now forwards both to its onUpdate
        // callback. Default mock returns an empty page with no more
        // older content.
        json: async () => ({
          impressions: [],
          nextCursor: null,
          totalCount: 0,
        }),
      }) as unknown as typeof fetch,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("polls every 5 seconds while enabled with cache: no-store", async () => {
    renderHook(() =>
      useImpressionPolling({
        eventId: "1",
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
    // `cache: "no-store"` is required so browsers can't serve a private
    // cached response across poll ticks.
    const expectedUrl = "/api/impressions?eventId=1";
    const expectedInit = { cache: "no-store" };
    expect(global.fetch).toHaveBeenNthCalledWith(1, expectedUrl, expectedInit);
    expect(global.fetch).toHaveBeenNthCalledWith(2, expectedUrl, expectedInit);
  });

  it("does not poll when enabled=false", async () => {
    renderHook(() =>
      useImpressionPolling({
        eventId: "1",
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
      useImpressionPolling({
        eventId: "1",
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

  it("invokes onUpdate with impressions + cursor + totalCount on each tick", async () => {
    const onUpdate = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          impressions: [
            {
              id: "a",
              rootImpressionId: "a",
              eventId: "1",
              content: "hi",
              locale: "ko",
              createdAt: "2026-04-25T00:00:00.000Z",
            },
          ],
          nextCursor: "2026-04-25T00:00:00.000Z_a",
          totalCount: 123,
        }),
      }) as unknown as typeof fetch,
    );

    renderHook(() =>
      useImpressionPolling({
        eventId: "1",
        enabled: true,
        intervalMs: 5000,
        onUpdate,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({
      impressions: [expect.objectContaining({ id: "a", content: "hi" })],
      nextCursor: "2026-04-25T00:00:00.000Z_a",
      totalCount: 123,
    });
  });
});
