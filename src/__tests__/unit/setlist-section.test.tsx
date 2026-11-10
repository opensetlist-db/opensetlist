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
import { writePredictions, clearPredictions } from "@/lib/predictionsStorage";

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
    createdAt: "2026-05-23T12:00:00.000Z",
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

beforeEach(() => {
  window.localStorage.clear();
});

describe("SetlistSection", () => {
  it.each([true, false])("keeps a prediction started this visit through show start only when saved (saved=%s), without leaking it to another event", (saved) => {
    const props = { eventId: "1", items: [], reactionCounts: {}, locale: "ko", startTime: null,
      seriesName: "Test Series", eventTitle: "Test Event", dateLine: "2026-05-23", availableSongs: [], unitFilters: [],
      emptyFallback: <p data-testid="empty">empty</p> };
    const { rerender } = render(<SetlistSection {...props} status="upcoming" isWishPredictOpen={true} />);
    fireEvent.click(screen.getByTestId("predict-start"));
    expect(screen.getByRole("tab", { name: /tabPredicted/ })).toHaveAttribute("aria-selected", "true");
    if (saved) {
      writePredictions("1", [{ songId: 1, song: { originalTitle: "Saved song", originalLanguage: "ja", variantLabel: null, baseVersionId: null, translations: [] } }]);
      // Read the saved list through the UI before testing the phase change.
      fireEvent.click(screen.getByRole("tab", { name: "tabActual" }));
      fireEvent.click(screen.getByRole("tab", { name: /tabPredicted/ }));
      expect(screen.getByText("Saved song")).toBeVisible();
    }
    rerender(<SetlistSection {...props} status="ongoing" isWishPredictOpen={false} items={[makeItem()]} />);
    if (saved) {
      expect(screen.getByRole("tab", { name: /tabPredicted/ })).toBeVisible();
      fireEvent.click(screen.getByRole("tab", { name: /tabPredicted/ }));
      expect(screen.getByText("Saved song")).toBeVisible();
      clearPredictions("1");
      rerender(<SetlistSection {...props} status="ongoing" isWishPredictOpen={false} items={[makeItem()]} />);
      expect(screen.queryByRole("tablist")).toBeNull();
      expect(screen.queryByText("Saved song")).toBeNull();
    } else expect(screen.queryByRole("tablist")).toBeNull();
    rerender(<SetlistSection {...props} eventId="2" status="ongoing" isWishPredictOpen={false} items={[makeItem()]} />);
    expect(screen.queryByRole("tablist")).toBeNull();
    if (saved) expect(screen.queryByText("Saved song")).toBeNull();
  });
  it("case 4 (no predictions, has actual, during/post-show): no tab strip; no tabpanel wrapper; only ActualSetlist body", () => {
    // Status `ongoing` (not upcoming) — upcoming always shows the
    // Predict tab as the entry point per the gate. The "no tabs"
    // path requires status to be past the start.
    render(
      <SetlistSection
        eventId="1"
        items={[makeItem()]}
        reactionCounts={{}}
        locale="ko"
        status="ongoing"
        startTime={null}
        seriesName="Test Series"
        eventTitle="Test Event"
        dateLine="2026-05-23" availableSongs={[]} unitFilters={[]}
        isWishPredictOpen={false}
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

  it("stored prediction, no actual, window open: both tabs, Predicted selected, PredictedSetlist body", () => {
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
        eventTitle="Test Event"
        dateLine="2026-05-23" availableSongs={[]} unitFilters={[]}
        isWishPredictOpen={true}
        emptyFallback={<p data-testid="empty">empty</p>}
      />,
    );
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "tabActual" }).getAttribute("aria-selected"),
    ).toBe("false");
    expect(
      screen.getByRole("tab", { name: /tabPredicted/ }).getAttribute("aria-selected"),
    ).toBe("true");
    // PredictedSetlist (Stage C) renders the pre-show full UI
    // — `+ 곡 추가` link is the load-bearing affordance for it.
    expect(screen.getByText("copyFromPast")).toBeTruthy();
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
        eventTitle="Test Event"
        dateLine="2026-05-23" availableSongs={[]} unitFilters={[]}
        isWishPredictOpen={true}
        emptyFallback={<p data-testid="empty">empty</p>}
      />,
    );
    expect(screen.queryByTestId("empty")).toBeNull();
    // PredictedSetlist (Stage C) renders the pre-show full UI.
    expect(screen.getByText("copyFromPast")).toBeTruthy();
  });

  it("first visitor, window open: the actual body plus a start button; pressing it opens the tabs on Predicted", () => {
    // No stored list: the card shows the "filled in live from …" note
    // (emptyFallback) and the "Make a setlist prediction" button, with
    // no tab strip. The button is the only way into the builder, so a
    // first-time visitor can always start predicting (CR #281).
    render(
      <SetlistSection
        eventId="1"
        items={[]}
        reactionCounts={{}}
        locale="ko"
        status="upcoming"
        startTime={null}
        seriesName="Test Series"
        eventTitle="Test Event"
        dateLine="2026-05-23" availableSongs={[]} unitFilters={[]}
        isWishPredictOpen={true}
        emptyFallback={<p data-testid="empty">empty</p>}
      />,
    );
    expect(screen.getByTestId("empty")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByText("copyFromPast")).toBeNull();

    fireEvent.click(screen.getByTestId("predict-start"));
    expect(screen.queryByTestId("predict-start")).toBeNull();
    expect(
      screen.getByRole("tab", { name: /tabPredicted/ }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByText("copyFromPast")).toBeTruthy();

    // The Actual tab holds the same "filled in live" note.
    fireEvent.click(screen.getByRole("tab", { name: "tabActual" }));
    expect(screen.getByTestId("empty")).toBeTruthy();
  });

  it("no start button outside the window or after the show starts", () => {
    const { rerender } = render(
      <SetlistSection
        eventId="1"
        items={[]}
        reactionCounts={{}}
        locale="ko"
        status="upcoming"
        startTime={null}
        seriesName="Test Series"
        eventTitle="Test Event"
        dateLine="2026-05-23" availableSongs={[]} unitFilters={[]}
        isWishPredictOpen={true}
        emptyFallback={<p data-testid="empty">empty</p>}
      />,
    );
    // Positive control: present inside the window.
    expect(screen.getByTestId("predict-start")).toBeTruthy();
    rerender(
      <SetlistSection
        eventId="1"
        items={[makeItem()]}
        reactionCounts={{}}
        locale="ko"
        status="ongoing"
        startTime={null}
        seriesName="Test Series"
        eventTitle="Test Event"
        dateLine="2026-05-23" availableSongs={[]} unitFilters={[]}
        isWishPredictOpen={false}
        emptyFallback={<p data-testid="empty">empty</p>}
      />,
    );
    expect(screen.queryByTestId("predict-start")).toBeNull();
  });

  it("completed/cancelled event with no actuals + no predictions: emptyFallback renders (no predict tab — nothing to score)", () => {
    // The degenerate case: admin marked event completed but never
    // filled in rows + no user has predicted. Predict tab would be
    // useless (actuals are immutable, no user data to display), so
    // the empty fallback is correct here.
    render(
      <SetlistSection
        eventId="1"
        items={[]}
        reactionCounts={{}}
        locale="ko"
        status="completed"
        startTime={null}
        seriesName="Test Series"
        eventTitle="Test Event"
        dateLine="2026-05-23" availableSongs={[]} unitFilters={[]}
        isWishPredictOpen={false}
        emptyFallback={<p data-testid="empty">empty</p>}
      />,
    );
    expect(screen.getByTestId("empty")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();
  });

  it("stored prediction + actual rows after the start: both tabs, Actual selected; tap Predicted swaps body", () => {
    window.localStorage.setItem("predict-1", JSON.stringify({ slots: [] }));
    render(
      <SetlistSection
        eventId="1"
        items={[makeItem()]}
        reactionCounts={{}}
        locale="ko"
        status="ongoing"
        startTime={null}
        seriesName="Test Series"
        eventTitle="Test Event"
        dateLine="2026-05-23" availableSongs={[]} unitFilters={[]}
        isWishPredictOpen={false}
        emptyFallback={<p data-testid="empty">empty</p>}
      />,
    );
    const actualTab = screen.getByRole("tab", { name: "tabActual" });
    const predictedTab = screen.getByRole("tab", { name: /tabPredicted/ });
    expect(actualTab.getAttribute("aria-selected")).toBe("true");
    expect(predictedTab.getAttribute("aria-selected")).toBe("false");
    // Body shows ActualSetlist (the <ol> of rows).
    expect(screen.getByRole("list")).toBeTruthy();
    expect(screen.queryByText("duringHint")).toBeNull();

    fireEvent.click(predictedTab);
    expect(actualTab.getAttribute("aria-selected")).toBe("false");
    expect(predictedTab.getAttribute("aria-selected")).toBe("true");
    // Body swaps to PredictedSetlist (during-show hint).
    expect(screen.getByText("duringHint")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("edge: corrupt localStorage value falls through to no-tabs (case 4 path; status=ongoing)", () => {
    // Use status=ongoing so the predict-tab gate doesn't show the
    // Predict tab on the "upcoming → always show predict" path.
    // The corrupt localStorage edge should cleanly fall through to
    // hasPredictions=false without a console error.
    window.localStorage.setItem("predict-1", "not-json{");
    render(
      <SetlistSection
        eventId="1"
        items={[makeItem()]}
        reactionCounts={{}}
        locale="ko"
        status="ongoing"
        startTime={null}
        seriesName="Test Series"
        eventTitle="Test Event"
        dateLine="2026-05-23" availableSongs={[]} unitFilters={[]}
        isWishPredictOpen={false}
        emptyFallback={<p data-testid="empty">empty</p>}
      />,
    );
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("list")).toBeTruthy();
  });

  it("D-7 gate (pre-D-7 upcoming, no actual, no stored predictions): emptyFallback renders — predict tab hidden until window opens", () => {
    // Pre-D-7 path: a first-time visitor on an upcoming event 8+
    // days out should NOT see the Predict tab (the `🌸 세트리스트 예상 가능`
    // window hasn't opened yet). The page falls through to
    // `emptyFallback`. Once the event crosses D-7 the gate flips
    // and the existing first-visitor path takes over again.
    render(
      <SetlistSection
        eventId="1"
        items={[]}
        reactionCounts={{}}
        locale="ko"
        status="upcoming"
        startTime={null}
        seriesName="Test Series"
        eventTitle="Test Event"
        dateLine="2026-05-23" availableSongs={[]} unitFilters={[]}
        isWishPredictOpen={false}
        emptyFallback={<p data-testid="empty">empty</p>}
      />,
    );
    expect(screen.getByTestId("empty")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();
    expect(screen.queryByText("add")).toBeNull();
  });

  it("D-7 gate (pre-D-7 upcoming, no actual, WITH stored predictions): tab still hidden — \"keep the data, just don't surface the tab\"", () => {
    // Edge case from `task-week2-d7-open-gate.md`: a user previously
    // predicted while the event was inside the D-7 window, then the
    // operator pushed the event date back past D-7. The localStorage
    // entry stays (no destructive cleanup) but the tab hides — the
    // surface re-opens automatically once the new startTime crosses
    // back inside the window.
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
        eventTitle="Test Event"
        dateLine="2026-05-23" availableSongs={[]} unitFilters={[]}
        isWishPredictOpen={false}
        emptyFallback={<p data-testid="empty">empty</p>}
      />,
    );
    expect(screen.getByTestId("empty")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByText("add")).toBeNull();
  });

  it("D-7 gate is pre-show-only: ongoing event with stored predictions still surfaces the Predicted tab regardless of isWishPredictOpen=false", () => {
    // Once the show is ongoing, the D-7 gate is irrelevant —
    // `isWishPredictOpen` returns false for any non-upcoming status,
    // but the post-show branch of the predict-tab gate (which keys
    // off `storedHasPredictions` only) keeps the user's tab visible
    // through the live-score divider + share-card phases.
    window.localStorage.setItem("predict-1", JSON.stringify({ slots: [] }));
    render(
      <SetlistSection
        eventId="1"
        items={[makeItem()]}
        reactionCounts={{}}
        locale="ko"
        status="ongoing"
        startTime={null}
        seriesName="Test Series"
        eventTitle="Test Event"
        dateLine="2026-05-23" availableSongs={[]} unitFilters={[]}
        isWishPredictOpen={false}
        emptyFallback={<p data-testid="empty">empty</p>}
      />,
    );
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /tabPredicted/ })).toBeTruthy();
  });

  it("renderedTab guard: stale activeTab='predicted' from a prior event with predictions doesn't bleed into a new event with no predictions (CR #291)", () => {
    // Reproduces the cross-event bleed CR caught:
    //   1. Event A has predictions; user clicks Predicted tab →
    //      activeTab = "predicted" (state lives inside SetlistSection,
    //      which doesn't have a key so it persists across event nav).
    //   2. Navigate to event B (no predictions, has actual rows).
    //   3. Without the guard, renderedTab would fall through to the
    //      stale activeTab="predicted", and the body would render
    //      <PredictedSetlist> while <SetlistTabs hasPredictions=false>
    //      renders no tab strip → orphan body, no tab visible.
    //   4. Fix: when !hasPredictions, force renderedTab to "actual"
    //      regardless of stored activeTab.
    //
    // Step 1: render event A with predictions, click Predicted to
    // promote activeTab.
    window.localStorage.setItem("predict-1", JSON.stringify({ slots: [] }));
    const { rerender } = render(
      <SetlistSection
        eventId="1"
        items={[makeItem()]}
        reactionCounts={{}}
        locale="ko"
        status="ongoing"
        startTime={null}
        seriesName="Test Series"
        eventTitle="Test Event"
        dateLine="2026-05-23" availableSongs={[]} unitFilters={[]}
        isWishPredictOpen={false}
        emptyFallback={<p data-testid="empty">empty</p>}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /tabPredicted/ }));
    expect(
      screen
        .getByRole("tab", { name: /tabPredicted/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    // Step 2: navigate to event B — same SetlistSection instance
    // (no key so state persists), new eventId, no localStorage
    // predictions, has actual rows. Re-render simulates the parent
    // (LiveSetlist) re-rendering with new props for a different
    // event in the same browser session.
    rerender(
      <SetlistSection
        eventId="2"
        items={[makeItem({ id: 99 })]}
        reactionCounts={{}}
        locale="ko"
        status="ongoing"
        startTime={null}
        seriesName="Test Series"
        eventTitle="Test Event"
        dateLine="2026-05-23" availableSongs={[]} unitFilters={[]}
        isWishPredictOpen={false}
        emptyFallback={<p data-testid="empty">empty</p>}
      />,
    );
    // No predictions for event 2 → no tab strip should render.
    expect(screen.queryByRole("tablist")).toBeNull();
    // Body must be ActualSetlist (the <ol>), NOT PredictedSetlist
    // (which would have a `+ 곡 추가` button). The guard forces
    // renderedTab → "actual" when !hasPredictions, overriding the
    // stale activeTab="predicted" left over from event 1.
    expect(screen.getByRole("list")).toBeTruthy();
    expect(screen.queryByText("add")).toBeNull();
  });
});
