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

// Captured `.on(type, filter, handler)` registrations, so a test can
// deliver a broadcast exactly as realtime-js does and assert what the
// hook subscribed to.
const capturedHandlers: Array<{
  type: string;
  config: { table?: string; event?: string };
  handler: (payload: unknown) => void;
}> = [];

function captureOn(
  type: string,
  config: { table?: string; event?: string },
  handler: (payload: unknown) => void,
) {
  capturedHandlers.push({ type, config, handler });
  return fakeChannel;
}

/** Deliver one `rev` broadcast message (realtime-js message shape). */
function sendRev(payload: unknown) {
  const entry = capturedHandlers.find(
    (h) => h.type === "broadcast" && h.config.event === "rev",
  );
  if (!entry) throw new Error("no rev broadcast handler registered");
  entry.handler({ type: "broadcast", event: "rev", payload });
}

const fakeChannel = {
  on: vi.fn(captureOn),
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
  HEALTHY_BUDGET_RESET_MS,
  MAX_RECREATE_ATTEMPTS,
  REJOIN_GRACE_MS,
  recreateBackoffMs,
} from "@/lib/realtimeRecovery";
import { ONGOING_BUFFER_MS } from "@/lib/eventStatus";
import {
  CATCHUP_JITTER_MS,
  NOTIFICATION_COOLDOWN_MS,
} from "@/lib/liveScheduler";
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
    capturedHandlers.length = 0;
    fakeChannel.on.mockImplementation(captureOn);
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

  // Recovery ownership: a CHANNEL_ERROR / TIMED_OUT is realtime-js
  // telling us it is reconnecting, not that the channel is dead. The
  // hook keeps the channel (removing it would cancel the rejoin) and
  // polls at the fallback cadence until SUBSCRIBED comes back.
  it("starts when SSR enters LIVE and releases the channel when the snapshot ends it", async () => {
    const { result, rerender } = renderHook(({ enabled }) =>
      useRealtimeEventChannel({
        eventId: "1", initialItems, initialReactionCounts, initialTop3Wishes,
        locale: "ko", enabled, startTime: null,
      }), { initialProps: { enabled: false } },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(channelMock).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await flushMicrotasks();
    expect(channelMock).toHaveBeenCalledTimes(1);
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      items: [], reactionCounts: {}, top3Wishes: [], status: "completed",
    })));
    await act(async () => { await vi.advanceTimersByTimeAsync(25_000); });
    expect(result.current.status).toBe("completed");
    expect(removeChannelMock).toHaveBeenCalledTimes(1);
    const count = vi.mocked(fetch).mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(fetch).toHaveBeenCalledTimes(count);
  });

  it("waits without LIVE or polling after postponement, then reconnects at the revised start", async () => {
    vi.setSystemTime(new Date("2026-10-24T08:00:00Z"));
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const delayedStart = "2026-10-24T08:02:00Z";
    const { result } = renderHook(() => useRealtimeEventChannel({
      eventId: "1", initialItems, initialReactionCounts, initialTop3Wishes,
      locale: "ko", enabled: true, startTime: "2026-10-24T07:59:00Z",
    }));
    await flushMicrotasks();
    expect(result.current.status).toBe("ongoing");
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      items: [], status: "upcoming", startTime: delayedStart,
    })));
    await act(async () => { await vi.advanceTimersByTimeAsync(21_000); });
    expect(result.current.status).toBe("upcoming");
    expect(removeChannelMock).toHaveBeenCalledTimes(1);
    const reads = vi.mocked(fetch).mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(98_000); });
    expect(fetch).toHaveBeenCalledTimes(reads);
    expect(channelMock).toHaveBeenCalledTimes(1);
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({
      items: [], status: "ongoing", startTime: delayedStart,
    })));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(result.current.status).toBe("ongoing");
    expect(channelMock).toHaveBeenCalledTimes(2);
  });

  it("replaces a postponed boundary, catches up after hiding, and cancels on unmount", async () => {
    vi.setSystemTime(new Date("2026-10-24T08:00:00Z"));
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    let nextStart = "2026-10-24T08:01:00Z";
    let nextStatus = "upcoming";
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({
      items: [], status: nextStatus, startTime: nextStart,
    })));
    const { result, unmount } = renderHook(() => useRealtimeEventChannel({
      eventId: "1", initialItems, initialReactionCounts, initialTop3Wishes,
      locale: "ko", enabled: true, startTime: "2026-10-24T07:59:00Z",
    }));
    await flushMicrotasks();
    nextStart = "2026-10-24T08:02:00Z";
    await act(async () => { await vi.advanceTimersByTimeAsync(64_000); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(channelMock).toHaveBeenCalledTimes(1);
    act(() => setDocumentHidden(true));
    nextStatus = "ongoing";
    await act(async () => { await vi.advanceTimersByTimeAsync(65_000); });
    expect(fetch).toHaveBeenCalledTimes(2);
    act(() => setDocumentHidden(false));
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(result.current.status).toBe("ongoing");
    expect(channelMock).toHaveBeenCalledTimes(2);
    nextStatus = "upcoming";
    nextStart = "2026-10-24T08:05:00Z";
    await act(async () => { await vi.advanceTimersByTimeAsync(25_000); });
    expect(result.current.status).toBe("upcoming");
    const reads = vi.mocked(fetch).mock.calls.length;
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
    expect(fetch).toHaveBeenCalledTimes(reads);
  });

  it("uses server time and rearms when the boundary still reports the same upcoming start", async () => {
    // This browser is an hour fast; the timer must use the server's remaining wait.
    vi.setSystemTime(new Date("2026-10-24T09:00:00Z"));
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const start = "2026-10-24T08:01:00Z";
    let servedAt = "2026-10-24T08:00:00Z";
    let status = "upcoming";
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({
      items: [], status, startTime: start, servedAt,
    })));
    const { result } = renderHook(() => useRealtimeEventChannel({
      eventId: "1", initialItems, initialReactionCounts, initialTop3Wishes,
      locale: "ko", enabled: true, startTime: "2026-10-24T07:59:00Z",
    }));
    await flushMicrotasks();
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    expect(fetch).toHaveBeenCalledTimes(1);
    // A corrected server clock can leave the same advertised start in the future.
    servedAt = "2026-10-24T08:00:55Z";
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("upcoming");
    expect(channelMock).toHaveBeenCalledTimes(1);
    status = "ongoing";
    servedAt = "2026-10-24T08:01:03Z";
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    expect(result.current.status).toBe("ongoing");
    expect(channelMock).toHaveBeenCalledTimes(2);
  });

  it("on CHANNEL_ERROR keeps the channel and polls at the 5 s fallback cadence", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
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
    await flushMicrotasks();
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1); // seed

    // Channel was set up; subscribe callback captured.
    expect(capturedSubscribeCallback).not.toBeNull();
    expect(channelMock).toHaveBeenCalledWith("event:1");

    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
    });

    // The channel is NOT torn down — realtime-js's own rejoin owns it.
    expect(removeChannelMock).not.toHaveBeenCalled();
    expect(channelMock).toHaveBeenCalledTimes(1);

    // Polling while disconnected: first tick at a random phase
    // (U(0, 5 s) = 2.5 s here), then every 5 s ± 1 s (exact 5 s here).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_499);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.current.lastUpdated).toBeTruthy();
    expect(removeChannelMock).not.toHaveBeenCalled();
  });

  it("on TIMED_OUT keeps the channel and polls too", async () => {
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

    await act(async () => {
      capturedSubscribeCallback!("TIMED_OUT");
      await vi.advanceTimersByTimeAsync(2_500);
    });
    expect(removeChannelMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("SUBSCRIBED after a gap → one jittered catch-up, then back to the 20 s cadence", async () => {
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
    await act(async () => {
      capturedSubscribeCallback!("SUBSCRIBED");
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Socket drops; realtime-js rejoins after ~1 s (its first backoff
    // step). One fallback poll may or may not land in the gap.
    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
      await vi.advanceTimersByTimeAsync(1_000);
    });
    const beforeRejoin = fetchMock.mock.calls.length;
    await act(async () => {
      capturedSubscribeCallback!("SUBSCRIBED");
    });
    // Catch-up is jittered (250 ms here), not immediate.
    expect(fetchMock).toHaveBeenCalledTimes(beforeRejoin);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(fetchMock).toHaveBeenCalledTimes(beforeRejoin + 1);

    // Healthy again: no 5 s polls, the next request is the 20 s tick.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(19_749);
    });
    expect(fetchMock).toHaveBeenCalledTimes(beforeRejoin + 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(beforeRejoin + 2);
    // The same channel object recovered — nothing was removed or re-made.
    expect(channelMock).toHaveBeenCalledTimes(1);
    expect(removeChannelMock).not.toHaveBeenCalled();
  });

  it("repeated realtime-js retries while disconnected add no breadcrumbs (one per transition)", async () => {
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
      capturedSubscribeCallback!("CHANNEL_ERROR");
      // realtime-js reports each failed rejoin again.
      capturedSubscribeCallback!("TIMED_OUT");
      capturedSubscribeCallback!("CHANNEL_ERROR");
      capturedSubscribeCallback!("TIMED_OUT");
    });
    const statusCrumbs = addBreadcrumbMock.mock.calls
      .map(([arg]) => arg.message as string)
      .filter((m) => m.includes("channel status →"));
    expect(statusCrumbs).toHaveLength(2); // → SUBSCRIBED, → CHANNEL_ERROR
  });

  // R1 subscribed to postgres_changes on SetlistItem without a
  // server-side filter and scope-checked every row's eventId. R2's topic
  // is per event, so the remaining guard is payload validation: the
  // public channel accepts anyone's message.
  it("validates broadcast payloads; duplicates and already-applied revisions do no work", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(revResponse(3, "2026-11-14T07:30:00.000Z"));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    renderHook(() =>
      useRealtimeEventChannel({
        eventId: "5",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
        startTime: null,
        initialRev: 3,
        initialCapturedAt: "2026-11-14T07:29:00.000Z",
      }),
    );
    expect(channelMock).toHaveBeenCalledWith("event:5");

    await act(async () => {
      capturedSubscribeCallback!("SUBSCRIBED");
      await flushMicrotasks();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    const baseline = fetchMock.mock.calls.length;

    const deliver = async (payload: unknown) => {
      await act(async () => {
        sendRev(payload);
        await vi.advanceTimersByTimeAsync(1_000);
      });
    };

    for (const bad of [
      { kind: "reaction", rev: 9 },
      { rev: 9 },
      { kind: "setlist", rev: "9" },
      { kind: "setlist", rev: -1 },
      { kind: "setlist", rev: 1.5 },
      { kind: "setlist", rev: 2 ** 60 },
      { kind: "setlist" },
      null,
      "rev 9",
      42,
    ]) {
      await deliver(bad);
    }
    expect(fetchMock.mock.calls.length).toBe(baseline);

    // Already applied (the echo of a save this page fetched) or older.
    await deliver({ kind: "setlist", rev: 3 });
    await deliver({ kind: "setlist", rev: 2 });
    expect(fetchMock.mock.calls.length).toBe(baseline);

    // A valid, newer revision: exactly one notification fetch.
    fetchMock.mockResolvedValue(revResponse(4, "2026-11-14T07:31:00.000Z"));
    await deliver({ kind: "setlist", rev: 4 });
    expect(fetchMock.mock.calls.length).toBe(baseline + 1);
    expect(fetchMock.mock.calls[baseline][0]).toBe(
      "/api/setlist?eventId=5&locale=ko&minRev=4&hint=1",
    );
    // …and its echo afterwards is a duplicate.
    await deliver({ kind: "setlist", rev: 4 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(fetchMock.mock.calls.length).toBe(baseline + 1);
  });

  it("subscribes to the `rev` broadcast only — no postgres_changes (R2)", () => {
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
    expect(capturedHandlers.map((h) => [h.type, h.config.event])).toEqual([
      ["broadcast", "rev"],
    ]);
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
    // microtasks to let the Promise chain settle. The page-load seed is
    // immediate (not a correlated trigger).
    await flushMicrotasks();
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // First SUBSCRIBED — the initial channel join. Exactly ONE
    // catch-up fetch: the seed ran before the channel was live, so a
    // write committed in between would otherwise be missed. Jittered
    // by U(0, CATCHUP_JITTER_MS): a mass rejoin lands together.
    await act(async () => {
      capturedSubscribeCallback!("SUBSCRIBED");
    });
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CATCHUP_JITTER_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Second SUBSCRIBED — supabase-js auto-rejoined after a transient
    // socket drop. We may have missed pushes during the gap; refetch
    // (after the 1 s per-client cooldown at the latest).
    await act(async () => {
      capturedSubscribeCallback!("SUBSCRIBED");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        NOTIFICATION_COOLDOWN_MS + CATCHUP_JITTER_MS,
      );
    });
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
  // Realtime, the endpoint is refetched on push and by the repair poll,
  // so a startTime crossing in a no-activity window
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
    // Boundary at 32 s; every viewer's timer fires together, so the
    // request is jittered like a catch-up (U(0, 500) = 250 here).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(349);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
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
    // + 250 ms boundary jitter (Math.random = 0.5).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
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
    // broadcast test added to this block isn't flaky. The R3.5 tests
    // below don't read capturedHandlers today, but the beforeEach
    // blocks should stay symmetric.
    capturedHandlers.length = 0;
    fakeChannel.on.mockImplementation(captureOn);
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
    // 250 ms catch-up / resume jitter.
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
    // Mount-time seed fetch.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // First SUBSCRIBED — initial join catch-up.
    await act(async () => {
      capturedSubscribeCallback!("SUBSCRIBED");
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Hide + show — fresh channel set up; the re-run effect seeds a
    // snapshot (gap-fill for the away window) after the resume jitter.
    await act(async () => {
      setDocumentHidden(true);
    });
    await act(async () => {
      setDocumentHidden(false);
    });
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Post-resume SUBSCRIBED — same catch-up as an initial join
    // (closes the resume-seed → subscribe window); it waits for the
    // 1 s per-client cooldown measured from the resume seed.
    await act(async () => {
      capturedSubscribeCallback!("SUBSCRIBED");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
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

  // Re-creation is the last resort for SUSTAINED failure: no
  // SUBSCRIBED within REJOIN_GRACE_MS + a randomized backoff
  // (Math.random = 0.5 → attempt 1 backoff = 10 s).
  it("re-creates the channel only after sustained failure (grace + randomized backoff)", async () => {
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

    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
    });
    const backoff1 = recreateBackoffMs(1, () => 0.5);
    expect(backoff1).toBe(10_000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REJOIN_GRACE_MS + backoff1 - 1);
    });
    expect(removeChannelMock).not.toHaveBeenCalled();
    expect(channelMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await flushMicrotasks();
    // Old channel removed (stops its rejoin), a new one subscribed.
    expect(removeChannelMock).toHaveBeenCalledTimes(1);
    expect(channelMock).toHaveBeenCalledTimes(2);
    expect(fakeChannel.subscribe).toHaveBeenCalledTimes(2);
    expect(addBreadcrumbMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("re-creating channel (attempt 1/"),
      }),
    );
  });

  it("a rejoin inside the grace window cancels re-creation", async () => {
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
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await act(async () => {
      capturedSubscribeCallback!("SUBSCRIBED");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(channelMock).toHaveBeenCalledTimes(1);
    expect(removeChannelMock).not.toHaveBeenCalled();
  });

  it("a late status from a removed (re-created) channel is ignored", async () => {
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
    const oldCallback = capturedSubscribeCallback!;
    await act(async () => {
      oldCallback("CHANNEL_ERROR");
      await vi.advanceTimersByTimeAsync(REJOIN_GRACE_MS + 10_000);
    });
    await flushMicrotasks();
    expect(channelMock).toHaveBeenCalledTimes(2);
    const newCallback = capturedSubscribeCallback!;
    expect(newCallback).not.toBe(oldCallback);

    // The new channel joins; then the OLD one reports CLOSED (its leave
    // completing) and a stale CHANNEL_ERROR. Neither may knock the
    // healthy new channel back into polling.
    await act(async () => {
      newCallback("SUBSCRIBED");
      oldCallback("CLOSED");
      oldCallback("CHANNEL_ERROR");
    });
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const before = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    // Healthy cadence: only the jittered catch-up, no 5 s polls.
    expect(fetchMock.mock.calls.length - before).toBe(1);
  });

  it("an unexpected CLOSED on the current channel is treated as a failure", async () => {
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
    await act(async () => {
      capturedSubscribeCallback!("SUBSCRIBED");
      capturedSubscribeCallback!("CLOSED"); // server closed it
    });
    // realtime-js never rejoins a closed channel → the hook re-creates
    // it after the grace window.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REJOIN_GRACE_MS + 10_000);
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
      await vi.advanceTimersByTimeAsync(REJOIN_GRACE_MS * 3);
    });
    expect(channelMock.mock.calls.length).toBe(channelCallsBefore);
  });

  it("stops re-creating after MAX_RECREATE_ATTEMPTS but keeps polling and the last channel", async () => {
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
    // Never SUBSCRIBED again: each window is ≤ grace + 60 s.
    for (let i = 0; i < MAX_RECREATE_ATTEMPTS + 2; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(REJOIN_GRACE_MS + 60_000);
      });
      await flushMicrotasks();
    }
    expect(channelMock).toHaveBeenCalledTimes(1 + MAX_RECREATE_ATTEMPTS);
    expect(removeChannelMock).toHaveBeenCalledTimes(MAX_RECREATE_ATTEMPTS);
    const exhausted = addBreadcrumbMock.mock.calls.filter(([arg]) =>
      String(arg.message).includes("budget exhausted"),
    );
    expect(exhausted).toHaveLength(1);

    // Still polling at the fallback cadence (≥ 1 request per 6 s).
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const before = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock.mock.calls.length - before).toBeGreaterThanOrEqual(10);

    // …and the kept channel can still come back on its own.
    await act(async () => {
      capturedSubscribeCallback!("SUBSCRIBED");
    });
    const afterRejoin = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(fetchMock.mock.calls.length - afterRejoin).toBe(1); // catch-up only
  });

  it("the re-creation budget is refunded after HEALTHY_BUDGET_RESET_MS of continuous health", async () => {
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

    const burnBudget = async () => {
      await act(async () => {
        capturedSubscribeCallback!("CHANNEL_ERROR");
      });
      for (let i = 0; i < MAX_RECREATE_ATTEMPTS + 1; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(REJOIN_GRACE_MS + 60_000);
        });
        await flushMicrotasks();
      }
    };
    await burnBudget();
    expect(channelMock).toHaveBeenCalledTimes(1 + MAX_RECREATE_ATTEMPTS);

    // Healthy, but not for long enough: no refund.
    await act(async () => {
      capturedSubscribeCallback!("SUBSCRIBED");
      await vi.advanceTimersByTimeAsync(HEALTHY_BUDGET_RESET_MS - 1_000);
    });
    await burnBudget();
    expect(channelMock).toHaveBeenCalledTimes(1 + MAX_RECREATE_ATTEMPTS);

    // Five healthy minutes: the budget is back.
    await act(async () => {
      capturedSubscribeCallback!("SUBSCRIBED");
      await vi.advanceTimersByTimeAsync(HEALTHY_BUDGET_RESET_MS);
    });
    await burnBudget();
    expect(channelMock).toHaveBeenCalledTimes(1 + 2 * MAX_RECREATE_ATTEMPTS);
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

  it("CHANNEL_ERROR twice in a row arms ONE recovery timer", async () => {
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

    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
      capturedSubscribeCallback!("CHANNEL_ERROR");
    });
    // Attempt 1 fires at grace + 10 s; attempt 2 is armed only after
    // it (grace + 20 s later at random = 0.5), so within this window a
    // duplicate timer is the only way to see a third channel.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REJOIN_GRACE_MS + 10_000);
    });
    await flushMicrotasks();
    expect(channelMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REJOIN_GRACE_MS);
    });
    expect(channelMock).toHaveBeenCalledTimes(2);
  });

  it("visibility resume starts a fresh session (fresh budget, new channel)", async () => {
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
    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
    });
    for (let i = 0; i < MAX_RECREATE_ATTEMPTS + 1; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(REJOIN_GRACE_MS + 60_000);
      });
      await flushMicrotasks();
    }
    const channelCallsAfterBudgetGone = channelMock.mock.calls.length;
    expect(channelCallsAfterBudgetGone).toBe(1 + MAX_RECREATE_ATTEMPTS);

    // Hide + show — the session restarts with a new channel…
    await act(async () => {
      setDocumentHidden(true);
    });
    await act(async () => {
      setDocumentHidden(false);
    });
    await flushMicrotasks();
    expect(channelMock).toHaveBeenCalledTimes(channelCallsAfterBudgetGone + 1);

    // …and a fresh re-creation budget.
    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
      await vi.advanceTimersByTimeAsync(REJOIN_GRACE_MS + 60_000);
    });
    await flushMicrotasks();
    expect(channelMock).toHaveBeenCalledTimes(channelCallsAfterBudgetGone + 2);
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
    capturedHandlers.length = 0;
    fakeChannel.on.mockImplementation(captureOn);
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
    // The fake server answers with its current revision, so the
    // notification's hint is satisfied once a request gets through.
    let serverRev = 1;
    const ok = async () => revResponse(serverRev, capturedAtFor(serverRev));
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(ok) // seed OK
      .mockResolvedValueOnce(makeErrorResponse()) // push refetch fails
      .mockResolvedValueOnce(makeErrorResponse()) // +1 s
      .mockResolvedValueOnce(makeErrorResponse()) // +2 s
      .mockImplementationOnce(ok) // +4 s recovers
      .mockResolvedValue(makeErrorResponse());
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result } = mount();
    await flushMicrotasks();

    expect(result.current.freshness.state).toBe("live");
    const firstSync = result.current.freshness.lastSyncAt;
    expect(firstSync).toBeInstanceOf(Date);

    // A save's broadcast triggers a refetch (after the 250 ms jitter
    // Math.random = 0.5 yields) that fails.
    await act(async () => {
      serverRev = 2;
      sendRev({ kind: "setlist", rev: 2 });
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

    // Next failure starts the schedule over at 1 s, not 8 s. (The
    // notification waits out the 1 s cooldown first: the recovering
    // request carried the previous hint, so it counts as a notification
    // fetch.)
    await act(async () => {
      serverRev = 3;
      sendRev({ kind: "setlist", rev: 3 });
    });
    await advance(1_000);
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

  it("a 503 Retry-After is a floor: pushes inside the window do not fetch before it", async () => {
    let serverRev = 1;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeErrorResponse(503, "3"))
      .mockImplementation(async () => revResponse(serverRev, capturedAtFor(serverRev)));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result } = mount();
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // A 503 counts toward the delayed indicator like any failure.
    expect(result.current.freshness.state).toBe("retrying");

    const save = () => {
      serverRev += 1;
      sendRev({ kind: "setlist", rev: serverRev });
    };
    await advance(500);
    await act(async () => {
      save();
      capturedSubscribeCallback!("SUBSCRIBED");
    });
    await advance(1_000);
    await act(async () => {
      save();
    });
    await advance(1_499); // t = 2999
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(1); // t = 3000: one request covers every trigger
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.freshness.state).toBe("live");

    // Floor expired → normal notification cadence (250 ms jitter here).
    await advance(2_000);
    await act(async () => {
      save();
    });
    await advance(250);
    expect(fetchMock).toHaveBeenCalledTimes(3);
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

  // Before the recovery rewrite the page switched to a SECOND data
  // source on CHANNEL_ERROR and showed "delayed" until that source had
  // synced. Now the same runner keeps syncing through the disconnect,
  // so a socket blip that realtime-js heals in a second no longer
  // flashes a warning at the whole audience; failures still do.
  it("a channel disconnect alone does not flag delayed — polling keeps the sync clock moving", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse());
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result } = mount();
    await flushMicrotasks();
    expect(result.current.freshness.state).toBe("live");
    const realtimeSync = result.current.freshness.lastSyncAt;

    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
    });
    expect(result.current.freshness.state).toBe("live");
    expect(result.current.freshness.lastSyncAt).toBe(realtimeSync);

    // First disconnected poll (random phase 2.5 s at 0.5) lands.
    await advance(2_500);
    expect(result.current.freshness.state).toBe("live");
    expect(result.current.freshness.lastSyncAt).not.toBe(realtimeSync);
  });

  it("failures while disconnected still walk the indicator to delayed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse())
      .mockResolvedValue(makeErrorResponse());
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result } = mount();
    await flushMicrotasks();
    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
    });
    // poll @2.5 s fails → retry 1 s → retry 2 s → 3rd failure.
    await advance(2_500 + 1_000 + 2_000);
    expect(result.current.freshness.state).toBe("delayed");
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

/** A distinct, increasing `capturedAt` per revision. */
function capturedAtFor(rev: number) {
  return new Date(Date.parse("2026-11-14T07:30:00.000Z") + rev * 1_000).toISOString();
}

/** A fetch mock that answers every call with `answer()` (evaluated per call). */
function answering(answer: () => unknown) {
  return vi.fn((url: string, init?: RequestInit) => {
    void url;
    void init;
    return Promise.resolve(answer());
  });
}

/** Attach an `x-snapshot-verify` header to a fake response. */
function withVerify<R extends object>(res: R, verify: string) {
  return { ...res, headers: new Headers({ "x-snapshot-verify": verify }) };
}

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
    capturedHandlers.length = 0;
    fakeChannel.on.mockImplementation(captureOn);
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

  // A fake server whose head moves with each save; every broadcast
  // announces the new head, and every request answers with the head as
  // of the moment it was sent — so a notification's hint is satisfied
  // by the request that carries it.
  function liveServer(initial = 1) {
    const server = {
      rev: initial,
      save() {
        server.rev += 1;
        sendRev({ kind: "setlist", rev: server.rev });
      },
    };
    return server;
  }

  // Each request takes `ms` to answer — long enough for notifications
  // to land while it is in flight.
  function slowFetch(ms: number, server: { rev: number }) {
    return vi.fn(() => {
      const rev = server.rev;
      return new Promise((resolve) => {
        setTimeout(() => resolve(revResponse(rev, capturedAtFor(rev))), ms);
      });
    });
  }

  it("a notification while a request is in flight → exactly one more request after it settles", async () => {
    const server = liveServer();
    const fetchMock = slowFetch(300, server);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    mount();
    await advance(300); // seed settles
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      server.save();
    });
    await advance(250); // jitter → request #2 starts (in flight 300 ms)
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      server.save();
      server.save();
      server.save();
    });
    await advance(5_000);
    // Three in-flight notifications collapse into ONE follow-up.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("two notifications within 1 s → two requests total, not three", async () => {
    const server = liveServer();
    const fetchMock = slowFetch(300, server);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    mount();
    await advance(300);
    const baseline = fetchMock.mock.calls.length;

    await act(async () => {
      server.save(); // → request at +250
    });
    await advance(400); // second push lands mid-flight
    await act(async () => {
      server.save();
    });
    await advance(5_000);
    expect(fetchMock.mock.calls.length - baseline).toBe(2);
  });

  it("the follow-up after a notification waits out the 1 s cooldown", async () => {
    const server = liveServer();
    const fetchMock = slowFetch(100, server);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    mount();
    await advance(100);

    await act(async () => {
      server.save();
    });
    await advance(250); // request #2 starts at t0 + 250
    await act(async () => {
      server.save(); // dirty
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

    // Resume: jittered gap-fill (250 ms here), then the cadence restarts.
    await act(async () => {
      setDocumentHidden(false);
    });
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await advance(250);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await advance(19_750);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("an `online` event fetches after the catch-up jitter (a venue's Wi-Fi comes back at once)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse());
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    mount();
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await advance(249);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(1);
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

  // R1 sent a notification fetch as `minRev = appliedRev + 1` (a guess,
  // since postgres_changes carried no revision). R2 sends the broadcast's
  // own revision: `max(serverRev, H)` plus `hint=1`; maintenance requests
  // send the server-observed revision only.
  it("a broadcast notification fetch sends minRev = max(serverRev, H) & hint=1; periodic / catch-up send serverRev", async () => {
    const server = { rev: 7 };
    const fetchMock = answering(() => revResponse(server.rev, capturedAtFor(server.rev)));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result } = mount({ initialRev: 7, initialCapturedAt: "2026-11-14T07:29:00.000Z" });
    await flushMicrotasks();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/setlist?eventId=1&locale=ko&minRev=7");

    server.rev = 8;
    await act(async () => {
      sendRev({ kind: "setlist", rev: 8 });
    });
    await advance(250);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/setlist?eventId=1&locale=ko&minRev=8&hint=1",
    );
    expect(result.current.rev).toBe(8);
    expect(result.current.freshness.state).toBe("live");

    await advance(19_750); // periodic at 20 s
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toBe("/api/setlist?eventId=1&locale=ko&minRev=8");
    await act(async () => {
      capturedSubscribeCallback!("SUBSCRIBED");
    });
    await advance(250); // catch-up jitter
    expect(fetchMock.mock.calls[3][0]).toBe("/api/setlist?eventId=1&locale=ko&minRev=8");
  });

  it("a hint an R1 server never confirms (no verify header) → one quiet recheck, then dropped; never retrying / delayed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(revResponse(3, "2026-11-14T07:30:00.000Z"));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result } = mount({ initialRev: 3, initialCapturedAt: "2026-11-14T07:29:00.000Z" });
    await flushMicrotasks();

    await act(async () => {
      sendRev({ kind: "setlist", rev: 4 });
    });
    await advance(250);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/setlist?eventId=1&locale=ko&minRev=4&hint=1");
    expect(result.current.freshness.state).toBe("live");

    // Recheck at settle + max(1 s, cooldown left) + U(0, 500) = +1250.
    await advance(1_249);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toBe("/api/setlist?eventId=1&locale=ko&minRev=4");
    expect(result.current.freshness.state).toBe("live");
    expect(addBreadcrumbMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("hint exhausted (rev 4)") }),
    );

    // Dropped: nothing more until the periodic repair, which is generic.
    await advance(18_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await advance(500); // periodic at 20 s
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3][0]).toBe("/api/setlist?eventId=1&locale=ko&minRev=3");
    expect(result.current.freshness.state).toBe("live");
  });

  it("an inconclusive memo answer is rechecked, and the recheck lands the update", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(revResponse(3, "2026-11-14T07:30:00.000Z")) // seed
      .mockResolvedValueOnce(
        withVerify(revResponse(3, "2026-11-14T07:30:01.000Z"), "memo=3;age=120"),
      )
      .mockResolvedValue(withVerify(revResponse(4, "2026-11-14T07:30:02.000Z"), "satisfied"));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result } = mount({ initialRev: 3, initialCapturedAt: "2026-11-14T07:29:00.000Z" });
    await flushMicrotasks();
    await act(async () => {
      sendRev({ kind: "setlist", rev: 4 });
    });
    await advance(250);
    expect(result.current.rev).toBe(3);
    await advance(1_250);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toBe("/api/setlist?eventId=1&locale=ko&minRev=4");
    expect(result.current.rev).toBe(4);
    expect(result.current.freshness.state).toBe("live");
    await advance(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("poisoning drill: a forged max-safe-integer broadcast is disproved once; honest saves then work and serverRev is never poisoned", async () => {
    let serverRev = 3;
    const fetchMock = answering(() =>
      withVerify(revResponse(serverRev, capturedAtFor(serverRev)), `fresh=${serverRev}`),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result } = mount({ initialRev: 3, initialCapturedAt: "2026-11-14T07:29:00.000Z" });
    await flushMicrotasks();

    await act(async () => {
      sendRev({ kind: "setlist", rev: Number.MAX_SAFE_INTEGER });
    });
    await advance(250);
    expect(fetchMock.mock.calls[1][0]).toBe(
      `/api/setlist?eventId=1&locale=ko&minRev=${Number.MAX_SAFE_INTEGER}&hint=1`,
    );
    // fresh=3 < H → disproved: no recheck, no failure.
    await advance(3_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.freshness.state).toBe("live");

    serverRev = 4;
    await act(async () => {
      sendRev({ kind: "setlist", rev: 4 });
    });
    await advance(250);
    expect(fetchMock.mock.calls[2][0]).toBe("/api/setlist?eventId=1&locale=ko&minRev=4&hint=1");
    expect(result.current.rev).toBe(4);

    await advance(20_000); // periodic: the durable watermark is 4, not 2^53 − 1
    expect(fetchMock.mock.calls[3][0]).toBe("/api/setlist?eventId=1&locale=ko&minRev=4");
    expect(result.current.freshness.state).toBe("live");
  });

  it("fresh dbRev above the served rev is a server-proven gap: retry path chases dbRev", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(revResponse(3, "2026-11-14T07:30:00.000Z")) // seed
      .mockResolvedValueOnce(withVerify(revResponse(3, "2026-11-14T07:30:01.000Z"), "fresh=4"))
      .mockResolvedValue(withVerify(revResponse(4, "2026-11-14T07:30:02.000Z"), "satisfied"));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result } = mount({ initialRev: 3, initialCapturedAt: "2026-11-14T07:29:00.000Z" });
    await flushMicrotasks();
    await act(async () => {
      sendRev({ kind: "setlist", rev: 9 });
    });
    await advance(250);
    expect(result.current.freshness.state).toBe("retrying");
    await advance(1_000); // n13 retry, 1 s
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // The hint (9) was disproved; the retry asks for the proven head.
    expect(fetchMock.mock.calls[2][0]).toBe("/api/setlist?eventId=1&locale=ko&minRev=4");
    expect(result.current.rev).toBe(4);
    expect(result.current.freshness.state).toBe("live");
  });

  it("polling while disconnected shares realtime's applied version: an older polled rev is rejected", async () => {
    const realtimeItems = [{ id: "rt-rev7" }];
    const staleItems = [{ id: "stale-rev5" }];
    const fetchMock = vi
      .fn()
      // Realtime seed: rev 7 (SSR said 3).
      .mockResolvedValueOnce(revResponse(7, "2026-11-14T07:30:00.000Z", realtimeItems))
      // Every polled response: a stale cache at rev 5.
      .mockResolvedValue(revResponse(5, "2026-11-14T07:31:00.000Z", staleItems));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result } = mount({
      initialRev: 3,
      initialCapturedAt: "2026-11-14T07:29:00.000Z",
    });
    await flushMicrotasks();
    expect(result.current.rev).toBe(7);

    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
    });
    await advance(2_500); // first poll (random phase at 0.5)
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Polling asks with realtime's revision, not the SSR one…
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/setlist?eventId=1&locale=ko&minRev=7",
    );
    // …and the rev-5 answer does not roll the page back.
    expect(result.current.items).toBe(realtimeItems);
    expect(result.current.rev).toBe(7);
    expect(result.current.capturedAt).toBe("2026-11-14T07:30:00.000Z");

    await advance(30_000);
    expect(result.current.items).toBe(realtimeItems);
    expect(result.current.rev).toBe(7);
  });

  // ── Monotonic DOM across the polling ↔ realtime hand-over ──
  //
  // Both directions of the hand-over go through ONE acceptance
  // watermark (one useLiveSnapshot, one scheduler), so the rendered
  // `rev` is non-decreasing over every render — not just at the end.
  // `renders` records what each render actually returned.

  function mountRecording(extra: { initialRev?: number; initialCapturedAt?: string }) {
    const renders: Array<{ rev: number | null; items: unknown[] }> = [];
    const hook = renderHook(() => {
      const value = useRealtimeEventChannel({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
        startTime: null,
        ...extra,
      });
      renders.push({ rev: value.rev, items: value.items });
      return value;
    });
    return { ...hook, renders };
  }

  function expectMonotonic(renders: Array<{ rev: number | null }>) {
    let max = -Infinity;
    for (const { rev } of renders) {
      if (rev === null) continue;
      expect(rev).toBeGreaterThanOrEqual(max);
      max = Math.max(max, rev);
    }
  }

  it("hand-over polling → realtime: polling reached rev 12, the rejoin catch-up answers rev 10 → rev 10 is never rendered", async () => {
    const rev10 = [{ id: "rev10" }];
    const rev12 = [{ id: "rev12" }];
    // Responses by phase: realtime holds 10; polling (fallback) gets 12;
    // after the rejoin a stale cache instance answers 10 again.
    let phase: "realtime" | "polling" | "rejoined" = "realtime";
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        phase === "polling"
          ? revResponse(12, "2026-11-14T07:31:00.000Z", rev12)
          : revResponse(10, "2026-11-14T07:30:00.000Z", rev10),
      ),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result, renders } = mountRecording({
      initialRev: 9,
      initialCapturedAt: "2026-11-14T07:29:00.000Z",
    });
    await flushMicrotasks();
    await act(async () => {
      capturedSubscribeCallback!("SUBSCRIBED");
    });
    await advance(250);
    expect(result.current.rev).toBe(10);

    phase = "polling";
    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
    });
    await advance(2_500); // first disconnected poll
    expect(result.current.rev).toBe(12);
    expect(result.current.items).toBe(rev12);

    phase = "rejoined";
    await act(async () => {
      capturedSubscribeCallback!("SUBSCRIBED");
    });
    await advance(1_000); // jittered catch-up lands with rev 10
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(result.current.rev).toBe(12);
    expect(result.current.items).toBe(rev12);
    await advance(25_000); // a healthy repair poll, still rev 10
    expect(result.current.rev).toBe(12);
    expect(result.current.items).toBe(rev12);

    expectMonotonic(renders);
    expect(renders.some((r) => r.rev === 12)).toBe(true);
    const firstAt12 = renders.findIndex((r) => r.rev === 12);
    expect(renders.slice(firstAt12).every((r) => r.items === rev12)).toBe(true);
  });

  it("hand-over realtime → polling: realtime shows rev 12, the first poll answers rev 11 → 11 is rejected", async () => {
    const rev12 = [{ id: "rev12" }];
    const rev11 = [{ id: "rev11" }];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(revResponse(12, "2026-11-14T07:31:00.000Z", rev12))
      .mockResolvedValue(revResponse(11, "2026-11-14T07:32:00.000Z", rev11));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { result, renders } = mountRecording({
      initialRev: 10,
      initialCapturedAt: "2026-11-14T07:29:00.000Z",
    });
    await flushMicrotasks();
    expect(result.current.rev).toBe(12);

    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
    });
    await advance(2_500); // first disconnected poll → rev 11
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/setlist?eventId=1&locale=ko&minRev=12",
    );
    expect(result.current.rev).toBe(12);
    expect(result.current.items).toBe(rev12);
    // Older than a revision the server already showed → server gap →
    // retry path, never applied.
    await advance(10_000);
    expect(result.current.rev).toBe(12);
    expect(result.current.items).toBe(rev12);
    expectMonotonic(renders);
    expect(renders.every((r) => r.items !== rev11)).toBe(true);
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
    const server = liveServer();
    const fetchMock = answering(() => revResponse(server.rev, capturedAtFor(server.rev)));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    mount();
    await flushMicrotasks();

    window.__osl = { dropNextNotification: true };
    await act(async () => {
      server.save();
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
      server.save();
    });
    await advance(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("an invalid broadcast payload does not consume the drop flag", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFetchResponse()) as unknown as typeof fetch,
    );
    mount();
    await flushMicrotasks();
    window.__osl = { dropNextNotification: true };
    await act(async () => {
      sendRev({ kind: "reaction", rev: 99 });
      sendRev({ kind: "setlist", rev: "99" });
    });
    expect(window.__osl.dropNextNotification).toBe(true);
  });
});

// A soft-deleted (or missing) event answers 404. The page keeps its last
// content but stops every live request for good: no retry, no periodic
// repair poll, no notification fetch, and the Realtime channel is
// released and never re-joined (not even on a visibility resume).
describe("useRealtimeEventChannel — 404 (event deleted) is terminal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    capturedSubscribeCallback = null;
    addBreadcrumbMock.mockClear();
    captureMessageMock.mockClear();
    channelMock.mockClear();
    removeChannelMock.mockClear();
    fakeChannel.on.mockClear();
    fakeChannel.subscribe.mockClear();
    capturedHandlers.length = 0;
    fakeChannel.on.mockImplementation(captureOn);
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

  function mount() {
    return renderHook(() =>
      useRealtimeEventChannel({
        eventId: "1",
        initialItems,
        initialReactionCounts,
        initialTop3Wishes,
        locale: "ko",
        enabled: true,
        startTime: null,
        initialRev: 1,
        initialCapturedAt: capturedAtFor(1),
      }),
    );
  }

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("a 404 seed: gone, channel removed, nothing fetched afterwards", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeErrorResponse(404));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const hook = mount();
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hook.result.current.gone).toBe(true);
    expect(channelMock).toHaveBeenCalledTimes(1);
    expect(removeChannelMock).toHaveBeenCalledTimes(1);

    // Past every retry step and many periodic ticks.
    await advance(5 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Not a failure: the indicator never walks to retrying / delayed.
    expect(hook.result.current.freshness.state).toBe("live");
    // No re-join either.
    expect(channelMock).toHaveBeenCalledTimes(1);
  });

  it("the delete's broadcast → 404 → stop: later broadcasts, polls and resumes do no work", async () => {
    let deleted = false;
    let serverRev = 1;
    const fetchMock = answering(() =>
      deleted
        ? makeErrorResponse(404)
        : revResponse(serverRev, capturedAtFor(serverRev), [{ id: "kept" }]),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const hook = mount();
    await flushMicrotasks();
    await act(async () => {
      capturedSubscribeCallback?.("SUBSCRIBED");
    });
    await advance(1_000); // catch-up
    const before = fetchMock.mock.calls.length;
    expect(hook.result.current.items).toEqual([{ id: "kept" }]);

    // The admin soft-delete bumps the revision and broadcasts it.
    deleted = true;
    serverRev = 2;
    await act(async () => {
      sendRev({ kind: "setlist", rev: 2 });
    });
    await advance(1_000);
    expect(fetchMock.mock.calls.length).toBe(before + 1);
    expect(hook.result.current.gone).toBe(true);
    expect(removeChannelMock).toHaveBeenCalledTimes(1);
    // The last content stays on screen.
    expect(hook.result.current.items).toEqual([{ id: "kept" }]);

    // A stray broadcast on the old handler, an `online` event, a hide
    // + show cycle and several periodic windows: nothing fetches, no
    // channel is joined again.
    await act(async () => {
      sendRev({ kind: "setlist", rev: 3 });
      window.dispatchEvent(new Event("online"));
    });
    await act(async () => {
      setDocumentHidden(true);
    });
    await act(async () => {
      setDocumentHidden(false);
    });
    await advance(5 * 60_000);
    expect(fetchMock.mock.calls.length).toBe(before + 1);
    expect(channelMock).toHaveBeenCalledTimes(1);
  });

  it("a 503 is still retried (only 404 is terminal)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeErrorResponse(503));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const hook = mount();
    await flushMicrotasks();
    await advance(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(hook.result.current.gone).toBe(false);
    expect(removeChannelMock).not.toHaveBeenCalled();
  });
});
