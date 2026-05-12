import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import {
  ShareCardButton,
  deriveShareCardMode,
} from "@/components/ShareCardButton";
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

describe("deriveShareCardMode — pure function", () => {
  it("upcoming → prediction (regardless of actuals — upcoming events can't have any)", () => {
    expect(deriveShareCardMode("upcoming", false)).toBe("prediction");
    expect(deriveShareCardMode("upcoming", true)).toBe("prediction");
  });

  it("ongoing with no actuals yet → prediction (operator hasn't started entering)", () => {
    expect(deriveShareCardMode("ongoing", false)).toBe("prediction");
  });

  it("ongoing with at least one actual → live (mid-flight with partial result)", () => {
    expect(deriveShareCardMode("ongoing", true)).toBe("live");
  });

  it("completed → final (regardless of actuals — defaults to final layout)", () => {
    expect(deriveShareCardMode("completed", true)).toBe("final");
    expect(deriveShareCardMode("completed", false)).toBe("final");
  });

  it("cancelled with actuals → final (the partial setlist that was played still has meaning)", () => {
    expect(deriveShareCardMode("cancelled", true)).toBe("final");
  });

  it("cancelled without actuals → prediction (the show never produced data to compare against)", () => {
    expect(deriveShareCardMode("cancelled", false)).toBe("prediction");
  });
});

describe("ShareCardButton — display gates", () => {
  it("renders nothing when predictions is empty (no payload to share, regardless of status)", () => {
    for (const status of ["upcoming", "ongoing", "completed"] as const) {
      const { container } = render(
        <ShareCardButton
          eventId="1"
          seriesName="Test"
          locale="ko"
          status={status}
          actualSongs={[actual(10)]}
          predictions={[]}
        />,
      );
      expect(container.firstChild).toBeNull();
    }
  });

  it("upcoming + has predictions → renders the button enabled with the prediction label", () => {
    render(
      <ShareCardButton
        eventId="1"
        seriesName="Test"
        locale="ko"
        status="upcoming"
        actualSongs={[]}
        predictions={[entry(10)]}
      />,
    );
    // v0.11.1-and-earlier returned null here; the pre-show share is
    // the new viral entry point. Button should now render, enabled,
    // with the prediction-specific label.
    const btn = screen.getByRole("button", { name: "shareButtonPrediction" });
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("disabled")).toBeNull();
    // The "공연 종료 후 활성화됩니다" hint that v0.10.2 introduced is
    // gone — the button is enabled in every lifecycle stage now.
    expect(screen.queryByText("shareDisabled")).toBeNull();
  });

  it("ongoing + has actuals + has predictions → button enabled with the result label (live mode)", () => {
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
    // Same `shareButton` label as completed — the difference between
    // live and final modes is in the card's LIVE pill, not the button
    // text (the user is sharing the same "result" surface).
    const btn = screen.getByRole("button", { name: "shareButton" });
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("disabled")).toBeNull();
    expect(screen.queryByText("shareDisabled")).toBeNull();
    // Prediction-mode label must NOT also appear — only one button
    // is rendered.
    expect(
      screen.queryByRole("button", { name: "shareButtonPrediction" }),
    ).toBeNull();
  });

  it("ongoing + no actuals yet + has predictions → button enabled with the prediction label", () => {
    render(
      <ShareCardButton
        eventId="1"
        seriesName="Test"
        locale="ko"
        status="ongoing"
        actualSongs={[]}
        predictions={[entry(10)]}
      />,
    );
    // The operator hasn't entered any songs yet during the show, so
    // we fall back to the prediction layout. Without this, the card
    // would render an empty result body with a 0/0 score, which
    // reads as broken rather than mid-flight.
    expect(
      screen.getByRole("button", { name: "shareButtonPrediction" }),
    ).toBeTruthy();
  });

  it("completed + has actuals + has predictions → button enabled with the result label (final mode)", () => {
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
  });

  it("completed + no actuals + has predictions → button STILL renders (final-mode card with empty result body)", () => {
    // Edge case: completed event but the operator never entered a
    // setlist. v0.11.1-and-earlier returned null here. The new mode
    // derivation routes this to `final` mode regardless. We keep the
    // button visible — the user predicted something, so they have a
    // shareable payload (the result card just shows 0/N). Hiding it
    // would silently swallow the prediction.
    render(
      <ShareCardButton
        eventId="1"
        seriesName="Test"
        locale="ko"
        status="completed"
        actualSongs={[]}
        predictions={[entry(10)]}
      />,
    );
    expect(
      screen.getByRole("button", { name: "shareButton" }),
    ).toBeTruthy();
  });
});
