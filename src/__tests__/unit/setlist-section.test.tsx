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
  it("case 4 (no predictions, has actual): no tab strip; only ActualSetlist body", () => {
    render(
      <SetlistSection
        eventId="1"
        items={[makeItem()]}
        reactionCounts={{}}
        locale="ko"
      />,
    );
    expect(screen.queryByRole("tablist")).toBeNull();
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
      />,
    );
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "tabActual" })).toBeNull();
    expect(screen.getByRole("tab", { name: /tabPredicted/ })).toBeTruthy();
    // PredictedSetlist's coming-soon copy renders.
    expect(screen.getByText("predictedComingSoon")).toBeTruthy();
  });

  it("case 2 (predictions + actual): both tabs; defaults to Actual; tap Predicted swaps body", () => {
    window.localStorage.setItem("predict-1", JSON.stringify({ slots: [] }));
    render(
      <SetlistSection
        eventId="1"
        items={[makeItem()]}
        reactionCounts={{}}
        locale="ko"
      />,
    );
    const actualTab = screen.getByRole("tab", { name: "tabActual" });
    const predictedTab = screen.getByRole("tab", { name: /tabPredicted/ });
    expect(actualTab.getAttribute("aria-selected")).toBe("true");
    expect(predictedTab.getAttribute("aria-selected")).toBe("false");
    // Body shows ActualSetlist (the <ol> of rows).
    expect(screen.getByRole("list")).toBeTruthy();
    expect(screen.queryByText("predictedComingSoon")).toBeNull();

    fireEvent.click(predictedTab);
    expect(actualTab.getAttribute("aria-selected")).toBe("false");
    expect(predictedTab.getAttribute("aria-selected")).toBe("true");
    // Body swaps to PredictedSetlist placeholder.
    expect(screen.getByText("predictedComingSoon")).toBeTruthy();
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
      />,
    );
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("list")).toBeTruthy();
  });
});
