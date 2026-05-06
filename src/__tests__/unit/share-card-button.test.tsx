import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { ShareCardButton } from "@/components/ShareCardButton";
import type { PredictionEntry } from "@/lib/predictionsStorage";
import type { LiveSetlistItem } from "@/lib/types/setlist";
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

function actual(songId: number): LiveSetlistItem {
  return {
    id: songId,
    position: songId,
    isEncore: false,
    stageType: "full_group",
    unitName: null,
    status: "confirmed",
    performanceType: "live_performance",
    type: "song",
    songs: [
      {
        song: {
          id: songId,
          slug: `s-${songId}`,
          originalTitle: "x",
          originalLanguage: "ja",
          variantLabel: null,
          baseVersionId: null,
          translations: [],
          artists: [],
        },
      },
    ],
    performers: [],
    artists: [],
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
