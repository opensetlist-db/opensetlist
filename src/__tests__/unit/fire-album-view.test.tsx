import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { FireAlbumView } from "@/components/FireAlbumView";
import { trackAlbumView } from "@/lib/analytics";

vi.mock("@/lib/analytics", () => ({
  trackAlbumView: vi.fn(),
}));

const mockTrack = vi.mocked(trackAlbumView);

afterEach(() => {
  vi.clearAllMocks();
});

describe("FireAlbumView", () => {
  it("fires album_view exactly once on mount with its props", () => {
    const { container } = render(
      <FireAlbumView
        albumId="42"
        albumType="album"
        artistId="7"
        locale="ja"
        hasAmazonListing={false}
      />,
    );
    // Renders nothing.
    expect(container).toBeEmptyDOMElement();
    expect(mockTrack).toHaveBeenCalledOnce();
    expect(mockTrack).toHaveBeenCalledWith({
      albumId: "42",
      albumType: "album",
      artistId: "7",
      locale: "ja",
      hasAmazonListing: false,
    });
  });
});
