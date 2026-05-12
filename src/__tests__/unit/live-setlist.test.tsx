import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock heavy children to no-op renderers that emit testids — this
// test only cares about `<LiveSetlist>`'s top-level render-condition
// logic for the wishlist surface (was: `isWishPredictOpen` alone,
// which incorrectly hid the locked TOP-3 on every ongoing/completed
// event; v0.10.1 fix splits the condition by status). The full
// EventWishSection / SetlistSection / TrendingSongs render paths
// are exercised in their own test files.
vi.mock("@/components/EventWishSection", () => ({
  EventWishSection: () => <div data-testid="event-wish-section" />,
}));
vi.mock("@/components/SetlistSection", () => ({
  SetlistSection: () => <div data-testid="setlist-section" />,
}));
vi.mock("@/components/TrendingSongs", () => ({
  TrendingSongs: () => <div data-testid="trending-songs" />,
}));

// `<LiveSetlist>` re-derives `trendingSongs` from items+reactionCounts
// when `isOngoing`, falling back to `initialTrendingSongs` otherwise.
// Default stub returns [] so the non-ongoing branches of these tests
// can pin gate behavior via the `initialTrendingSongs` prop alone
// (no need to fabricate items+reactionCounts fixtures every test).
// The "ongoing + non-empty" case overrides this stub per-test.
vi.mock("@/lib/trending", () => ({
  deriveTrendingSongs: vi.fn(() => []),
}));
import { deriveTrendingSongs } from "@/lib/trending";

import { LiveSetlist } from "@/components/LiveSetlist";
import type {
  LiveSetlistItem,
  ReactionCountsMap,
  FanTop3Entry,
} from "@/lib/types/setlist";
import type { TrendingSong } from "@/components/TrendingSongs";
import type { ResolvedEventStatus } from "@/lib/eventStatus";

interface RenderArgs {
  status: ResolvedEventStatus;
  isWishPredictOpen: boolean;
  startTime?: Date | string | null;
  top3Wishes?: FanTop3Entry[];
  initialTrendingSongs?: TrendingSong[];
}

function trendingFixture(setlistItemId = "1"): TrendingSong {
  return {
    setlistItemId,
    mainTitle: "残陽",
    subTitle: null,
    variantLabel: null,
    totalReactions: 5,
    reactionCounts: { best: 5 },
  };
}

function renderLiveSetlist({
  status,
  isWishPredictOpen,
  startTime = new Date("2026-05-23T12:00:00.000Z"),
  top3Wishes = [],
  initialTrendingSongs = [],
}: RenderArgs) {
  const items: LiveSetlistItem[] = [];
  const reactionCounts: ReactionCountsMap = {};
  return render(
    <LiveSetlist
      eventId="1"
      items={items}
      reactionCounts={reactionCounts}
      top3Wishes={top3Wishes}
      initialTrendingSongs={initialTrendingSongs}
      startTime={startTime}
      unknownSongLabel="unknown"
      isOngoing={status === "ongoing"}
      locale="ko"
      status={status}
      isWishPredictOpen={isWishPredictOpen}
      seriesName="Test Series"
      eventTitle="Test Event"
      dateLine="2026-05-23"
    />,
  );
}

describe("<LiveSetlist> wishlist render-condition", () => {
  // The bug fix landing on this branch: pre-v0.10.1 the wishlist
  // section gated unconditionally on `isWishPredictOpen`, which
  // returns false for any non-upcoming status by design — so an
  // ongoing event with wishes already entered hid the locked TOP-3
  // display entirely. Per `task-week2-d7-open-gate.md`, the D-7
  // gate is **pre-show only**; ongoing/completed events should
  // render the wishlist whenever there's data (or the component
  // self-collapses to null if locked + no data).
  //
  // The four (status × isWishPredictOpen) cells below pin the
  // corrected matrix:
  //
  //                       isWishPredictOpen=true   isWishPredictOpen=false
  //   status=upcoming     render                   hide  (pre-D-7)
  //   status=ongoing      render                   render  ← was hiding
  //   status=completed    render                   render  ← was hiding
  //   status=cancelled    render                   render  ← was hiding

  it("upcoming + isWishPredictOpen=true → renders the wishlist", () => {
    renderLiveSetlist({ status: "upcoming", isWishPredictOpen: true });
    expect(screen.getByTestId("event-wish-section")).toBeTruthy();
  });

  it("upcoming + isWishPredictOpen=false → hides the wishlist (pre-D-7 gate active)", () => {
    renderLiveSetlist({ status: "upcoming", isWishPredictOpen: false });
    expect(screen.queryByTestId("event-wish-section")).toBeNull();
  });

  it("ongoing + isWishPredictOpen=false → still renders the wishlist (regression: v0.10.0 hid this incorrectly)", () => {
    // The user-reported bug: "wish song tab does not show up in
    // ongoing event ... I was able to enter wish song before the
    // event, but ongoing event didn't show it even it is not
    // empty." `isWishPredictOpen` returns false on every
    // non-upcoming status — gating on it alone broke the locked
    // TOP-3 display.
    renderLiveSetlist({
      status: "ongoing",
      isWishPredictOpen: false,
      top3Wishes: [
        {
          count: 5,
          song: {
            id: 10,
            originalTitle: "残陽",
            originalLanguage: "ja",
            variantLabel: null,
            baseVersionId: null,
            translations: [],
          },
        },
      ],
    });
    expect(screen.getByTestId("event-wish-section")).toBeTruthy();
  });

  it("completed + isWishPredictOpen=false → still renders the wishlist (post-show TOP-3 + match badges)", () => {
    renderLiveSetlist({ status: "completed", isWishPredictOpen: false });
    expect(screen.getByTestId("event-wish-section")).toBeTruthy();
  });

  it("cancelled + isWishPredictOpen=false → still renders (the wishlist component itself decides further)", () => {
    // Cancelled is the rare case — operator-set, no actual show.
    // We let `<EventWishSection>` decide whether to collapse to
    // null (its own `isLocked && !hasData` rule covers the empty
    // case); `<LiveSetlist>` shouldn't blanket-hide on cancelled
    // any more than on completed.
    renderLiveSetlist({ status: "cancelled", isWishPredictOpen: false });
    expect(screen.getByTestId("event-wish-section")).toBeTruthy();
  });

  it("startTime=null hides the wishlist on every status (TBA event, no anchor)", () => {
    // The startTime guard isn't part of the D-7 gate fix per se,
    // but it's a load-bearing prerequisite — the wishlist needs a
    // start anchor to render its lock-flip ticker. A TBA event
    // (`startTime: null`) renders nothing regardless of status or
    // gate state.
    for (const status of [
      "upcoming",
      "ongoing",
      "completed",
      "cancelled",
    ] as const) {
      const view = renderLiveSetlist({
        status,
        isWishPredictOpen: status === "upcoming",
        startTime: null,
      });
      expect(view.queryByTestId("event-wish-section")).toBeNull();
      view.unmount();
    }
  });
});

describe("<LiveSetlist> trending render-condition", () => {
  // v0.10.0 smoke ask (operator preference): hide the trending box
  // entirely on upcoming events (no reactions can exist pre-show
  // anyway), and on ongoing/completed/cancelled hide when empty
  // rather than rendering the empty-state nudge. Reverses the
  // earlier "always render with empty nudge" rationale documented
  // in <TrendingSongs> itself; the component contract stays the
  // same, the visibility decision moves to the parent.
  //
  //                       songs.length=0    songs.length>0
  //   status=upcoming     hide              hide  ← never show pre-show
  //   status=ongoing      hide              show
  //   status=completed    hide              show
  //   status=cancelled    hide              show

  it("upcoming + empty → hides trending", () => {
    renderLiveSetlist({ status: "upcoming", isWishPredictOpen: true });
    expect(screen.queryByTestId("trending-songs")).toBeNull();
  });

  it("upcoming + non-empty → STILL hides trending (pre-show, never)", () => {
    // Edge case: a stale SSR seed could in principle carry songs
    // for an event that's now classified upcoming (manual operator
    // status reset, etc.). The gate suppresses regardless of seed
    // contents — the operator-stated rule is "no trending pre-show",
    // period.
    renderLiveSetlist({
      status: "upcoming",
      isWishPredictOpen: true,
      initialTrendingSongs: [trendingFixture()],
    });
    expect(screen.queryByTestId("trending-songs")).toBeNull();
  });

  it("ongoing + empty → hides trending (no empty-state nudge)", () => {
    // The component's empty-state nudge ("trendingEmpty" label)
    // never reaches the page anymore for the live event surface.
    renderLiveSetlist({
      status: "ongoing",
      isWishPredictOpen: false,
      initialTrendingSongs: [],
    });
    expect(screen.queryByTestId("trending-songs")).toBeNull();
  });

  it("ongoing + non-empty (via live derivation) → renders trending", () => {
    // Ongoing events re-derive from items+reactionCounts via
    // `deriveTrendingSongs` rather than reading `initialTrendingSongs`,
    // so this test stubs the derivation to a non-empty result and
    // restores afterward. Mirrors what happens in production once a
    // poll cycle delivers reactions on a live setlist row.
    vi.mocked(deriveTrendingSongs).mockReturnValueOnce([trendingFixture()]);
    renderLiveSetlist({
      status: "ongoing",
      isWishPredictOpen: false,
    });
    expect(screen.getByTestId("trending-songs")).toBeTruthy();
  });

  it("completed + empty → hides trending", () => {
    renderLiveSetlist({
      status: "completed",
      isWishPredictOpen: false,
      initialTrendingSongs: [],
    });
    expect(screen.queryByTestId("trending-songs")).toBeNull();
  });

  it("completed + non-empty → renders trending", () => {
    renderLiveSetlist({
      status: "completed",
      isWishPredictOpen: false,
      initialTrendingSongs: [trendingFixture()],
    });
    expect(screen.getByTestId("trending-songs")).toBeTruthy();
  });

  it("cancelled + non-empty → renders trending (rare but symmetric with completed)", () => {
    // Cancelled events can carry reactions if the operator entered
    // a partial setlist before cancelling; symmetry with completed
    // means we don't blanket-hide.
    renderLiveSetlist({
      status: "cancelled",
      isWishPredictOpen: false,
      initialTrendingSongs: [trendingFixture()],
    });
    expect(screen.getByTestId("trending-songs")).toBeTruthy();
  });
});
