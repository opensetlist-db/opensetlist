import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SetlistTabs } from "@/components/SetlistTabs";

const LABELS = {
  actual: "ACTUAL",
  predicted: "PREDICTED",
  tablistAriaLabel: "TABLIST",
};
const TAB_IDS = { actual: "tab-a", predicted: "tab-p" };
const PANEL_IDS = { actual: "panel-a", predicted: "panel-p" };

describe("SetlistTabs visibility matrix", () => {
  it("case 3+4: no predictions → renders nothing", () => {
    const { container } = render(
      <SetlistTabs
        hasPredictions={false}
        hasActual={true}
        activeTab="actual"
        onTabChange={vi.fn()}
        labels={LABELS}
        tabIds={TAB_IDS}
        panelIds={PANEL_IDS}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("case 3+4: no predictions + no actual → still renders nothing", () => {
    const { container } = render(
      <SetlistTabs
        hasPredictions={false}
        hasActual={false}
        activeTab="actual"
        onTabChange={vi.fn()}
        labels={LABELS}
        tabIds={TAB_IDS}
        panelIds={PANEL_IDS}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("case 1: predictions + no actual → predicted tab only (actual hidden)", () => {
    render(
      <SetlistTabs
        hasPredictions={true}
        hasActual={false}
        activeTab="predicted"
        onTabChange={vi.fn()}
        labels={LABELS}
        tabIds={TAB_IDS}
        panelIds={PANEL_IDS}
      />,
    );
    expect(screen.queryByText("ACTUAL")).toBeNull();
    expect(screen.getByText("PREDICTED")).toBeTruthy();
  });

  it("case 2: predictions + actual → both tabs render", () => {
    render(
      <SetlistTabs
        hasPredictions={true}
        hasActual={true}
        activeTab="actual"
        onTabChange={vi.fn()}
        labels={LABELS}
        tabIds={TAB_IDS}
        panelIds={PANEL_IDS}
      />,
    );
    expect(screen.getByText("ACTUAL")).toBeTruthy();
    expect(screen.getByText("PREDICTED")).toBeTruthy();
  });
});

describe("SetlistTabs interaction", () => {
  it("active tab carries aria-selected=true; inactive carries false", () => {
    render(
      <SetlistTabs
        hasPredictions={true}
        hasActual={true}
        activeTab="predicted"
        onTabChange={vi.fn()}
        labels={LABELS}
        tabIds={TAB_IDS}
        panelIds={PANEL_IDS}
      />,
    );
    const actualTab = screen.getByRole("tab", { name: "ACTUAL" });
    const predictedTab = screen.getByRole("tab", { name: "PREDICTED" });
    expect(actualTab.getAttribute("aria-selected")).toBe("false");
    expect(predictedTab.getAttribute("aria-selected")).toBe("true");
  });

  it("clicking a tab fires onTabChange with the tab key", () => {
    const onTabChange = vi.fn();
    render(
      <SetlistTabs
        hasPredictions={true}
        hasActual={true}
        activeTab="actual"
        onTabChange={onTabChange}
        labels={LABELS}
        tabIds={TAB_IDS}
        panelIds={PANEL_IDS}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "PREDICTED" }));
    expect(onTabChange).toHaveBeenCalledWith("predicted");
    fireEvent.click(screen.getByRole("tab", { name: "ACTUAL" }));
    expect(onTabChange).toHaveBeenCalledWith("actual");
  });

  it("predictedBadge is rendered next to the Predicted label when provided", () => {
    render(
      <SetlistTabs
        hasPredictions={true}
        hasActual={true}
        activeTab="actual"
        onTabChange={vi.fn()}
        labels={LABELS}
        tabIds={TAB_IDS}
        panelIds={PANEL_IDS}
        predictedBadge={<span data-testid="badge">3/10 🎯</span>}
      />,
    );
    const badge = screen.getByTestId("badge");
    expect(badge.textContent).toBe("3/10 🎯");
    // Badge sits inside the Predicted tab, not the Actual tab.
    const predictedTab = screen.getByRole("tab", { name: /PREDICTED/ });
    expect(predictedTab.contains(badge)).toBe(true);
  });
});

describe("SetlistTabs WAI-ARIA + keyboard navigation", () => {
  function renderBoth(activeTab: "actual" | "predicted" = "actual") {
    const onTabChange = vi.fn();
    const utils = render(
      <SetlistTabs
        hasPredictions={true}
        hasActual={true}
        activeTab={activeTab}
        onTabChange={onTabChange}
        labels={LABELS}
        tabIds={TAB_IDS}
        panelIds={PANEL_IDS}
      />,
    );
    return { ...utils, onTabChange };
  }

  it("tablist carries aria-label from the labels prop", () => {
    renderBoth();
    const tablist = screen.getByRole("tablist", { name: "TABLIST" });
    expect(tablist).toBeTruthy();
  });

  it("each tab carries id + aria-controls pointing at its panel", () => {
    renderBoth();
    const actualTab = screen.getByRole("tab", { name: "ACTUAL" });
    const predictedTab = screen.getByRole("tab", { name: /PREDICTED/ });
    expect(actualTab.id).toBe("tab-a");
    expect(actualTab.getAttribute("aria-controls")).toBe("panel-a");
    expect(predictedTab.id).toBe("tab-p");
    expect(predictedTab.getAttribute("aria-controls")).toBe("panel-p");
  });

  it("roving tabindex: active tab is 0; inactive is -1", () => {
    renderBoth("actual");
    const actualTab = screen.getByRole("tab", { name: "ACTUAL" });
    const predictedTab = screen.getByRole("tab", { name: /PREDICTED/ });
    expect(actualTab.getAttribute("tabindex")).toBe("0");
    expect(predictedTab.getAttribute("tabindex")).toBe("-1");
  });

  it("ArrowRight on active tab cycles to the next tab", () => {
    const { onTabChange } = renderBoth("actual");
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(onTabChange).toHaveBeenCalledWith("predicted");
  });

  it("ArrowLeft on active tab cycles to the previous tab (with wrap-around)", () => {
    const { onTabChange } = renderBoth("actual");
    // From "actual" (idx 0), ArrowLeft wraps to last → "predicted".
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowLeft" });
    expect(onTabChange).toHaveBeenCalledWith("predicted");
  });

  it("Home jumps to the first tab when activeTab is the last", () => {
    const { onTabChange } = renderBoth("predicted");
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "Home" });
    expect(onTabChange).toHaveBeenCalledWith("actual");
  });

  it("End jumps to the last tab when activeTab is the first", () => {
    // Separate render so activeTab starts as "actual"; the parent
    // would re-render with the new activeTab in production, but the
    // test mock just records the call.
    const { onTabChange } = renderBoth("actual");
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "End" });
    expect(onTabChange).toHaveBeenCalledWith("predicted");
  });

  it("Home/End on the already-first/last tab is a no-op (skip when nextTab === activeTab)", () => {
    const { onTabChange } = renderBoth("actual");
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "Home" });
    expect(onTabChange).not.toHaveBeenCalled();
  });

  it("focus moves to the new tab button after keyboard activation (WAI-ARIA roving focus)", async () => {
    // Re-render with the post-keypress activeTab so the ref-based
    // focus call has the right `tabIndex={0}` button to target.
    // The handler uses requestAnimationFrame for the focus call;
    // jsdom resolves it via vi's timer support, but a microtask
    // flush is enough here.
    const { rerender } = render(
      <SetlistTabs
        hasPredictions={true}
        hasActual={true}
        activeTab="actual"
        onTabChange={(next) => {
          rerender(
            <SetlistTabs
              hasPredictions={true}
              hasActual={true}
              activeTab={next}
              onTabChange={() => {}}
              labels={LABELS}
              tabIds={TAB_IDS}
              panelIds={PANEL_IDS}
            />,
          );
        }}
        labels={LABELS}
        tabIds={TAB_IDS}
        panelIds={PANEL_IDS}
      />,
    );
    const actualTab = screen.getByRole("tab", { name: "ACTUAL" });
    actualTab.focus();
    expect(document.activeElement).toBe(actualTab);
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    // Wait one rAF tick for the focus call.
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    const predictedTab = screen.getByRole("tab", { name: /PREDICTED/ });
    expect(document.activeElement).toBe(predictedTab);
  });

  it("ArrowKey is a no-op when only one tab is visible (case 1, predicted-only)", () => {
    const onTabChange = vi.fn();
    render(
      <SetlistTabs
        hasPredictions={true}
        hasActual={false}
        activeTab="predicted"
        onTabChange={onTabChange}
        labels={LABELS}
        tabIds={TAB_IDS}
        panelIds={PANEL_IDS}
      />,
    );
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowLeft" });
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(onTabChange).not.toHaveBeenCalled();
  });
});
