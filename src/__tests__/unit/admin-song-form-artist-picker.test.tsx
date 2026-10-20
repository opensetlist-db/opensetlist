import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import SongForm from "@/app/admin/songs/SongForm";

const baseInitial = {
  id: 43,
  originalTitle: "ツバサ・ラ・リベルテ",
  originalLanguage: "ja",
  variantLabel: null,
  sourceNote: null,
  releaseDate: null,
  baseVersionId: null,
  translations: [{ locale: "ko", title: "츠바사 라 리베르테" }],
};

function mockArtists(list: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ json: () => Promise.resolve(list) }),
  );
}

// The credit <select> must display the artist the song is actually
// credited to. When that artist was missing from the fetched options,
// the browser showed the first option instead (prod song 43 displayed
// 스쿨 아이돌 뮤지컬 while credited to 蓮ノ空), and touching the select
// re-credited the song on save.
describe("SongForm artist credit picker", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("shows the credited artist when it is in the list", async () => {
    mockArtists([
      { id: 107, translations: [{ locale: "ko", name: "스쿨 아이돌 뮤지컬" }] },
      { id: 1, translations: [{ locale: "ko", name: "하스노소라" }] },
    ]);
    render(
      <SongForm
        initialData={{
          ...baseInitial,
          artistCredits: [{ artistId: 1, role: "primary" }],
        }}
      />,
    );
    await screen.findByRole("option", { name: "하스노소라" });
    const select = screen.getAllByRole("combobox")
      .find((el) => (el as HTMLSelectElement).value === "1") as HTMLSelectElement;
    expect(select.selectedOptions[0].textContent).toBe("하스노소라");
  });

  it("keeps a labelled option for a credited artist missing from the list", async () => {
    mockArtists([
      { id: 107, translations: [{ locale: "ko", name: "스쿨 아이돌 뮤지컬" }] },
    ]);
    render(
      <SongForm
        initialData={{
          ...baseInitial,
          artistCredits: [
            { artistId: 1, role: "primary", artistName: "하스노소라" },
          ],
        }}
      />,
    );
    await screen.findByRole("option", { name: "스쿨 아이돌 뮤지컬" });
    const select = screen.getAllByRole("combobox")
      .find((el) => (el as HTMLSelectElement).value === "1") as HTMLSelectElement;
    expect(select).toBeDefined();
    expect(select.selectedOptions[0].textContent).toContain("하스노소라");
  });

  it("survives an error body from the artists endpoint", async () => {
    mockArtists({ error: "db down" });
    render(
      <SongForm
        initialData={{
          ...baseInitial,
          artistCredits: [{ artistId: 1, role: "primary" }],
        }}
      />,
    );
    await waitFor(() => {
      const select = screen.getAllByRole("combobox")
        .find((el) => (el as HTMLSelectElement).value === "1") as HTMLSelectElement;
      expect(select.selectedOptions[0].textContent).toContain("ID: 1");
    });
  });
});
