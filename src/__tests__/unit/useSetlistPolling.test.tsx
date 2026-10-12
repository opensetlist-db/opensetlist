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
  // Math.random = 0.5 → first poll at the random phase 0.5 × 5 s =
  // 2.5 s, every later gap exactly 5 s (5 s ± 1 s at the midpoint).
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
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

  it("polls on a 5 s cadence after a random initial phase while enabled", async () => {
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
      await vi.advanceTimersByTimeAsync(2_499);
    });
    expect(global.fetch).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    // Guard the endpoint + eventId + locale query string so refactors
    // don't silently repoint the polling loop or drop the locale that
    // the server uses to filter the wishlist top-3 song translations.
    // `signal` carries the per-request deadline + cleanup abort —
    // assert it's present without pinning the instance. n14: no
    // `cache: "no-store"` any more — the snapshot response is
    // `max-age=0, must-revalidate`, so the default mode revalidates.
    // No `minRev` while no revision is known (responses here carry
    // none).
    const expectedUrl = "/api/setlist?eventId=1&locale=ko";
    for (const n of [1, 2]) {
      expect(global.fetch).toHaveBeenNthCalledWith(
        n,
        expectedUrl,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      const init = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[n - 1][1];
      expect(init).not.toHaveProperty("cache");
    }
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
      await vi.advanceTimersByTimeAsync(2500);
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

  // Timeline: first tick at the 2.5 s random phase, then every 5 s.
  // A failure arms n13's retry (1/2/4/8/15/30 s) and ticks are skipped
  // while it is pending, so the backoff — not the cadence — paces a
  // struggling server.

  it("a timed-out request releases the single-flight guard and retries", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(hangingFetch)
      .mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result } = mount();

    // t=2.5 s: first tick hangs. t=7.5 s: skipped (still in flight).
    await advance(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // t=10.5 s: 8 s deadline → failure, retry armed for +1 s.
    await advance(500);
    expect(result.current.freshness.state).toBe("retrying");
    // t=11.5 s: retry succeeds.
    await advance(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.freshness.state).toBe("live");
    expect(result.current.freshness.lastSyncAt).toBeInstanceOf(Date);
  });

  it("backs off on consecutive failures and reports delayed after 3", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse());
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result } = mount();

    // Failures at 2.5 s, then retries at +1 s (3.5) and +2 s (5.5).
    await advance(5_500);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.freshness.state).toBe("delayed");
    // +4 s → 9.5 s (the 7.5 s tick is skipped: retry pending).
    await advance(3_999);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // +8 s → 17.5 s; the 12.5 s tick is skipped.
    await advance(7_999);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("honours Retry-After (ticks wait for it)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse("12"))
      .mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result } = mount();

    await advance(2_500); // fails, retry at 14.5 s
    await advance(11_999); // 7.5 s + 12.5 s ticks skipped
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.freshness.state).toBe("live");
  });

  it("cleanup abort on unmount is not counted as a failure", async () => {
    const fetchMock = vi.fn(hangingFetch);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result, unmount } = mount();
    await advance(2_500);
    const before = result.current.freshness;
    unmount();
    await advance(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(before.state).toBe("live");
  });
});

// ────────────────────────────────────────────────────────────────────
// n14 — random phase + spread, minRev, acceptance
// ────────────────────────────────────────────────────────────────────

describe("useSetlistPolling — n14 cadence + acceptance", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function mount(extra: { initialRev?: number | null; initialCapturedAt?: string | null } = {}) {
    return renderHook(() =>
      useSetlistPolling({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
        ...extra,
      }),
    );
  }

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("first poll at a random phase U(0, 5 s), later gaps within 5 s ± 1 s", async () => {
    // Phase draw 0.1 → 500 ms; gap draws 0 → 4 s (lower bound), then
    // 0.9999 → just under 6 s (upper bound).
    const draws = [0.1, 0, 0.9999, 0.5, 0.5];
    vi.spyOn(Math, "random").mockImplementation(() => draws.shift() ?? 0.5);
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    mount();

    await advance(499);
    expect(fetchMock).toHaveBeenCalledTimes(0);
    await advance(1); // 0.5 s
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(3_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(1); // 4.5 s (gap 4 s)
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advance(5_998);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advance(2); // ~10.5 s (gap ≈ 6 s)
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("two pollers that start together drift apart (random phase)", async () => {
    let n = 0;
    // Poller A draws 0.1, poller B draws 0.7 for the phase.
    vi.spyOn(Math, "random").mockImplementation(() => (n++ === 0 ? 0.1 : 0.7));
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    mount();
    mount();
    await advance(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(3_000); // B's phase is 3.5 s
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends minRev and never lets an older response roll the page back", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const fresh = [{ id: "fresh" }];
    const stale = [{ id: "stale" }];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: fresh, rev: 6, capturedAt: "2026-11-14T07:30:00.000Z" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: stale, rev: 5, capturedAt: "2026-11-14T07:30:05.000Z" }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ items: fresh, rev: 6, capturedAt: "2026-11-14T07:30:10.000Z" }),
      });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result } = mount({ initialRev: 5, initialCapturedAt: "2026-11-14T07:29:00.000Z" });
    expect(result.current.rev).toBe(5);

    await advance(2_500);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/setlist?eventId=1&locale=ko&minRev=5");
    expect(result.current.items).toBe(fresh);
    expect(result.current.rev).toBe(6);
    expect(result.current.capturedAt).toBe("2026-11-14T07:30:00.000Z");

    await advance(5_000); // older rev → rejected, soft failure
    expect(fetchMock.mock.calls[1][0]).toBe("/api/setlist?eventId=1&locale=ko&minRev=6");
    expect(result.current.items).toBe(fresh);
    expect(result.current.freshness.state).toBe("retrying");

    await advance(1_000); // retry
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.freshness.state).toBe("live");
    expect(result.current.capturedAt).toBe("2026-11-14T07:30:10.000Z");
  });
});
