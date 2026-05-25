import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { setDocumentHidden } from "@/__tests__/helpers/testVisibility";

const { addBreadcrumbMock, captureMessageMock } = vi.hoisted(() => ({
  addBreadcrumbMock: vi.fn(),
  captureMessageMock: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: addBreadcrumbMock,
  captureMessage: captureMessageMock,
}));

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

import { useRealtimeImpressions } from "@/hooks/useRealtimeImpressions";
import {
  RECOVERY_DELAY_MS,
  MAX_RECOVERY_ATTEMPTS,
} from "@/lib/realtimeRecovery";

describe("useRealtimeImpressions — R3 fallback", () => {
  beforeEach(() => {
    capturedSubscribeCallback = null;
    addBreadcrumbMock.mockClear();
    captureMessageMock.mockClear();
    channelMock.mockClear();
    removeChannelMock.mockClear();
    fakeChannel.on.mockClear();
    fakeChannel.subscribe.mockClear();
    // Default to "tab visible" — every test that wants the hidden
    // path opts in via `setDocumentHidden(true)`.
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Restore the JSDOM default `document.hidden` getter so the
    // override doesn't leak into other test files in the same suite
    // run.
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
  });

  it("exposes pollFallback=true after CHANNEL_ERROR", async () => {
    const { result } = renderHook(() =>
      useRealtimeImpressions({
        eventId: "1",
        enabled: true,
      }),
    );

    expect(result.current.pollFallback).toBe(false);
    expect(channelMock).toHaveBeenCalledWith("event:1:impressions");

    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
    });

    expect(result.current.pollFallback).toBe(true);
    // Channel torn down so polling consumer can take over.
    expect(removeChannelMock).toHaveBeenCalledTimes(1);
  });

  it("exposes pollFallback=true after TIMED_OUT", async () => {
    const { result } = renderHook(() =>
      useRealtimeImpressions({
        eventId: "1",
        enabled: true,
      }),
    );

    await act(async () => {
      capturedSubscribeCallback!("TIMED_OUT");
    });

    expect(result.current.pollFallback).toBe(true);
  });

  it("captureMessage uses the impressions-specific message exactly once", async () => {
    renderHook(() =>
      useRealtimeImpressions({
        eventId: "42",
        enabled: true,
      }),
    );

    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
      capturedSubscribeCallback!("TIMED_OUT");
    });

    expect(captureMessageMock).toHaveBeenCalledTimes(1);
    expect(captureMessageMock).toHaveBeenCalledWith(
      "Realtime impressions fallback to polling",
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({
          eventId: "42",
          transitionReason: "CHANNEL_ERROR",
        }),
      }),
    );
  });

  it("breadcrumbs use the realtime-impressions category to disambiguate from the setlist channel", async () => {
    renderHook(() =>
      useRealtimeImpressions({
        eventId: "1",
        enabled: true,
      }),
    );

    await act(async () => {
      capturedSubscribeCallback!("SUBSCRIBED");
      capturedSubscribeCallback!("CHANNEL_ERROR");
    });

    const calls = addBreadcrumbMock.mock.calls;
    const categories = calls.map(([arg]) => arg.category as string);
    expect(categories.every((c) => c === "realtime-impressions")).toBe(true);
  });

  it("does not subscribe when enabled=false", () => {
    renderHook(() =>
      useRealtimeImpressions({
        eventId: "1",
        enabled: false,
      }),
    );

    expect(channelMock).not.toHaveBeenCalled();
    expect(capturedSubscribeCallback).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// R3.5 — visibility handling + bounded auto-recovery
//
// Sentry issue 7501479492 baseline: ~19 fallbacks/day, dominantly
// macOS Chrome background-tab throttling (11-min silent breadcrumb
// gap before CHANNEL_ERROR fired). Visibility hide proactively tears
// the channel down so no CHANNEL_ERROR is emitted; visibility resume
// re-subscribes. Bounded time-based auto-recovery handles failures
// that occur while the tab is visible (network blip, server reject).
// ────────────────────────────────────────────────────────────────────

describe("useRealtimeImpressions — R3.5 visibility + auto-recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    capturedSubscribeCallback = null;
    addBreadcrumbMock.mockClear();
    captureMessageMock.mockClear();
    channelMock.mockClear();
    removeChannelMock.mockClear();
    fakeChannel.on.mockClear();
    fakeChannel.subscribe.mockClear();
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
  });

  it("tears down the channel when document becomes hidden, re-subscribes when visible again", async () => {
    renderHook(() =>
      useRealtimeImpressions({ eventId: "1", enabled: true }),
    );

    // Initial subscribe happened on mount.
    expect(channelMock).toHaveBeenCalledTimes(1);
    expect(removeChannelMock).not.toHaveBeenCalled();

    // Hide — channel should be removed (paused gate).
    await act(async () => {
      setDocumentHidden(true);
    });
    expect(removeChannelMock).toHaveBeenCalledTimes(1);

    // Visible again — channel re-subscribes (fresh channel() call).
    await act(async () => {
      setDocumentHidden(false);
    });
    expect(channelMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT emit captureMessage when channel tear-down is visibility-driven (no CHANNEL_ERROR)", async () => {
    renderHook(() =>
      useRealtimeImpressions({ eventId: "1", enabled: true }),
    );

    await act(async () => {
      capturedSubscribeCallback!("SUBSCRIBED");
    });
    await act(async () => {
      setDocumentHidden(true);
    });
    await act(async () => {
      setDocumentHidden(false);
    });

    // Visibility hide/show never produces a CHANNEL_ERROR, so no
    // captureMessage was fired. Only the SUBSCRIBED breadcrumb.
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it("schedules auto-recovery after CHANNEL_ERROR while tab is visible", async () => {
    const { result } = renderHook(() =>
      useRealtimeImpressions({ eventId: "1", enabled: true }),
    );

    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
    });
    expect(result.current.pollFallback).toBe(true);
    expect(removeChannelMock).toHaveBeenCalledTimes(1);

    // After RECOVERY_DELAY_MS, the scheduled setTimeout fires and
    // setPollFallback(false) re-runs the channel-setup effect.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECOVERY_DELAY_MS);
    });

    expect(result.current.pollFallback).toBe(false);
    // Second channel() call = recovery attempt re-subscribed.
    expect(channelMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT schedule auto-recovery when CHANNEL_ERROR fires while tab is hidden", async () => {
    renderHook(() =>
      useRealtimeImpressions({ eventId: "1", enabled: true }),
    );

    // Hide first — paused gate takes effect, channel torn down.
    await act(async () => {
      setDocumentHidden(true);
    });

    // Force a CHANNEL_ERROR through the captured callback (defensive
    // — supabase-js shouldn't fire one against a removed channel,
    // but the early-return guards against doc.hidden anyway).
    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
    });

    // No recovery timer scheduled while hidden.
    const channelCallsBefore = channelMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECOVERY_DELAY_MS * 2);
    });
    expect(channelMock.mock.calls.length).toBe(channelCallsBefore);
  });

  it("exhausts the recovery budget after MAX_RECOVERY_ATTEMPTS and then stays on polling", async () => {
    const { result } = renderHook(() =>
      useRealtimeImpressions({ eventId: "1", enabled: true }),
    );

    // Each attempt: CHANNEL_ERROR → setPollFallback(true) →
    // setTimeout(RECOVERY_DELAY_MS) → setPollFallback(false) →
    // re-subscribe → CHANNEL_ERROR again …
    for (let i = 0; i < MAX_RECOVERY_ATTEMPTS; i++) {
      await act(async () => {
        capturedSubscribeCallback!("CHANNEL_ERROR");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(RECOVERY_DELAY_MS);
      });
    }

    // Trigger one more CHANNEL_ERROR — budget exhausted, no further
    // timer scheduled.
    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
    });
    const channelCallsBefore = channelMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECOVERY_DELAY_MS * 2);
    });
    expect(channelMock.mock.calls.length).toBe(channelCallsBefore);
    expect(result.current.pollFallback).toBe(true);
  });

  it("captureMessage still emits exactly once across multiple CHANNEL_ERROR + recovery cycles", async () => {
    renderHook(() =>
      useRealtimeImpressions({ eventId: "1", enabled: true }),
    );

    // First fallback emits the captureMessage.
    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
    });
    // Recovery attempt re-subscribes; another CHANNEL_ERROR — should
    // NOT emit a second captureMessage.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECOVERY_DELAY_MS);
    });
    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
    });

    expect(captureMessageMock).toHaveBeenCalledTimes(1);
  });

  it("does not subscribe a channel on mount when document is already hidden (CR — useSyncExternalStore)", async () => {
    // Page opened in a backgrounded tab. `useSyncExternalStore` reads
    // `document.hidden` during the first render (via getSnapshot),
    // so `paused` is `true` from the very first render — the channel-
    // setup effect early-returns without ever subscribing. Cleaner
    // than the prior useState-based attempt which would have done a
    // brief subscribe + immediate teardown.
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });

    renderHook(() =>
      useRealtimeImpressions({ eventId: "1", enabled: true }),
    );

    expect(channelMock).not.toHaveBeenCalled();
    expect(removeChannelMock).not.toHaveBeenCalled();
  });

  it("ignores CHANNEL_ERROR while the tab is hidden — no captureMessage, no pollFallback flip (CR)", async () => {
    const { result } = renderHook(() =>
      useRealtimeImpressions({ eventId: "1", enabled: true }),
    );

    expect(capturedSubscribeCallback).not.toBeNull();
    const subscribeCallback = capturedSubscribeCallback!;

    // Tab goes hidden — pause flips, channel removed.
    await act(async () => {
      setDocumentHidden(true);
    });

    // A stale CHANNEL_ERROR fires from the prior channel's subscribe
    // callback after the visibility-driven teardown. Without the
    // early-return guard, this would (a) emit a captureMessage from
    // a hidden tab and (b) flip pollFallback to true, engaging
    // useImpressionPolling against a tab the user can't see.
    await act(async () => {
      subscribeCallback("CHANNEL_ERROR");
    });

    expect(captureMessageMock).not.toHaveBeenCalled();
    expect(result.current.pollFallback).toBe(false);
  });

  it("does not schedule a duplicate recovery timer when CHANNEL_ERROR fires twice in a row (CR guard)", async () => {
    renderHook(() =>
      useRealtimeImpressions({ eventId: "1", enabled: true }),
    );

    // Two CHANNEL_ERRORs in rapid succession — without the
    // `pendingRecoveryTimeoutRef.current === null` guard the second
    // would have scheduled a second timer, consuming an extra budget
    // attempt for nothing.
    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
      capturedSubscribeCallback!("CHANNEL_ERROR");
    });

    // Advance to fire whatever timer was scheduled.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECOVERY_DELAY_MS);
    });

    // Channel re-subscribed exactly once (the original + the one
    // recovery attempt). If a duplicate timer had been scheduled,
    // we'd see 3+ channelMock calls.
    expect(channelMock).toHaveBeenCalledTimes(2);
  });

  it("visibility resume from pollFallback=true resets budget and re-attempts realtime", async () => {
    const { result } = renderHook(() =>
      useRealtimeImpressions({ eventId: "1", enabled: true }),
    );

    // Burn the full budget while visible.
    for (let i = 0; i < MAX_RECOVERY_ATTEMPTS; i++) {
      await act(async () => {
        capturedSubscribeCallback!("CHANNEL_ERROR");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(RECOVERY_DELAY_MS);
      });
    }
    await act(async () => {
      capturedSubscribeCallback!("CHANNEL_ERROR");
    });
    expect(result.current.pollFallback).toBe(true);

    // User hides then returns — budget reset, fallback cleared, the
    // channel-setup effect re-subscribes immediately on resume.
    await act(async () => {
      setDocumentHidden(true);
    });
    await act(async () => {
      setDocumentHidden(false);
    });
    expect(result.current.pollFallback).toBe(false);
  });
});
