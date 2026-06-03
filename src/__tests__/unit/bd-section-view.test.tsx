import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { FireBdSectionView } from "@/components/FireBdSectionView";
import { trackBdSectionView } from "@/lib/analytics";

vi.mock("@/lib/analytics", () => ({
  trackBdSectionView: vi.fn(),
}));

const mockTrack = vi.mocked(trackBdSectionView);

afterEach(() => {
  vi.clearAllMocks();
});

const props = {
  eventId: "123",
  albumId: "42",
  bdState: "bd-released",
  topBonusCount: 0,
};

describe("FireBdSectionView", () => {
  it("fires bd_section_view exactly once on mount with its props", () => {
    const { container } = render(<FireBdSectionView {...props} />);
    expect(container).toBeEmptyDOMElement();
    expect(mockTrack).toHaveBeenCalledOnce();
    expect(mockTrack).toHaveBeenCalledWith(props);
  });

  it("does not re-fire on a same-props re-render", () => {
    const { rerender } = render(<FireBdSectionView {...props} />);
    rerender(<FireBdSectionView {...props} />);
    expect(mockTrack).toHaveBeenCalledOnce();
  });

  it("re-fires when the event changes under a persisted instance (soft nav)", () => {
    const { rerender } = render(<FireBdSectionView {...props} />);
    rerender(
      <FireBdSectionView
        {...props}
        eventId="456"
        albumId="99"
        bdState="bd-preorder-open"
        topBonusCount={3}
      />,
    );
    expect(mockTrack).toHaveBeenCalledTimes(2);
    expect(mockTrack).toHaveBeenLastCalledWith({
      eventId: "456",
      albumId: "99",
      bdState: "bd-preorder-open",
      topBonusCount: 3,
    });
  });
});
