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

const props = {
  albumId: "42",
  albumType: "album",
  artistId: "7",
  locale: "ja",
  hasAmazonListing: false,
};

describe("FireAlbumView", () => {
  it("fires album_view exactly once on mount with its props", () => {
    const { container } = render(<FireAlbumView {...props} />);
    // Renders nothing.
    expect(container).toBeEmptyDOMElement();
    expect(mockTrack).toHaveBeenCalledOnce();
    expect(mockTrack).toHaveBeenCalledWith(props);
  });

  it("does not re-fire on a same-props re-render (e.g. ?tab= switch)", () => {
    const { rerender } = render(<FireAlbumView {...props} />);
    rerender(<FireAlbumView {...props} />);
    expect(mockTrack).toHaveBeenCalledOnce();
  });

  it("re-fires when the album changes under a persisted instance (soft nav)", () => {
    // App Router soft navigation /albums/42 → /albums/99 keeps the same
    // client instance and only updates props; the param-dep effect must
    // fire again for the second album.
    const { rerender } = render(<FireAlbumView {...props} />);
    rerender(<FireAlbumView {...props} albumId="99" artistId="8" />);
    expect(mockTrack).toHaveBeenCalledTimes(2);
    expect(mockTrack).toHaveBeenLastCalledWith({
      ...props,
      albumId: "99",
      artistId: "8",
    });
  });
});
