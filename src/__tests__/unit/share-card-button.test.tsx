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
    createdAt: "2026-05-23T12:00:00.000Z",
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
  it("renders nothing when status === upcoming (pre-show, nothing to share)", () => {
    const { container } = render(
      <ShareCardButton
        eventId="1"
        seriesName="Test"
        locale="ko"
        status="upcoming"
        actualSongs={[]}
        predictions={[entry(10)]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when predictions is empty (no payload to share, regardless of status)", () => {
    const { container } = render(
      <ShareCardButton
        eventId="1"
        seriesName="Test"
        locale="ko"
        status="ongoing"
        actualSongs={[actual(10)]}
        predictions={[]}
      />,
    );
    expect(container.firstChild).toBeNull();

    const { container: c2 } = render(
      <ShareCardButton
        eventId="1"
        seriesName="Test"
        locale="ko"
        status="completed"
        actualSongs={[actual(10)]}
        predictions={[]}
      />,
    );
    expect(c2.firstChild).toBeNull();
  });

  it("renders nothing when status === completed but actualSongs is empty (no scoreable result)", () => {
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

  it("renders the button DISABLED with a hint when status === ongoing and the user has predictions", () => {
    render(
      <ShareCardButton
        eventId="1"
        seriesName="Test"
        locale="ko"
        status="ongoing"
        actualSongs={[actual(10)]}
        predictions={[entry(10)]}
      />,
    );
    const btn = screen.getByRole("button", { name: "shareButton" });
    expect(btn).toBeTruthy();
    // `disabled` HTML attribute renders as the empty string in jsdom.
    expect(btn.getAttribute("disabled")).not.toBeNull();
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    // The hint sits next to the button so users learn the affordance
    // exists before the show ends.
    expect(screen.getByText("shareDisabled")).toBeTruthy();
  });

  it("renders the button ENABLED (no hint) when all three gates pass", () => {
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
    const btn = screen.getByRole("button", { name: "shareButton" });
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("disabled")).toBeNull();
    expect(btn.getAttribute("aria-disabled")).toBe("false");
    // Hint should NOT render in the enabled path.
    expect(screen.queryByText("shareDisabled")).toBeNull();
  });
});
