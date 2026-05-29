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

describe("FireBdSectionView", () => {
  it("fires bd_section_view exactly once on mount with its props", () => {
    const { container } = render(
      <FireBdSectionView
        eventId="123"
        albumId="42"
        bdState="bd-released"
        topBonusCount={0}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(mockTrack).toHaveBeenCalledOnce();
    expect(mockTrack).toHaveBeenCalledWith({
      eventId: "123",
      albumId: "42",
      bdState: "bd-released",
      topBonusCount: 0,
    });
  });
});
