import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import EventStatusTicker from "@/components/EventStatusTicker";
import { ONGOING_BUFFER_MS } from "@/lib/eventStatus";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

const POST_BOUNDARY_BUFFER_MS = 2000;
// Anchor "now" so boundary math is deterministic across test cases.
const NOW = new Date("2026-05-02T12:00:00Z").getTime();

describe("EventStatusTicker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    refreshMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing when startTime is null", async () => {
    render(<EventStatusTicker startTime={null} />);
    await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("does nothing when startTime is not a valid date string", async () => {
    render(<EventStatusTicker startTime="not-a-date" />);
    await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("refreshes at startTime + 2s for an upcoming event", async () => {
    const startTime = new Date(NOW + 60_000).toISOString(); // T+60s
    render(<EventStatusTicker startTime={startTime} />);

    // Just before boundary + buffer — must not have fired yet.
    await vi.advanceTimersByTimeAsync(60_000 + POST_BOUNDARY_BUFFER_MS - 1);
    expect(refreshMock).not.toHaveBeenCalled();

    // Cross the buffer.
    await vi.advanceTimersByTimeAsync(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes at startTime + 12h + 2s for an event already in 'ongoing' window", async () => {
    // startTime 1h ago → resolved status would be "ongoing"; next boundary
    // is at startTime + 12h, i.e. NOW + 11h.
    const startTime = new Date(NOW - 60 * 60 * 1000).toISOString();
    render(<EventStatusTicker startTime={startTime} />);

    const msUntilCompleted = ONGOING_BUFFER_MS - 60 * 60 * 1000;
    await vi.advanceTimersByTimeAsync(
      msUntilCompleted + POST_BOUNDARY_BUFFER_MS - 1
    );
    expect(refreshMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("does nothing for an event whose ongoing window already closed", async () => {
    // startTime 13h ago → resolved status is "completed"; no future boundary.
    const startTime = new Date(NOW - 13 * 60 * 60 * 1000).toISOString();
    render(<EventStatusTicker startTime={startTime} />);
    await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("cancels the scheduled refresh on unmount", async () => {
    const startTime = new Date(NOW + 60_000).toISOString();
    const { unmount } = render(<EventStatusTicker startTime={startTime} />);

    unmount();

    await vi.advanceTimersByTimeAsync(60_000 + POST_BOUNDARY_BUFFER_MS + 1000);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
