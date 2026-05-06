import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SetlistTabs } from "@/components/SetlistTabs";

const LABELS = { actual: "ACTUAL", predicted: "PREDICTED" };

describe("SetlistTabs visibility matrix", () => {
  it("case 3+4: no predictions → renders nothing", () => {
    const { container } = render(
      <SetlistTabs
        hasPredictions={false}
        hasActual={true}
        activeTab="actual"
        onTabChange={vi.fn()}
        labels={LABELS}
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
