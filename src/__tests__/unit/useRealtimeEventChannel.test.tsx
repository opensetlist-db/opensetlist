import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { flushMicrotasks } from "@/__tests__/helpers/flushMicrotasks";

// ── Sentry mock ────────────────────────────────────────────────────
// vi.mock factories are hoisted above the imports — so they execute
// before `useRealtimeEventChannel.ts` is loaded and before its
// `import * as Sentry from "@sentry/nextjs"` resolves. Capture the
// fakes via `vi.hoisted` so the test body can also read them.
const { addBreadcrumbMock, captureMessageMock } = vi.hoisted(() => ({
  addBreadcrumbMock: vi.fn(),
  captureMessageMock: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: addBreadcrumbMock,
  captureMessage: captureMessageMock,
}));

// ── Supabase client mock ───────────────────────────────────────────
// Capture the subscribe callback so the test can drive channel
// status transitions (SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT)
// directly. Each test starts with a fresh capture by resetting in
// beforeEach.
let capturedSubscribeCallback:
  | ((status: string, err?: Error) => void)
  | null = null;

// Captured postgres_changes handlers, keyed by their subscription
// config so a test can drive a specific table's push (e.g. the
// SetlistItem Path B handler) and assert the scopedRefetch guard.
const capturedPostgresHandlers: Array<{
  config: { table?: string; event?: string };
  handler: (payload: unknown) => void;
}> = [];

const fakeChannel = {
  on: vi.fn(
    (
      _event: string,
      config: { table?: string; event?: string },
      handler: (payload: unknown) => void,
    ) => {
      capturedPostgresHandlers.push({ config, handler });
      return fakeChannel;
    },
  ),
  subscribe: vi.fn((cb: (status: string, err?: Error) => void) => {
    capturedSubscribeCallback = cb;
    return fakeChannel;
  }),
};

const channelMock = vi.fn(() => fakeChannel);
const removeChannelMock = vi.fn();

vi.mock("@/lib/supabaseClient", () => ({
  getSupabaseBrowserClient: () => ({
    channel: channelMock,
    removeChannel: removeChannelMock,
  }),
}));

// Imports come AFTER the mocks above so the hook resolves the mocked
// modules at load time.
import { useRealtimeEventChannel } from "@/hooks/useRealtimeEventChannel";
import {
  RECOVERY_DELAY_MS,
  MAX_RECOVERY_ATTEMPTS,
} from "@/lib/realtimeRecovery";
import { ONGOING_BUFFER_MS } from "@/lib/eventStatus";
import type { FanTop3Entry } from "@/lib/types/setlist";
import { setDocumentHidden } from "@/__tests__/helpers/testVisibility";

const initialItems: unknown[] = [];
const initialReactionCounts = {};
const initialTop3Wishes: FanTop3Entry[] = [];

function makeFetchResponse(updatedAt = "2026-05-09T12:00:00Z") {
  return {
    ok: true,
    json: async () => ({
      items: [],
      reactionCounts: {},
      top3Wishes: [],
      status: "ongoing",
      updatedAt,
    }),
  };
}

describe("useRealtimeEventChannel — R3 fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    capturedSubscribeCallback = null;
    addBreadcrumbMock.mockClear();
    captureMessageMock.mockClear();
    channelMock.mockClear();
    removeChannelMock.mockClear();
    fakeChannel.on.mockClear();
    fakeChannel.subscribe.mockClear();
    // Re-establish the handler-capturing impl + clear the capture
    // buffer so each test sees only its own subscription handlers
    // (restoreAllMocks in afterEach can reset the vi.fn impl).
    capturedPostgresHandlers.length = 0;
    fakeChannel.on.mockImplementation(
      (
        _event: string,
        config: { table?: string; event?: string },
        handler: (payload: unknown) => void,
      ) => {
        capturedPostgresHandlers.push({ config, handler });
        return fakeChannel;
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFetchResponse()) as unknown as typeof fetch,
    );
    // Default to visible. R3.5 paused-gate would early-return the
    // channel-setup effect if hidden, breaking every pre-R3.5 test.
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
  });

  it("flips to polling fallback on CHANNEL_ERROR", async () => {
    const { result } = renderHook(() =>
      useRealtimeEventChannel({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
        // null startTime so the boundary timer is a no-op for the
        // fallback / Sentry / reconnect tests below — those don't
        // exercise boundary behavior. Boundary-specific tests at
        // the bottom of this file pass concrete ISO strings.
        startTime: null,
      }),
    );

    // Channel was set up; subscribe callback captured.
    expect(capturedSubscribeCallback).not.toBeNull();
    expect(channelMock).toHaveBeenCalledWith("event:1");

    // Simulate the supabase channel hitting CHANNEL_ERROR after the
    // server-side handshake / RLS check fails or the WS errors out.
    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
    });

    // Polling fallback now drives the page; useSetlistPolling started
    // its 5s interval. Advance one tick and the polling fetch fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    // The realtime channel was torn down (effect cleanup ran when
    // pollFallback flipped, removing the dead channel from the
    // supabase-js registry).
    expect(removeChannelMock).toHaveBeenCalledTimes(1);

    // Polling continues — the snapshot is fetched on the polling
    // cadence. The initial mount fetch + at least one polling fetch
    // both ran against /api/setlist.
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    // The hook is still mounted; its return shape is the polled state.
    expect(result.current.lastUpdated).toBeTruthy();
  });

  it("flips to polling fallback on TIMED_OUT", async () => {
    renderHook(() =>
      useRealtimeEventChannel({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
        // null startTime so the boundary timer is a no-op for the
        // fallback / Sentry / reconnect tests below — those don't
        // exercise boundary behavior. Boundary-specific tests at
        // the bottom of this file pass concrete ISO strings.
        startTime: null,
      }),
    );

    expect(capturedSubscribeCallback).not.toBeNull();

    await act(async () => {
      capturedSubscribeCallback!("TIMED_OUT");
    });

    expect(removeChannelMock).toHaveBeenCalledTimes(1);
  });

  it("scopes notifications to this event — cross-event pushes don't refetch", async () => {
    // Pin jitter to 0 so a same-event push fetches on the next timer
    // turn; advance past the 1 s cooldown between pushes.
    vi.spyOn(Math, "random").mockReturnValue(0);
    renderHook(() =>
      useRealtimeEventChannel({
        eventId: "5",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
        startTime: null,
      }),
    );

    expect(channelMock).toHaveBeenCalledWith("event:5");
    const setlistItemHandler = capturedPostgresHandlers.find(
      (h) => h.config.table === "SetlistItem",
    )?.handler;
    expect(setlistItemHandler).toBeTypeOf("function");

    await act(async () => {
      capturedSubscribeCallback!("SUBSCRIBED");
      await flushMicrotasks();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const baseline = fetchMock.mock.calls.length;

    const push = async (payload: unknown) => {
      await act(async () => {
        setlistItemHandler!(payload);
        await vi.advanceTimersByTimeAsync(1_000);
      });
    };

    // Cross-event INSERT/UPDATE (payload.new.eventId = 9 ≠ 5): no refetch.
    await push({ new: { eventId: 9 }, old: null });
    expect(fetchMock.mock.calls.length).toBe(baseline);
    // Cross-event DELETE (eventId only on payload.old — REPLICA
    // IDENTITY FULL): still no refetch.
    await push({ new: null, old: { eventId: 9 } });
    expect(fetchMock.mock.calls.length).toBe(baseline);

    // Same-event push: exactly one refetch.
    await push({ new: { eventId: 5 }, old: null });
    expect(fetchMock.mock.calls.length).toBe(baseline + 1);

    // Missing eventId (REPLICA IDENTITY misconfig / unexpected shape):
    // fall through to a refetch — correctness over efficiency.
    await push({ new: {}, old: null });
    expect(fetchMock.mock.calls.length).toBe(baseline + 2);
  });

  it("subscribes to SetlistItem only — the SetlistItemReaction and SongWish paths are gone (n14)", () => {
    renderHook(() =>
      useRealtimeEventChannel({
        eventId: "5",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
        startTime: null,
      }),
    );
    const tables = capturedPostgresHandlers.map((h) => h.config.table);
    expect(tables).toEqual(["SetlistItem"]);
  });

  it("emits captureMessage exactly once per session even on repeated errors", async () => {
    renderHook(() =>
      useRealtimeEventChannel({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
        // null startTime so the boundary timer is a no-op for the
        // fallback / Sentry / reconnect tests below — those don't
        // exercise boundary behavior. Boundary-specific tests at
        // the bottom of this file pass concrete ISO strings.
        startTime: null,
      }),
    );

    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
    });
    // The fallback flip tore down the channel; subsequent status
    // callbacks would only re-fire if the channel re-subscribed.
    // Even if a stale callback closure fires again (defensive
    // simulation), the latch ref must keep captureMessage at one.
    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
      capturedSubscribeCallback!("TIMED_OUT");
    });

    expect(captureMessageMock).toHaveBeenCalledTimes(1);
    expect(captureMessageMock).toHaveBeenCalledWith(
      "Realtime fallback to polling",
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({
          eventId: "1",
          transitionReason: "CHANNEL_ERROR",
        }),
      }),
    );
  });

  it("breadcrumbs every status transition with the realtime category", async () => {
    renderHook(() =>
      useRealtimeEventChannel({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
        // null startTime so the boundary timer is a no-op for the
        // fallback / Sentry / reconnect tests below — those don't
        // exercise boundary behavior. Boundary-specific tests at
        // the bottom of this file pass concrete ISO strings.
        startTime: null,
      }),
    );

    await act(async () => {
      capturedSubscribeCallback!("SUBSCRIBED");
    });
    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
    });

    // Both transitions produced breadcrumbs, with level info for
    // SUBSCRIBED and warning for CHANNEL_ERROR.
    const calls = addBreadcrumbMock.mock.calls;
    const transitions = calls.map(([arg]) => ({
      message: arg.message as string,
      level: arg.level as string,
      category: arg.category as string,
    }));
    expect(transitions).toContainEqual(
      expect.objectContaining({
        category: "realtime",
        level: "info",
        message: expect.stringContaining("SUBSCRIBED"),
      }),
    );
    expect(transitions).toContainEqual(
      expect.objectContaining({
        category: "realtime",
        level: "warning",
        message: expect.stringContaining("CHANNEL_ERROR"),
      }),
    );
  });

  it("refetches the snapshot on every SUBSCRIBED — initial catch-up and reconnect", async () => {
    renderHook(() =>
      useRealtimeEventChannel({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
        // null startTime so the boundary timer is a no-op for the
        // fallback / Sentry / reconnect tests below — those don't
        // exercise boundary behavior. Boundary-specific tests at
        // the bottom of this file pass concrete ISO strings.
        startTime: null,
      }),
    );

    // Mount-time fetch was kicked off inside the useEffect; flush
    // microtasks to let the Promise chain settle.
    await flushMicrotasks();
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // First SUBSCRIBED — the initial channel join. Exactly ONE
    // catch-up fetch: the seed ran before the channel was live, so a
    // write committed in between would otherwise be missed.
    await act(async () => {
      capturedSubscribeCallback!("SUBSCRIBED");
    });
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Second SUBSCRIBED — supabase-js auto-rejoined after a transient
    // socket drop. We may have missed pushes during the gap; refetch.
    await act(async () => {
      capturedSubscribeCallback!("SUBSCRIBED");
    });
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("SUBSCRIBED during an in-flight seed queues ONE follow-up after the seed settles — no abort", async () => {
    let resolveSeed: (value: unknown) => void = () => {};
    let seedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      void url;
      if (fetchMock.mock.calls.length === 1) {
        seedSignal = init?.signal ?? undefined;
        return new Promise((resolve) => {
          resolveSeed = resolve;
        });
      }
      return Promise.resolve(makeFetchResponse());
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const { result } = renderHook(() =>
      useRealtimeEventChannel({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
        startTime: null,
      }),
    );
    await flushMicrotasks();
    expect(seedSignal).toBeInstanceOf(AbortSignal);

    await act(async () => {
      capturedSubscribeCallback!("SUBSCRIBED");
      capturedSubscribeCallback!("SUBSCRIBED"); // still one follow-up
    });
    await flushMicrotasks();
    // Single-flight: the seed is NOT aborted (an abort would not stop
    // the server's work anyway) and no second request starts yet.
    expect(seedSignal!.aborted).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSeed(makeFetchResponse());
      await vi.advanceTimersByTimeAsync(0);
    });
    await flushMicrotasks();
    // Exactly one catch-up whose read starts after activation.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.freshness.state).toBe("live");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not subscribe to the channel when enabled=false", () => {
    renderHook(() =>
      useRealtimeEventChannel({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: false,
        startTime: null,
      }),
    );

    expect(channelMock).not.toHaveBeenCalled();
    expect(capturedSubscribeCallback).toBeNull();
  });

  // ──────────────────────────────────────────────────────────────────
  // Status-boundary scheduler tests
  //
  // Pre-Realtime, the 5s polling cadence inside `useSetlistPolling`
  // implicitly caught the upcoming → ongoing flip — every poll's
  // /api/setlist response carried server-resolved `status`. With
  // Realtime, the endpoint is only refetched on push (SetlistItem
  // and SongWish), so a startTime crossing in a no-activity window
  // would leave polledStatus stale and let `polledStatus ?? status`
  // in LiveEventLayout mask a fresh SSR status. The boundary
  // scheduler closes that gap.
  // ──────────────────────────────────────────────────────────────────

  // These pin Math.random = 0.5 so the 20 s ± 4 s periodic repair poll
  // ticks at exact 20 s multiples, and assert on the fetch-count delta
  // in a narrow window around each boundary (no periodic tick inside).

  it("schedules a snapshot request at the upcoming → ongoing boundary", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    // startTime 30s in the future (within the 24.8-day setTimeout
    // ceiling, so the schedule actually fires). Boundary = +32 s
    // (POST_BOUNDARY_BUFFER_MS = 2 s).
    const startTime = new Date(Date.now() + 30_000).toISOString();

    renderHook(() =>
      useRealtimeEventChannel({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
        startTime,
      }),
    );

    await flushMicrotasks();
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1); // seed

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_900);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2); // + periodic @ 20 s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    // Boundary timer fired → snapshot requested.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("re-schedules the next boundary after the first fires (ongoing → completed)", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    // ONGOING_BUFFER_MS imported from `@/lib/eventStatus` so a future
    // tweak to the buffer value surfaces here as a fresh-test-fail
    // rather than a silent false-pass.
    const startTime = new Date(Date.now() + 30_000).toISOString();

    renderHook(() =>
      useRealtimeEventChannel({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
        startTime,
      }),
    );
    await flushMicrotasks();
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;

    const second = 32_000 + ONGOING_BUFFER_MS;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(second - 100);
    });
    const before = fetchMock.mock.calls.length;
    // seed + one periodic per 20 s + the first boundary.
    expect(before).toBe(1 + Math.floor((second - 100) / 20_000) + 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(fetchMock).toHaveBeenCalledTimes(before + 1);
  });

  it("does not schedule a boundary when startTime is null", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    renderHook(() =>
      useRealtimeEventChannel({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
        startTime: null,
      }),
    );

    await flushMicrotasks();
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1); // mount seed only

    // An hour of quiet: only the 20 s periodic repair poll fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1 + 180);
  });

  it("does not schedule a boundary when startTime is in the past (event already past completed)", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    // 24h ago: past both startTime and the ONGOING_BUFFER_MS=12h
    // window, so nextEventStatusBoundaryDelay returns null.
    const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    renderHook(() =>
      useRealtimeEventChannel({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
        startTime,
      }),
    );

    await flushMicrotasks();
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1 + 180);
  });
});

// ────────────────────────────────────────────────────────────────────
// R3.5 — visibility handling + bounded auto-recovery
//
// Sentry issue 7485048757: ~19 fallbacks/day baseline. Dominant cause
// per breadcrumb analysis: macOS Chrome background-tab throttling (11
// minutes of silent breadcrumbs preceding the CHANNEL_ERROR pair on
// both channels). Visibility hide proactively tears the channel down
// (no CHANNEL_ERROR emitted); visibility resume re-subscribes AND
// triggers fetchSnapshot to gap-fill missed pushes. Bounded
// time-based auto-recovery handles failures that occur while the tab
// is visible (network blip, momentary server reject).
// ────────────────────────────────────────────────────────────────────

describe("useRealtimeEventChannel — R3.5 visibility + auto-recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    capturedSubscribeCallback = null;
    addBreadcrumbMock.mockClear();
    captureMessageMock.mockClear();
    channelMock.mockClear();
    removeChannelMock.mockClear();
    fakeChannel.on.mockClear();
    fakeChannel.subscribe.mockClear();
    // Mirror the first describe's reset (CR #504): clear the capture
    // buffer + re-establish the handler-capturing impl so any future
    // Path B handler test added to this block isn't flaky. The R3.5
    // tests below don't read capturedPostgresHandlers today, but the
    // two beforeEach blocks should stay symmetric.
    capturedPostgresHandlers.length = 0;
    fakeChannel.on.mockImplementation(
      (
        _event: string,
        config: { table?: string; event?: string },
        handler: (payload: unknown) => void,
      ) => {
        capturedPostgresHandlers.push({ config, handler });
        return fakeChannel;
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFetchResponse()) as unknown as typeof fetch,
    );
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
  });

  it("tears down channel when document becomes hidden, re-subscribes on visible", async () => {
    renderHook(() =>
      useRealtimeEventChannel({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
        startTime: null,
      }),
    );
    await flushMicrotasks();

    expect(channelMock).toHaveBeenCalledTimes(1);
    expect(removeChannelMock).not.toHaveBeenCalled();

    await act(async () => {
      setDocumentHidden(true);
    });
    expect(removeChannelMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      setDocumentHidden(false);
    });
    expect(channelMock).toHaveBeenCalledTimes(2);
  });

  it("triggers a snapshot refetch after visibility resume (gap-fill missed pushes)", async () => {
    renderHook(() =>
      useRealtimeEventChannel({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
        startTime: null,
      }),
    );
    await flushMicrotasks();
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    // Mount-time seed fetch.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // First SUBSCRIBED — initial join catch-up.
    await act(async () => {
      capturedSubscribeCallback!("SUBSCRIBED");
    });
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Hide + show — fresh channel set up; the re-run effect seeds a
    // snapshot immediately (gap-fill for the away window).
    await act(async () => {
      setDocumentHidden(true);
    });
    await act(async () => {
      setDocumentHidden(false);
    });
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Post-resume SUBSCRIBED — same catch-up as an initial join
    // (closes the resume-seed → subscribe window).
    await act(async () => {
      capturedSubscribeCallback!("SUBSCRIBED");
    });
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does NOT emit captureMessage when channel tear-down is visibility-driven", async () => {
    renderHook(() =>
      useRealtimeEventChannel({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
        startTime: null,
      }),
    );
    await flushMicrotasks();

    await act(async () => {
      capturedSubscribeCallback!("SUBSCRIBED");
    });
    await act(async () => {
      setDocumentHidden(true);
    });
    await act(async () => {
      setDocumentHidden(false);
    });

    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it("schedules auto-recovery after CHANNEL_ERROR while tab is visible", async () => {
    renderHook(() =>
      useRealtimeEventChannel({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
        startTime: null,
      }),
    );
    await flushMicrotasks();

    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
    });
    expect(removeChannelMock).toHaveBeenCalledTimes(1);

    // After RECOVERY_DELAY_MS, setPollFallback(false) fires → effect
    // re-runs → channel re-subscribes.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECOVERY_DELAY_MS);
    });
    await flushMicrotasks();
    expect(channelMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT schedule auto-recovery when CHANNEL_ERROR fires while tab is hidden", async () => {
    renderHook(() =>
      useRealtimeEventChannel({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
        startTime: null,
      }),
    );
    await flushMicrotasks();

    await act(async () => {
      setDocumentHidden(true);
    });
    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
    });

    const channelCallsBefore = channelMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECOVERY_DELAY_MS * 2);
    });
    expect(channelMock.mock.calls.length).toBe(channelCallsBefore);
  });

  it("exhausts the recovery budget after MAX_RECOVERY_ATTEMPTS", async () => {
    renderHook(() =>
      useRealtimeEventChannel({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
        startTime: null,
      }),
    );
    await flushMicrotasks();

    for (let i = 0; i < MAX_RECOVERY_ATTEMPTS; i++) {
      await act(async () => {
        capturedSubscribeCallback!("CHANNEL_ERROR");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(RECOVERY_DELAY_MS);
      });
      await flushMicrotasks();
    }

    // One more CHANNEL_ERROR — budget gone, no further re-subscribe.
    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
    });
    const channelCallsBefore = channelMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECOVERY_DELAY_MS * 2);
    });
    expect(channelMock.mock.calls.length).toBe(channelCallsBefore);
  });

  it("does not subscribe a channel on mount when document is already hidden (CR — useSyncExternalStore)", async () => {
    // `useSyncExternalStore` reads `document.hidden` during the first
    // render (via getSnapshot), so `paused` is `true` from the very
    // first render — the channel-setup effect early-returns without
    // ever subscribing.
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });

    renderHook(() =>
      useRealtimeEventChannel({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
        startTime: null,
      }),
    );
    await flushMicrotasks();

    expect(channelMock).not.toHaveBeenCalled();
    expect(removeChannelMock).not.toHaveBeenCalled();
  });

  it("ignores CHANNEL_ERROR while the tab is hidden — no captureMessage, no pollFallback flip (CR)", async () => {
    renderHook(() =>
      useRealtimeEventChannel({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
        startTime: null,
      }),
    );
    await flushMicrotasks();

    expect(capturedSubscribeCallback).not.toBeNull();
    const subscribeCallback = capturedSubscribeCallback!;

    await act(async () => {
      setDocumentHidden(true);
    });

    // Stale CHANNEL_ERROR from the prior channel's subscribe callback
    // arriving after the visibility-driven teardown — early-return
    // guard suppresses captureMessage and pollFallback flip.
    await act(async () => {
      subscribeCallback("CHANNEL_ERROR");
    });

    expect(captureMessageMock).not.toHaveBeenCalled();
    // pollFallback never flipped, so the polling fallback never
    // started — useSetlistPolling's mount-time fetch is the only
    // fetch we'd see, and only the initial seed fetch ran.
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not schedule a duplicate recovery timer when CHANNEL_ERROR fires twice in a row (CR guard)", async () => {
    renderHook(() =>
      useRealtimeEventChannel({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
        startTime: null,
      }),
    );
    await flushMicrotasks();

    // Two CHANNEL_ERRORs in rapid succession — without the
    // `pendingRecoveryTimeoutRef.current === null` guard the second
    // would have scheduled a second timer (CodeRabbit feedback on
    // PR #450).
    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
      capturedSubscribeCallback!("CHANNEL_ERROR");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECOVERY_DELAY_MS);
    });
    await flushMicrotasks();

    // Channel re-subscribed exactly once (initial + one recovery
    // attempt). A duplicate timer would have produced 3+ calls.
    expect(channelMock).toHaveBeenCalledTimes(2);
  });

  it("visibility resume from pollFallback=true resets the budget and re-attempts realtime", async () => {
    renderHook(() =>
      useRealtimeEventChannel({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
        startTime: null,
      }),
    );
    await flushMicrotasks();

    // Burn the full budget while visible.
    for (let i = 0; i < MAX_RECOVERY_ATTEMPTS; i++) {
      await act(async () => {
        capturedSubscribeCallback!("CHANNEL_ERROR");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(RECOVERY_DELAY_MS);
      });
      await flushMicrotasks();
    }
    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
    });
    const channelCallsAfterBudgetGone = channelMock.mock.calls.length;

    // Hide + show — budget reset, fallback cleared, channel re-subscribes.
    await act(async () => {
      setDocumentHidden(true);
    });
    await act(async () => {
      setDocumentHidden(false);
    });
    await flushMicrotasks();

    expect(channelMock.mock.calls.length).toBeGreaterThan(
      channelCallsAfterBudgetGone,
    );
  });
});

// ────────────────────────────────────────────────────────────────────
// Snapshot freshness — bounded retries, fetch deadline, indicator state
//
// Before: `if (!res.ok) return;` and a silent catch, so one failed
// snapshot during a quiet stretch left the page stale until some
// unrelated push. Now failures retry on 1/2/4/8/15/30 s (±20 %),
// honour Retry-After, never flip to R3 polling, and surface as
// `freshness` (live → retrying → delayed → live).
//
// Math.random is pinned to 0.5 (zero jitter) so retry instants are
// exact; the jitter bounds themselves are covered in
// snapshotFreshness.test.ts.
// ────────────────────────────────────────────────────────────────────

function makeErrorResponse(status = 503, retryAfter?: string) {
  return {
    ok: false,
    status,
    headers: new Headers(retryAfter ? { "Retry-After": retryAfter } : {}),
    json: async () => ({}),
  };
}

// A fetch that never settles on its own — only rejects when its signal
// aborts (supersede, cleanup, or the 8 s deadline), like a hung socket.
function hangingFetch(_url: string, init?: RequestInit) {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("aborted", "AbortError")),
    );
  });
}

describe("useRealtimeEventChannel — snapshot freshness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    capturedSubscribeCallback = null;
    addBreadcrumbMock.mockClear();
    captureMessageMock.mockClear();
    channelMock.mockClear();
    removeChannelMock.mockClear();
    fakeChannel.on.mockClear();
    fakeChannel.subscribe.mockClear();
    capturedPostgresHandlers.length = 0;
    fakeChannel.on.mockImplementation(
      (
        _event: string,
        config: { table?: string; event?: string },
        handler: (payload: unknown) => void,
      ) => {
        capturedPostgresHandlers.push({ config, handler });
        return fakeChannel;
      },
    );
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
  });

  function mount(eventId = "1") {
    return renderHook(
      ({ id }: { id: string }) =>
        useRealtimeEventChannel({
          eventId: id,
          initialItems,
          initialReactionCounts,
          initialTop3Wishes,
          locale: "ko",
          enabled: true,
          startTime: null,
        }),
      { initialProps: { id: eventId } },
    );
  }

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("retries a failing snapshot at 1/2/4/8/15/30 s, then every 30 s", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeErrorResponse());
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    mount();
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1); // seed

    const steps = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 30_000, 30_000];
    for (const [i, step] of steps.entries()) {
      await advance(step - 1);
      expect(fetchMock).toHaveBeenCalledTimes(i + 1);
      await advance(1);
      expect(fetchMock).toHaveBeenCalledTimes(i + 2);
    }
  });

  it("does NOT flip to R3 polling on snapshot failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeErrorResponse()) as unknown as typeof fetch,
    );
    mount();
    await flushMicrotasks();
    await advance(60_000);
    // Channel never torn down → pollFallback never flipped.
    expect(removeChannelMock).not.toHaveBeenCalled();
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it("walks freshness live → retrying → delayed → live, and success resets the schedule", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse()) // seed OK
      .mockResolvedValueOnce(makeErrorResponse()) // push refetch fails
      .mockResolvedValueOnce(makeErrorResponse()) // +1 s
      .mockResolvedValueOnce(makeErrorResponse()) // +2 s
      .mockResolvedValueOnce(makeFetchResponse()) // +4 s recovers
      .mockResolvedValue(makeErrorResponse());
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result } = mount();
    await flushMicrotasks();

    expect(result.current.freshness.state).toBe("live");
    const firstSync = result.current.freshness.lastSyncAt;
    expect(firstSync).toBeInstanceOf(Date);

    // A SetlistItem push for this event triggers a refetch (after the
    // 250 ms jitter Math.random = 0.5 yields) that fails.
    const setlistHandler = capturedPostgresHandlers.find(
      (h) => h.config.table === "SetlistItem",
    )!.handler;
    await act(async () => {
      setlistHandler({ new: { eventId: 1 } });
    });
    await advance(250);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.freshness.state).toBe("retrying");
    // A failure keeps the last good sync time on display.
    expect(result.current.freshness.lastSyncAt).toBe(firstSync);

    await advance(1_000);
    expect(result.current.freshness.state).toBe("retrying");
    await advance(2_000);
    expect(result.current.freshness.state).toBe("delayed");

    await advance(4_000);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(result.current.freshness.state).toBe("live");
    expect(result.current.freshness.lastSyncAt).not.toBe(firstSync);

    // Next failure starts the schedule over at 1 s, not 8 s.
    await act(async () => {
      setlistHandler({ new: { eventId: 1 } });
    });
    await advance(250);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(result.current.freshness.state).toBe("retrying");
    await advance(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it("honours Retry-After over the schedule", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeErrorResponse(503, "5"))
      .mockResolvedValue(makeFetchResponse());
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result } = mount();
    await flushMicrotasks();

    await advance(4_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.freshness.state).toBe("live");
  });

  it("aborts a hung snapshot at the 8 s deadline and retries", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(hangingFetch)
      .mockResolvedValue(makeFetchResponse());
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result } = mount();
    await flushMicrotasks();

    await advance(7_999);
    expect(result.current.freshness.state).toBe("live");
    expect(result.current.freshness.lastSyncAt).toBeNull();
    await advance(1);
    const seedSignal = fetchMock.mock.calls[0][1]?.signal as AbortSignal;
    expect(seedSignal.aborted).toBe(true);
    expect(result.current.freshness.state).toBe("retrying");

    await advance(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.freshness.state).toBe("live");
    expect(result.current.freshness.lastSyncAt).toBeInstanceOf(Date);
  });

  it("an abort from unmount never schedules a retry", async () => {
    const fetchMock = vi.fn(hangingFetch);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { unmount } = mount();
    await flushMicrotasks();
    unmount();
    await advance(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a pending retry is cancelled when the tab hides (no retries while hidden)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeErrorResponse());
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    mount();
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      setDocumentHidden(true);
    });
    await advance(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("channel fallback reports delayed until polling syncs, then polling's freshness", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse());
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result } = mount();
    await flushMicrotasks();
    expect(result.current.freshness.state).toBe("live");
    const realtimeSync = result.current.freshness.lastSyncAt;

    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
    });
    expect(result.current.freshness.state).toBe("delayed");
    // Last good realtime sync stays visible underneath the warning.
    expect(result.current.freshness.lastSyncAt).toBe(realtimeSync);

    // First 5 s poll lands → polling is driving, honestly "live".
    await advance(5_000);
    expect(result.current.freshness.state).toBe("live");
    expect(result.current.freshness.lastSyncAt).not.toBe(realtimeSync);
  });
});

// ────────────────────────────────────────────────────────────────────
// n14 R1 — scheduler, acceptance, minRev, periodic repair poll
//
// The abort-and-refire supersede is gone: one request in flight per
// client plus at most one dirty follow-up, jittered notifications with
// a 1 s cooldown, a 20 s ± 4 s repair poll while visible, and an
// `(rev, capturedAt)` acceptance rule. Math.random = 0.5 → 250 ms
// notification jitter and exact 20 s periodic ticks.
// ────────────────────────────────────────────────────────────────────

function revResponse(rev: number, capturedAt: string, items: unknown[] = []) {
  return {
    ok: true,
    json: async () => ({
      items,
      reactionCounts: {},
      top3Wishes: [],
      status: "ongoing",
      rev,
      capturedAt,
      servedAt: capturedAt,
    }),
  };
}

describe("useRealtimeEventChannel — n14 scheduler + acceptance", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    capturedSubscribeCallback = null;
    addBreadcrumbMock.mockClear();
    captureMessageMock.mockClear();
    channelMock.mockClear();
    removeChannelMock.mockClear();
    fakeChannel.on.mockClear();
    fakeChannel.subscribe.mockClear();
    capturedPostgresHandlers.length = 0;
    fakeChannel.on.mockImplementation(
      (
        _event: string,
        config: { table?: string; event?: string },
        handler: (payload: unknown) => void,
      ) => {
        capturedPostgresHandlers.push({ config, handler });
        return fakeChannel;
      },
    );
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete window.__osl;
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
  });

  function mount(
    extra: { initialRev?: number | null; initialCapturedAt?: string | null } = {},
  ) {
    return renderHook(() =>
      useRealtimeEventChannel({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
        startTime: null,
        ...extra,
      }),
    );
  }

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  function setlistHandler() {
    return capturedPostgresHandlers.find((h) => h.config.table === "SetlistItem")!
      .handler;
  }

  // Each request takes `ms` to answer — long enough for notifications
  // to land while it is in flight.
  function slowFetch(ms: number) {
    return vi.fn(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(makeFetchResponse()), ms);
        }),
    );
  }

  it("a notification while a request is in flight → exactly one more request after it settles", async () => {
    const fetchMock = slowFetch(300);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    mount();
    await advance(300); // seed settles
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const push = setlistHandler();
    await act(async () => {
      push({ new: { eventId: 1 } });
    });
    await advance(250); // jitter → request #2 starts (in flight 300 ms)
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      push({ new: { eventId: 1 } });
      push({ new: { eventId: 1 } });
      push({ new: { eventId: 1 } });
    });
    await advance(5_000);
    // Three in-flight notifications collapse into ONE follow-up.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("two notifications within 1 s → two requests total, not three", async () => {
    const fetchMock = slowFetch(300);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    mount();
    await advance(300);
    const baseline = fetchMock.mock.calls.length;

    const push = setlistHandler();
    await act(async () => {
      push({ new: { eventId: 1 } }); // → request at +250
    });
    await advance(400); // second push lands mid-flight
    await act(async () => {
      push({ new: { eventId: 1 } });
    });
    await advance(5_000);
    expect(fetchMock.mock.calls.length - baseline).toBe(2);
  });

  it("the follow-up after a notification waits out the 1 s cooldown", async () => {
    const fetchMock = slowFetch(100);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    mount();
    await advance(100);

    const push = setlistHandler();
    await act(async () => {
      push({ new: { eventId: 1 } });
    });
    await advance(250); // request #2 starts at t0 + 250
    await act(async () => {
      push({ new: { eventId: 1 } }); // dirty
    });
    await advance(100); // #2 settles at +350
    // Follow-up eligible at +1250 (cooldown from #2's start).
    await advance(899);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("polls every 20 s while visible (healthy path) and never while hidden", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse());
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result } = mount();
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstSync = result.current.freshness.lastSyncAt;

    await advance(19_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // lastSyncAt advances on periodic fetches too.
    expect(result.current.freshness.lastSyncAt).not.toBe(firstSync);
    await advance(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      setDocumentHidden(true);
    });
    await advance(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Resume: immediate gap-fill, then the cadence restarts.
    await act(async () => {
      setDocumentHidden(false);
    });
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await advance(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("an `online` event fetches immediately", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse());
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    mount();
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends ?minRev= with the highest server-observed revision, and no `cache: no-store`", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(revResponse(7, "2026-11-14T07:30:00.000Z"))
      .mockResolvedValue(revResponse(7, "2026-11-14T07:30:05.000Z"));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    mount({ initialRev: 4, initialCapturedAt: "2026-11-14T07:29:00.000Z" });
    await flushMicrotasks();

    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/setlist?eventId=1&locale=ko&minRev=4",
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init).not.toHaveProperty("cache");

    await advance(20_000);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/setlist?eventId=1&locale=ko&minRev=7",
    );
  });

  it("a notification request carries minRev = appliedRev + 1; periodic / catch-up carry the applied rev", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(revResponse(7, "2026-11-14T07:30:00.000Z"));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result } = mount({ initialRev: 7, initialCapturedAt: "2026-11-14T07:29:00.000Z" });
    await flushMicrotasks();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/setlist?eventId=1&locale=ko&minRev=7",
    );

    await act(async () => {
      setlistHandler()({ new: { eventId: 1 } });
    });
    await advance(250);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/setlist?eventId=1&locale=ko&minRev=8",
    );
    // The server answered rev 7 (DB not ahead / purge not visible yet):
    // a normal healthy response — no retry, nothing "delayed".
    expect(result.current.freshness.state).toBe("live");
    expect(result.current.rev).toBe(7);
    await advance(19_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The hint was single-use: periodic and catch-up go back to 7.
    await advance(750); // periodic at 20 s
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toBe(
      "/api/setlist?eventId=1&locale=ko&minRev=7",
    );
    await act(async () => {
      capturedSubscribeCallback!("SUBSCRIBED");
    });
    await flushMicrotasks();
    expect(fetchMock.mock.calls[3][0]).toBe(
      "/api/setlist?eventId=1&locale=ko&minRev=7",
    );
    expect(result.current.freshness.state).toBe("live");
  });

  it("repeated hint misses never escalate to retrying / delayed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(revResponse(3, "2026-11-14T07:30:00.000Z"));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result } = mount({ initialRev: 3, initialCapturedAt: "2026-11-14T07:29:00.000Z" });
    await flushMicrotasks();
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        setlistHandler()({ new: { eventId: 1 } });
      });
      await advance(1_000);
      expect(result.current.freshness.state).toBe("live");
    }
    // 1 seed + 5 notification requests, every one hinted at 4, no retries.
    expect(fetchMock).toHaveBeenCalledTimes(6);
    for (const call of fetchMock.mock.calls.slice(1)) {
      expect(call[0]).toBe("/api/setlist?eventId=1&locale=ko&minRev=4");
    }
  });

  it("omits minRev when no revision is known yet", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse());
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    mount();
    await flushMicrotasks();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/setlist?eventId=1&locale=ko");
  });

  it("exposes rev/capturedAt; an older-rev response is not applied and counts as a soft failure", async () => {
    const newer = [{ id: 1 }];
    const older = [{ id: "stale" }];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(revResponse(5, "2026-11-14T07:30:00.000Z", newer))
      .mockResolvedValueOnce(revResponse(4, "2026-11-14T07:30:10.000Z", older))
      .mockResolvedValue(revResponse(5, "2026-11-14T07:30:20.000Z", newer));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result } = mount({
      initialRev: 3,
      initialCapturedAt: "2026-11-14T07:29:00.000Z",
    });
    // SSR seed is exposed before the first fetch lands.
    expect(result.current.rev).toBe(3);
    expect(result.current.capturedAt).toBe("2026-11-14T07:29:00.000Z");
    await flushMicrotasks();
    expect(result.current.rev).toBe(5);
    expect(result.current.capturedAt).toBe("2026-11-14T07:30:00.000Z");
    expect(result.current.items).toBe(newer);

    await advance(20_000); // periodic → rev 4: a stale cache somewhere
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.items).toBe(newer);
    expect(result.current.rev).toBe(5);
    // Server-proven gap → n13 retry path (silent "retrying" first).
    expect(result.current.freshness.state).toBe("retrying");

    await advance(1_000); // retry → rev 5 again (later capturedAt)
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.freshness.state).toBe("live");
    expect(result.current.capturedAt).toBe("2026-11-14T07:30:20.000Z");
  });

  it("an SSR-seeded page is not rolled back by an older first response", async () => {
    const ssrItems = [{ id: "ssr" }];
    const fetchMock = vi
      .fn()
      .mockResolvedValue(revResponse(2, "2026-11-14T07:31:00.000Z", []));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result } = renderHook(() =>
      useRealtimeEventChannel({
        eventId: "1",
        initialItems: ssrItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
        startTime: null,
        initialRev: 3,
        initialCapturedAt: "2026-11-14T07:30:00.000Z",
      }),
    );
    await flushMicrotasks();
    expect(result.current.items).toBe(ssrItems);
    expect(result.current.lastUpdated).toBeNull();
  });

  it("v0.18.x-shaped responses (no rev/capturedAt) still apply (compat)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{ id: "compat" }],
        reactionCounts: { "1": { best: 2 } },
        top3Wishes: [],
        status: "ongoing",
        updatedAt: "2026-05-09T12:00:00Z",
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result } = mount({
      initialRev: 9,
      initialCapturedAt: "2026-11-14T07:30:00.000Z",
    });
    await flushMicrotasks();
    expect(result.current.items).toEqual([{ id: "compat" }]);
    expect(result.current.reactionCounts).toEqual({ "1": { best: 2 } });
    expect(result.current.lastUpdated).toBe("2026-05-09T12:00:00Z");
    // Watermark untouched by a compat response.
    expect(result.current.rev).toBe(9);
    expect(result.current.freshness.state).toBe("live");
  });

  it("__osl.dropNextNotification ignores exactly one notification and clears the flag", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse());
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    mount();
    await flushMicrotasks();
    const push = setlistHandler();

    window.__osl = { dropNextNotification: true };
    await act(async () => {
      push({ new: { eventId: 1 } });
    });
    await advance(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(window.__osl.dropNextNotification).toBe(false);
    expect(addBreadcrumbMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("dropNextNotification"),
      }),
    );

    await act(async () => {
      push({ new: { eventId: 1 } });
    });
    await advance(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a cross-event push does not consume the drop flag", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFetchResponse()) as unknown as typeof fetch,
    );
    mount();
    await flushMicrotasks();
    window.__osl = { dropNextNotification: true };
    await act(async () => {
      setlistHandler()({ new: { eventId: 99 } });
    });
    expect(window.__osl.dropNextNotification).toBe(true);
  });
});
