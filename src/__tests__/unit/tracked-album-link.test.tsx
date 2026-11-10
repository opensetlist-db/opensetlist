import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TrackedAlbumLink } from "@/components/TrackedAlbumLink";
import { trackAlbumClick } from "@/lib/analytics";

vi.mock("@/lib/analytics", () => ({ trackAlbumClick: vi.fn() }));

describe("TrackedAlbumLink", () => {
  it("tracks navigation clicks once and preserves the anchor", () => {
    render(<TrackedAlbumLink href="/ko/albums/42/dream" albumId="42" albumSlug="dream" surface="event_bd_title" eventId="7" target="_blank" scroll={false} prefetch={false} aria-label="Album">Album</TrackedAlbumLink>);
    const link = screen.getByRole("link", { name: "Album" });
    expect(link.getAttribute("href")).toBe("/ko/albums/42/dream");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(trackAlbumClick).not.toHaveBeenCalled();
    fireEvent.click(link, { button: 0, ctrlKey: true });
    expect(trackAlbumClick).toHaveBeenCalledOnce();
    expect(trackAlbumClick).toHaveBeenCalledWith({ albumId: "42", albumSlug: "dream", surface: "event_bd_title", eventId: "7" });
    fireEvent(link, new MouseEvent("auxclick", { button: 1, bubbles: true }));
    expect(trackAlbumClick).toHaveBeenCalledTimes(2);
    fireEvent(link, new MouseEvent("auxclick", { button: 2, bubbles: true }));
    fireEvent.click(link, { button: 2 });
    expect(trackAlbumClick).toHaveBeenCalledTimes(2);
  });

  it("does not track the already active purchase tab", () => {
    const tab = (active: boolean) => (
      <TrackedAlbumLink
        href="/ko/albums/42/dream?tab=bonus"
        albumId="42"
        albumSlug="dream"
        surface="album_purchase_tab"
        aria-current={active ? "page" : undefined}
      >
        Buy
      </TrackedAlbumLink>
    );
    const { rerender } = render(tab(false));
    const link = screen.getByRole("link", { name: "Buy" });
    fireEvent.click(link, { ctrlKey: true });
    expect(trackAlbumClick).toHaveBeenCalledOnce();
    rerender(tab(true));
    expect(screen.getByRole("link", { name: "Buy" })).toBe(link);
    fireEvent.click(link, { ctrlKey: true });
    expect(trackAlbumClick).toHaveBeenCalledOnce();
  });
});
