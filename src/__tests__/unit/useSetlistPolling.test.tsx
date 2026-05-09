import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSetlistPolling } from "@/hooks/useSetlistPolling";
import type { FanTop3Entry } from "@/lib/types/setlist";

// Hoisted to keep referential identity across re-renders. The hook's first
// useEffect lists initialItems / initialReactionCounts in its deps, so a
// fresh literal on each render would re-fire it indefinitely.
const initialItems: unknown[] = [];
const initialReactionCounts = {};
const initialTop3Wishes: FanTop3Entry[] = [];

describe("useSetlistPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [],
          reactionCounts: {},
          updatedAt: new Date().toISOString(),
        }),
      }) as unknown as typeof fetch,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("polls every 5 seconds while enabled", async () => {
    renderHook(() =>
      useSetlistPolling({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
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
    // Guard the endpoint + eventId + locale query string so refactors
    // don't silently repoint the polling loop or drop the locale that
    // the server uses to filter the wishlist top-3 song translations.
    // `cache: "no-store"` is required so browsers can't serve a
    // private cached response across poll ticks. `signal` is the
    // AbortController from the eventId-change-race fix (CR #297) —
    // each fetch carries its controller's signal so a stale fetch
    // can be cancelled when eventId/locale changes; assert it's
    // present without pinning the exact controller instance.
    const expectedUrl = "/api/setlist?eventId=1&locale=ko";
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      expectedUrl,
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      expectedUrl,
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("does not poll when enabled=false", async () => {
    renderHook(() =>
      useSetlistPolling({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
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
        initialTop3Wishes,
        locale: "ko",
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

  it("seeds top3Wishes from initialTop3Wishes and overwrites it from polled response", async () => {
    const seed: FanTop3Entry[] = [
      {
        count: 5,
        song: {
          id: 1,
          originalTitle: "残陽",
          originalLanguage: "ja",
          variantLabel: null,
          baseVersionId: null,
          translations: [],
        },
      },
    ];
    const polled: FanTop3Entry[] = [
      {
        count: 7,
        song: {
          id: 2,
          originalTitle: "ハナムスビ",
          originalLanguage: "ja",
          variantLabel: null,
          baseVersionId: null,
          translations: [],
        },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [],
          reactionCounts: {},
          top3Wishes: polled,
          updatedAt: new Date().toISOString(),
        }),
      }) as unknown as typeof fetch,
    );

    const { result } = renderHook(() =>
      useSetlistPolling({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes: seed,
        locale: "ko",
        enabled: true,
        intervalMs: 5000,
      }),
    );

    // Pre-poll: seed is the source of truth.
    expect(result.current.top3Wishes).toEqual(seed);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    // Post-poll: server response replaces the seed.
    expect(result.current.top3Wishes).toEqual(polled);
  });

  it("falls back to [] when a polled response omits top3Wishes (older API shape)", async () => {
    // The default beforeEach fetch mock omits top3Wishes — exercises
    // the `?? []` guard in the hook so an older /api/setlist response
    // doesn't leave the seed indefinitely.
    const seed: FanTop3Entry[] = [
      {
        count: 5,
        song: {
          id: 1,
          originalTitle: "残陽",
          originalLanguage: "ja",
          variantLabel: null,
          baseVersionId: null,
          translations: [],
        },
      },
    ];
    const { result } = renderHook(() =>
      useSetlistPolling({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes: seed,
        locale: "ko",
        enabled: true,
        intervalMs: 5000,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(result.current.top3Wishes).toEqual([]);
  });
});
