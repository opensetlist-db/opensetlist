import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

// n14: `<EventImpressions>` keeps its feed live by polling only — the
// per-row postgres_changes path (`useRealtimeImpressions`) is gone.

const { channelMock } = vi.hoisted(() => ({ channelMock: vi.fn() }));

vi.mock("@/lib/supabaseClient", () => ({
  getSupabaseBrowserClient: () => ({
    channel: channelMock,
    removeChannel: vi.fn(),
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "ko",
}));

vi.mock("@/hooks/useMounted", () => ({
  useMounted: () => true,
}));

vi.mock("@/lib/anonId", () => ({
  getAnonId: () => "test-anon-id",
}));

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
}));

import { EventImpressions } from "@/components/EventImpressions";

const polledRow = {
  id: "imp-2",
  rootImpressionId: "imp-2",
  eventId: "1",
  content: "polled impression",
  locale: "ko",
  createdAt: "2026-11-14T08:00:00.000Z",
};

describe("EventImpressions — polling is the only live path", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    channelMock.mockClear();
    localStorage.clear();
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ impressions: [polledRow], nextCursor: null }),
      }) as unknown as typeof fetch,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("ongoing: polls /api/impressions and merges the result; no Realtime channel", async () => {
    render(
      <EventImpressions
        eventId="1"
        initialImpressions={[]}
        initialNextCursor={null}
        initialTotalCount={0}
        isOngoing
      />,
    );
    expect(channelMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000); // random phase at 0.5
    });
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/impressions?eventId=1",
      expect.anything(),
    );
    expect(screen.getByText("polled impression")).toBeTruthy();
    expect(channelMock).not.toHaveBeenCalled();
  });

  it("not ongoing: no polling at all", async () => {
    render(
      <EventImpressions
        eventId="1"
        initialImpressions={[]}
        initialNextCursor={null}
        initialTotalCount={0}
        isOngoing={false}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(channelMock).not.toHaveBeenCalled();
  });
});
