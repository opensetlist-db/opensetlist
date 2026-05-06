import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { ShareCardButton } from "@/components/ShareCardButton";
import type { PredictionEntry } from "@/lib/predictionsStorage";
import type { SongMatchInputItem } from "@/lib/songMatch";
import type { WishSongDisplay } from "@/lib/wishStorage";

const SAMPLE_SONG: WishSongDisplay = {
  originalTitle: "x",
  originalLanguage: "ja",
  variantLabel: null,
  baseVersionId: null,
  translations: [],
};

function entry(songId: number): PredictionEntry {
  return { songId, song: SAMPLE_SONG };
}

function actual(songId: number): SongMatchInputItem & { id: number } {
  return {
    id: songId,
    songs: [{ song: { id: songId, baseVersionId: null } }],
  };
}

describe("ShareCardButton — display gates", () => {
  it("renders nothing when status !== completed", () => {
    const { container } = render(
      <ShareCardButton
        eventId="1"
        seriesName="Test"
        locale="ko"
        status="ongoing"
        actualSongs={[actual(10)]}
        predictions={[entry(10)]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when actualSongs is empty (status completed)", () => {
    const { container } = render(
      <ShareCardButton
        eventId="1"
        seriesName="Test"
        locale="ko"
        status="completed"
        actualSongs={[]}
        predictions={[entry(10)]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when predictions is empty (status completed)", () => {
    const { container } = render(
      <ShareCardButton
        eventId="1"
        seriesName="Test"
        locale="ko"
        status="completed"
        actualSongs={[actual(10)]}
        predictions={[]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the share button when all three gates pass", () => {
    render(
      <ShareCardButton
        eventId="1"
        seriesName="Test"
        locale="ko"
        status="completed"
        actualSongs={[actual(10)]}
        predictions={[entry(10)]}
      />,
    );
    // Button label uses the i18n key value (mock returns the key).
    expect(screen.getByRole("button", { name: "shareButton" })).toBeTruthy();
  });
});
