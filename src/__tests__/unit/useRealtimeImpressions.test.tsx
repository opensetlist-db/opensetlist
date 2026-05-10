import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

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

describe("useRealtimeImpressions — R3 fallback", () => {
  beforeEach(() => {
    capturedSubscribeCallback = null;
    addBreadcrumbMock.mockClear();
    captureMessageMock.mockClear();
    channelMock.mockClear();
    removeChannelMock.mockClear();
    fakeChannel.on.mockClear();
    fakeChannel.subscribe.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
