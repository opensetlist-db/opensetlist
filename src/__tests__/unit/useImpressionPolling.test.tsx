import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useImpressionPolling } from "@/hooks/useImpressionPolling";
import { setDocumentHidden } from "@/__tests__/helpers/testVisibility";

describe("useImpressionPolling", () => {
  // Math.random = 0.5 → first poll at half the interval (random phase),
  // every later gap exactly the interval (± spread at the midpoint).
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        // The /api/impressions GET response shape gained `nextCursor`
        // for cursor-paginated "see older" support. `totalCount` is
        // intentionally NOT in the polling response — polling skips
        // the `?includeTotal=1` flag to avoid an event-wide count()
        // query on the 5s hot path.
        json: async () => ({
          impressions: [],
          nextCursor: null,
        }),
      }) as unknown as typeof fetch,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("polls at the default 30 s cadence (after a 15 s phase at random = 0.5) with cache: no-store", async () => {
    // No `intervalMs` override here — exercises the hook's default,
    // which is the load-bearing value in production. The default
    // dropped from 5s → 30s as part of the F14 launch-day-retro
    // mitigation (see wiki/launch-day-retros.md#F14). If a regression
    // ever drops this back to 5s, the audience-arrival ramp would
    // re-trigger Supabase pooler EMAXCONN.
    renderHook(() =>
      useImpressionPolling({
        eventId: "1",
        enabled: true,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
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

  it("invokes onUpdate with impressions + cursor on each tick (no totalCount)", async () => {
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
    // Payload must NOT include totalCount — polling skips the
    // `?includeTotal=1` flag to keep count() off the hot path.
    expect(onUpdate).toHaveBeenCalledWith({
      impressions: [expect.objectContaining({ id: "a", content: "hi" })],
      nextCursor: "2026-04-25T00:00:00.000Z_a",
    });
  });

  it("does NOT request includeTotal=1 in the polling URL", async () => {
    renderHook(() =>
      useImpressionPolling({
        eventId: "42",
        enabled: true,
        intervalMs: 5000,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const url = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    // The polling URL is the hot path. If `includeTotal=1` ever
    // sneaks back in, the count() gate in `/api/impressions` would
    // run on every tick and re-introduce the perf concern this
    // separation is meant to prevent.
    expect(url).not.toContain("includeTotal");
  });
});

describe("useImpressionPolling — n14 cadence + visibility", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ impressions: [], nextCursor: null }),
      }) as unknown as typeof fetch,
    );
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
  });

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("random initial phase U(0, 30 s), then gaps within 30 s ± 5 s", async () => {
    // phase 0.2 → 6 s; gap draws 0 → 25 s, 0.9999 → ~35 s.
    const draws = [0.2, 0, 0.9999, 0.5];
    vi.spyOn(Math, "random").mockImplementation(() => draws.shift() ?? 0.5);
    renderHook(() => useImpressionPolling({ eventId: "1", enabled: true }));

    await advance(5_999);
    expect(global.fetch).toHaveBeenCalledTimes(0);
    await advance(1); // 6 s
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await advance(24_999);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await advance(1); // 31 s (gap 25 s)
    expect(global.fetch).toHaveBeenCalledTimes(2);
    await advance(34_998);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    await advance(2); // ~66 s (gap ≈ 35 s)
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("does not poll while the tab is hidden; resumes with one immediate catch-up", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    renderHook(() => useImpressionPolling({ eventId: "1", enabled: true }));
    await advance(15_000);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      setDocumentHidden(true);
    });
    await advance(10 * 60_000);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      setDocumentHidden(false);
    });
    await advance(0);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    // Cadence restarts with a fresh random phase (15 s at 0.5).
    await advance(15_000);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("does not fetch immediately on mount (the SSR seed is fresh)", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    renderHook(() => useImpressionPolling({ eventId: "1", enabled: true }));
    await advance(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
