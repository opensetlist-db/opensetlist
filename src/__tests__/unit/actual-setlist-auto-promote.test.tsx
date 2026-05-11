import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks/useMounted", () => ({
  useMounted: () => true,
}));

import { ActualSetlist } from "@/components/ActualSetlist";
import { AUTO_CONFIRM_TICK_MS } from "@/lib/confirmStatus";
import type { LiveSetlistItem } from "@/lib/types/setlist";

function makeItem(overrides: Partial<LiveSetlistItem> = {}): LiveSetlistItem {
  return {
    id: 1,
    position: 1,
    isEncore: false,
    stageType: "full_group",
    unitName: null,
    status: "confirmed",
    performanceType: "live_performance",
    type: "song",
    createdAt: "2026-05-09T12:00:00.000Z",
    songs: [
      {
        song: {
          id: 1,
          slug: "test-song",
          originalTitle: "Test Song",
          originalLanguage: "ja",
          variantLabel: null,
          baseVersionId: null,
          translations: [],
          artists: [],
        },
      },
    ],
    performers: [],
    artists: [],
    ...overrides,
  };
}

/**
 * Regression: pre-Realtime, the 5s polling cadence in
 * `useSetlistPolling` provided an implicit re-render trigger that
 * `getConfirmStatus`'s 1-min auto-promote relied on. With the
 * Realtime push path, no cadence — pushes only fire on actual
 * changes, so a rumoured row stayed visually rumoured forever
 * unless either a push arrived or the user reloaded.
 *
 * The fix is a per-component setInterval gated on `hasRumoured`,
 * forcing a re-render every 5s independent of the data source.
 * These tests assert the gating contract: no timer registered when
 * every row is already confirmed (zero overhead for completed
 * events), one timer registered when at least one rumoured row is
 * present.
 */
describe("ActualSetlist — auto-promote ticker", () => {
  let setIntervalSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.clear();
    setIntervalSpy = vi.spyOn(global, "setInterval");
  });

  afterEach(() => {
    setIntervalSpy.mockRestore();
  });

  it("registers a 5s ticker when at least one rumoured row is present", () => {
    // createdAt 30s before NOW so the row is genuinely rumoured at
    // render time (under the 60s auto-promote threshold).
    const now = new Date();
    const recentRumoured = makeItem({
      status: "rumoured",
      createdAt: new Date(now.getTime() - 30_000).toISOString(),
    });

    render(
      <ActualSetlist
        items={[recentRumoured]}
        reactionCounts={{}}
        locale="ko"
        eventId="1"
      />,
    );

    // Filter out any unrelated setInterval calls that React or test
    // infra might fire (none expected, but defensive). Our ticker is
    // the one with the literal 5_000 ms cadence.
    const ourTickerCalls = setIntervalSpy.mock.calls.filter(
      ([, ms]: [unknown, number?]) => ms === AUTO_CONFIRM_TICK_MS,
    );
    expect(ourTickerCalls.length).toBe(1);
  });

  it("does NOT register a ticker when every row is already confirmed", () => {
    // Pure DB-confirmed status — `getConfirmStatus` returns
    // 'confirmed' regardless of createdAt, so hasRumoured is false
    // and the useEffect early-returns before the setInterval call.
    const confirmedItem = makeItem({ status: "confirmed" });

    render(
      <ActualSetlist
        items={[confirmedItem]}
        reactionCounts={{}}
        locale="ko"
        eventId="1"
      />,
    );

    const ourTickerCalls = setIntervalSpy.mock.calls.filter(
      ([, ms]: [unknown, number?]) => ms === AUTO_CONFIRM_TICK_MS,
    );
    expect(ourTickerCalls.length).toBe(0);
  });

  it("does NOT register a ticker when a rumoured row is past the 60s boundary (already auto-promoted)", () => {
    // createdAt 90s before NOW — getConfirmStatus's elapsed-time
    // check returns 'confirmed', so hasRumoured stays false from
    // the very first render. No ticker needed.
    const now = new Date();
    const settledItem = makeItem({
      status: "rumoured",
      createdAt: new Date(now.getTime() - 90_000).toISOString(),
    });

    render(
      <ActualSetlist
        items={[settledItem]}
        reactionCounts={{}}
        locale="ko"
        eventId="1"
      />,
    );

    const ourTickerCalls = setIntervalSpy.mock.calls.filter(
      ([, ms]: [unknown, number?]) => ms === AUTO_CONFIRM_TICK_MS,
    );
    expect(ourTickerCalls.length).toBe(0);
  });
});
