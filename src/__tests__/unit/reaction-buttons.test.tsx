import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactionButtons } from "@/components/ReactionButtons";

// Minimal next-intl stub — title is the only prop ReactionButtons reads, and
// it's only used as a button `title` attribute, so identity-mapping is fine.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Force "mounted" path so the component runs the hydration branch like it
// would in a real browser. Doesn't affect the prev-prop count sync, which is
// tested independently below.
vi.mock("@/hooks/useMounted", () => ({
  useMounted: () => true,
}));

describe("ReactionButtons", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("re-syncs displayed counts when initialCounts prop reference changes (the polling fix)", () => {
    const { rerender } = render(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={{ best: 1 }}
      />,
    );

    // Per the REACTIONS list, 🔥 is the "best" reaction. ReactionButtons
    // renders the count as a sibling text node only when count > 0.
    const fireButton = screen.getByTitle("best");
    expect(fireButton.textContent).toContain("1");

    // Simulate a polling tick: parent passes a brand-new map with a higher
    // count. Before the fix, this stayed at 1 until remount.
    rerender(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={{ best: 5 }}
      />,
    );
    expect(screen.getByTitle("best").textContent).toContain("5");
  });

  it("does not show a count when prop drops to 0 (count-zero hidden by component)", () => {
    const { rerender } = render(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={{ best: 3 }}
      />,
    );
    expect(screen.getByTitle("best").textContent).toContain("3");

    rerender(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={{ best: 0 }}
      />,
    );
    // Component renders the count span only when `count > 0`, so the count
    // text disappears entirely once the polling response zeroes out.
    expect(screen.getByTitle("best").textContent).not.toMatch(/\d/);
  });

  it("preserves displayed count when re-rendered with same prop reference (no thrash)", () => {
    const stableCounts = { best: 7 };
    const { rerender } = render(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={stableCounts}
      />,
    );
    expect(screen.getByTitle("best").textContent).toContain("7");

    // Re-render with the same object reference — guard should bail out and
    // leave local state intact. (If we'd written `useState(initialCounts)`
    // and copied via useEffect, this would also hold; the guard's value is
    // visible in the prev test where the reference DOES change.)
    rerender(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={stableCounts}
      />,
    );
    expect(screen.getByTitle("best").textContent).toContain("7");
  });
});
