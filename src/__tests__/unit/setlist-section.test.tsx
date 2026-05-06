import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks/useMounted", () => ({
  useMounted: () => true,
}));

import { SetlistSection } from "@/components/SetlistSection";
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

beforeEach(() => {
  window.localStorage.clear();
});

describe("SetlistSection", () => {
  it("case 4 (no predictions, has actual): no tab strip; no tabpanel wrapper; only ActualSetlist body", () => {
    render(
      <SetlistSection
        eventId="1"
        items={[makeItem()]}
        reactionCounts={{}}
        locale="ko"
        status="upcoming"
        startTime={null}
        seriesName="Test Series"
        emptyFallback={<p data-testid="empty">empty</p>}
      />,
    );
    expect(screen.queryByRole("tablist")).toBeNull();
    // No `role="tabpanel"` either — would advertise an orphaned
    // panel whose `aria-labelledby` points at a non-existent tab.
    expect(screen.queryByRole("tabpanel")).toBeNull();
    expect(screen.queryByText("predictedComingSoon")).toBeNull();
    // ActualSetlist renders an <ol> + at least one row.
    expect(screen.getByRole("list")).toBeTruthy();
  });

  it("case 1 (predictions, no actual): Predicted-only tab strip; PredictedSetlist body", () => {
    window.localStorage.setItem("predict-1", JSON.stringify({ slots: [] }));
    render(
      <SetlistSection
        eventId="1"
        items={[]}
        reactionCounts={{}}
        locale="ko"
        status="upcoming"
        startTime={null}
        seriesName="Test Series"
        emptyFallback={<p data-testid="empty">empty</p>}
      />,
    );
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "tabActual" })).toBeNull();
    expect(screen.getByRole("tab", { name: /tabPredicted/ })).toBeTruthy();
    // PredictedSetlist (Stage C) renders the pre-show full UI
    // — `+ 곡 추가` link is the load-bearing affordance for it.
    expect(screen.getByText("add")).toBeTruthy();
    expect(screen.getByRole("tabpanel")).toBeTruthy();
    // Empty fallback is NOT rendered — predictions present.
    expect(screen.queryByTestId("empty")).toBeNull();
  });

  it("predictions + no actual + emptyFallback present: the fallback is suppressed in favor of the Predicted tab body", () => {
    // Same as case 1 above but explicit assertion that the
    // emptyFallback prop is intentionally ignored when predictions
    // exist — Stage C's case 1 path needs to surface the Predicted
    // tab even with zero actual rows.
    window.localStorage.setItem("predict-1", JSON.stringify({}));
    render(
      <SetlistSection
        eventId="1"
        items={[]}
        reactionCounts={{}}
        locale="ko"
        status="upcoming"
        startTime={null}
        seriesName="Test Series"
        emptyFallback={<p data-testid="empty">empty</p>}
      />,
    );
    expect(screen.queryByTestId("empty")).toBeNull();
    // PredictedSetlist (Stage C) renders the pre-show full UI.
    expect(screen.getByText("add")).toBeTruthy();
  });

  it("no predictions + no actual: emptyFallback renders; no tabs, no tabpanel", () => {
    render(
      <SetlistSection
        eventId="1"
        items={[]}
        reactionCounts={{}}
        locale="ko"
        status="upcoming"
        startTime={null}
        seriesName="Test Series"
        emptyFallback={<p data-testid="empty">empty</p>}
      />,
    );
    expect(screen.getByTestId("empty")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();
  });

  it("case 2 (predictions + actual): both tabs; defaults to Actual; tap Predicted swaps body", () => {
    window.localStorage.setItem("predict-1", JSON.stringify({ slots: [] }));
    render(
      <SetlistSection
        eventId="1"
        items={[makeItem()]}
        reactionCounts={{}}
        locale="ko"
        status="upcoming"
        startTime={null}
        seriesName="Test Series"
        emptyFallback={<p data-testid="empty">empty</p>}
      />,
    );
    const actualTab = screen.getByRole("tab", { name: "tabActual" });
    const predictedTab = screen.getByRole("tab", { name: /tabPredicted/ });
    expect(actualTab.getAttribute("aria-selected")).toBe("true");
    expect(predictedTab.getAttribute("aria-selected")).toBe("false");
    // Body shows ActualSetlist (the <ol> of rows).
    expect(screen.getByRole("list")).toBeTruthy();
    // Pre-show PredictedSetlist `+ 곡 추가` is not rendered (Actual tab active).
    expect(screen.queryByText("add")).toBeNull();

    fireEvent.click(predictedTab);
    expect(actualTab.getAttribute("aria-selected")).toBe("false");
    expect(predictedTab.getAttribute("aria-selected")).toBe("true");
    // Body swaps to PredictedSetlist (pre-show full UI: `+ 곡 추가`).
    expect(screen.getByText("add")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("edge: corrupt localStorage value falls through to no-tabs (case 4 path)", () => {
    window.localStorage.setItem("predict-1", "not-json{");
    render(
      <SetlistSection
        eventId="1"
        items={[makeItem()]}
        reactionCounts={{}}
        locale="ko"
        status="upcoming"
        startTime={null}
        seriesName="Test Series"
        emptyFallback={<p data-testid="empty">empty</p>}
      />,
    );
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("list")).toBeTruthy();
  });
});
