import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";

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
    confirmCount: 0,
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
        status="ongoing"
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
        status="ongoing"
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
        status="ongoing"
      />,
    );

    const ourTickerCalls = setIntervalSpy.mock.calls.filter(
      ([, ms]: [unknown, number?]) => ms === AUTO_CONFIRM_TICK_MS,
    );
    expect(ourTickerCalls.length).toBe(0);
  });

  // CR follow-up on PR #323 — the gating tests above prove the
  // ticker is registered, but not that it actually flips a row's
  // visual state when it fires. This test is the positive
  // counterpart: render with a rumoured row 30s before the 60s
  // boundary, advance fake timers past the boundary, assert the
  // row's visual state has flipped from rumoured (vote buttons
  // visible) to confirmed (vote buttons gone, NumberSlot renders
  // the plain position number).
  //
  // The 👍 vote button (`<NumberSlot>`'s `confirmAriaLabel`-tagged
  // button) is the queryable signal: it only renders for rumoured
  // rows. With useTranslations mocked to return keys verbatim, the
  // aria-label resolves to the literal "confirmAria" string — a
  // stable selector across i18n changes.
  it("flips a rumoured row to confirmed visual state after the ticker fires past the 60s boundary", () => {
    vi.useFakeTimers();
    try {
      // 59s before now — under the 60s threshold at render time, but
      // crosses past 60s after one ticker fire.
      const now = new Date();
      const justBeforeBoundary = makeItem({
        status: "rumoured",
        createdAt: new Date(now.getTime() - 59_000).toISOString(),
      });

      render(
        <ActualSetlist
          items={[justBeforeBoundary]}
          reactionCounts={{}}
          locale="ko"
          eventId="1"
          status="ongoing"
        />,
      );

      // Initial render: rumoured → vote buttons present.
      expect(
        screen.queryByRole("button", { name: "confirmAria" }),
      ).not.toBeNull();

      // Advance one ticker cadence + a tiny safety margin past the
      // 60s boundary. After this, getConfirmStatus's `now`-read on
      // re-render sees ≥ 60s elapsed → returns "confirmed" →
      // NumberSlot renders the plain number, vote buttons gone.
      act(() => {
        vi.advanceTimersByTime(AUTO_CONFIRM_TICK_MS);
      });

      expect(screen.queryByRole("button", { name: "confirmAria" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
