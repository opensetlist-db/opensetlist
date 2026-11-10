import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TrackedStoreLink } from "@/components/TrackedStoreLink";
import { trackStoreClick } from "@/lib/analytics";

vi.mock("@/lib/analytics", () => ({
  trackStoreClick: vi.fn(),
}));

const mockTrack = vi.mocked(trackStoreClick);

afterEach(() => {
  vi.clearAllMocks();
});

function renderLink() {
  render(
    <TrackedStoreLink
      href="https://example.com/buy"
      albumId="42"
      albumSlug="dream"
      purchaseOption="with_bonus"
      storeKey="amazon_jp"
      storeStatus="active"
      surface="album_page"
      isAffiliate={false}
    >
      buy
    </TrackedStoreLink>,
  );
  return screen.getByText("buy");
}

const expectedParams = {
  albumId: "42",
  albumSlug: "dream",
  purchaseOption: "with_bonus",
  storeKey: "amazon_jp",
  storeStatus: "active",
  surface: "album_page",
  isAffiliate: false,
  bonusId: undefined,
};

describe("TrackedStoreLink", () => {
  it("fires store_click on a left click", () => {
    fireEvent.click(renderLink());
    expect(mockTrack).toHaveBeenCalledOnce();
    expect(mockTrack).toHaveBeenCalledWith(expectedParams);
  });

  it("tracks middle-click navigation and ignores right-click context menus", () => {
    const link = renderLink();
    fireEvent(
      link,
      new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }),
    );
    expect(mockTrack).toHaveBeenCalledOnce();
    expect(mockTrack).toHaveBeenCalledWith(expectedParams);
    fireEvent(
      link,
      new MouseEvent("auxclick", { button: 2, bubbles: true, cancelable: true }),
    );
    expect(mockTrack).toHaveBeenCalledOnce();
  });
});
