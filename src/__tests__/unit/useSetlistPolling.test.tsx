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

// ────────────────────────────────────────────────────────────────────
// Freshness, fetch deadline, and backoff
//
// The interval is the retry loop here; backoff is "skip ticks until
// the retry delay elapses". Math.random pinned to 0.5 → zero jitter.
// ────────────────────────────────────────────────────────────────────

function okResponse() {
  return {
    ok: true,
    json: async () => ({
      items: [],
      reactionCounts: {},
      updatedAt: new Date().toISOString(),
    }),
  };
}

function errorResponse(retryAfter?: string) {
  return {
    ok: false,
    status: 503,
    headers: new Headers(retryAfter ? { "Retry-After": retryAfter } : {}),
    json: async () => ({}),
  };
}

function hangingFetch(_url: string, init?: RequestInit) {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("aborted", "AbortError")),
    );
  });
}

describe("useSetlistPolling — freshness + deadline + backoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function mount() {
    return renderHook(() =>
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
  }

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("a timed-out request clears the in-flight guard so polling resumes", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(hangingFetch)
      .mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result } = mount();

    // t=5 s: first tick hangs. t=10 s: skipped (still in flight).
    await advance(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // t=13 s: 8 s deadline → aborted, guard released, 1 failure.
    await advance(3_000);
    expect(result.current.freshness.state).toBe("retrying");
    // t=15 s: backoff (1 s) elapsed → tick runs and succeeds.
    await advance(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.freshness.state).toBe("live");
    expect(result.current.freshness.lastSyncAt).toBeInstanceOf(Date);
  });

  it("backs off on consecutive failures and reports delayed after 3", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse());
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result } = mount();

    // Failures at 5, 10, 15 s (1/2/4 s delays are under the cadence).
    await advance(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.freshness.state).toBe("delayed");
    // 4th failure at 20 s → next allowed at 28 s → 25 s tick skipped.
    await advance(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await advance(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await advance(5_000); // 30 s
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("honours Retry-After by skipping ticks", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse("12"))
      .mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result } = mount();

    await advance(5_000); // fails, next allowed at 17 s
    await advance(10_000); // 10 s + 15 s ticks skipped
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(5_000); // 20 s
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.freshness.state).toBe("live");
  });

  it("cleanup abort on unmount is not counted as a failure", async () => {
    const fetchMock = vi.fn(hangingFetch);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result, unmount } = mount();
    await advance(5_000);
    const before = result.current.freshness;
    unmount();
    await advance(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(before.state).toBe("live");
  });
});
