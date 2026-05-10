import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Flush a microtask so an awaited Promise inside `useEffect` (the
// snapshot fetch) settles before the next assertion. We can't use
// `waitFor` from RTL — it polls with real setTimeout, which is faked
// in this suite — so this is the manual equivalent.
async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

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

const fakeChannel = {
  on: vi.fn().mockReturnThis(),
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
import type { FanTop3Entry } from "@/lib/types/setlist";

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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFetchResponse()) as unknown as typeof fetch,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
      }),
    );

    expect(capturedSubscribeCallback).not.toBeNull();

    await act(async () => {
      capturedSubscribeCallback!("TIMED_OUT");
    });

    expect(removeChannelMock).toHaveBeenCalledTimes(1);
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

  it("refetches the snapshot on reconnect SUBSCRIBED (not on the initial one)", async () => {
    renderHook(() =>
      useRealtimeEventChannel({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
      }),
    );

    // Mount-time fetch was kicked off inside the useEffect; flush
    // microtasks to let the Promise chain settle.
    await flushMicrotasks();
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // First SUBSCRIBED — the initial channel join. Should NOT trigger
    // a refetch (the mount-time fetch already seeded state).
    await act(async () => {
      capturedSubscribeCallback!("SUBSCRIBED");
    });
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second SUBSCRIBED — supabase-js auto-rejoined after a transient
    // socket drop. We may have missed pushes during the gap; refetch.
    await act(async () => {
      capturedSubscribeCallback!("SUBSCRIBED");
    });
    await flushMicrotasks();
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
      }),
    );

    expect(channelMock).not.toHaveBeenCalled();
    expect(capturedSubscribeCallback).toBeNull();
  });
});
