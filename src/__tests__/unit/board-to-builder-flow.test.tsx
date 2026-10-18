import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

// The bridge end to end through the real <LiveSetlist> → <SetlistSection>
// → <PredictedSetlist>: tap on the board, land in the builder.

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, values?: Record<string, unknown>) =>
      values ? `${key}(${Object.values(values).join(",")})` : key,
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/components/EventWishSection", () => ({
  EventWishSection: () => null,
}));
vi.mock("@/components/TrendingSongs", () => ({ TrendingSongs: () => null }));
vi.mock("@/hooks/useIsDesktop", () => ({ useIsDesktop: () => false }));
vi.mock("vaul", () => {
  const passthrough = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Drawer: {
      Root: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
        open ? <div>{children}</div> : null,
      Portal: passthrough,
      Overlay: passthrough,
      Content: passthrough,
      Title: passthrough,
    },
  };
});

import { LiveSetlist } from "@/components/LiveSetlist";
import { PredictedSetlist } from "@/components/PredictedSetlist";
import { trackEvent } from "@/lib/analytics";
import { readPredictions, writePredictions } from "@/lib/predictionsStorage";
import type { BoardBlockSeed, BoardGroupView, BoardReadResponse } from "@/lib/board/types";
import type { ResolvedEventStatus } from "@/lib/eventStatus";
import type { AvailableSong } from "@/lib/types/predict";

const LOCK = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
const SEED: BoardBlockSeed = {
  lockAt: LOCK,
  chips: [
    { groupId: "1", slug: "hasunosora", label: "蓮ノ空", color: null },
    { groupId: "2", slug: "liella", label: "Liella!", color: null },
  ],
  share: { eventName: "Fes Day.1", path: "/ko/events/107/fes-day1" },
};

function group(id: string, slug: string, name: string): BoardGroupView {
  return {
    groupId: id,
    slug,
    name,
    color: null,
    expects: { top: [], submissions: 0, participants: 0, label: "operator" },
    starters: [],
  };
}

const READY: BoardReadResponse = {
  enabled: true,
  status: "upcoming",
  locked: false,
  lockAt: LOCK,
  asOf: "2026-10-24T00:00:00.000Z",
  groups: [group("1", "hasunosora", "蓮ノ空"), group("2", "liella", "Liella!")],
};

function song(id: number, title: string, groups: number[]): AvailableSong {
  return {
    songId: id,
    originalTitle: title,
    originalLanguage: "ja",
    variantLabel: null,
    baseVersionId: null,
    translations: [],
    unit: {
      artistId: 1,
      slug: "x",
      label: "x",
      color: "#000",
      isSubUnit: false,
      isMainUnit: false,
    },
    isMultiArtist: false,
    creditedArtistIds: [],
    festivalGroupIds: groups,
  };
}

const CATALOG = [
  song(10, "残陽", [1]),
  song(11, "ハナムスビ", [1]),
  song(20, "始まりは君の空", [2]),
  song(30, "既存の曲", [1]),
];

function storePicks(picks: { groupId: string; songId: string; title: string }[]) {
  window.localStorage.setItem(
    "board-107",
    JSON.stringify({
      picks: picks.map((p, i) => ({ ...p, id: `p${i}`, available: true })),
    }),
  );
}

const fetchMock = vi.fn();
const scrollIntoView = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  fetchMock.mockReset().mockImplementation(async () =>
    new Response(JSON.stringify(READY), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  // rAF runs the scroll synchronously so the test can see it.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function renderPage({
  status = "upcoming",
  isWishPredictOpen = true,
}: { status?: ResolvedEventStatus; isWishPredictOpen?: boolean } = {}) {
  return render(
    <LiveSetlist
      eventId="107"
      items={[]}
      reactionCounts={{}}
      top3Wishes={[]}
      initialTrendingSongs={[]}
      startTime={new Date(LOCK)}
      unknownSongLabel="unknown"
      isOngoing={false}
      locale="ko"
      status={status}
      isWishPredictOpen={isWishPredictOpen}
      board={SEED}
      seriesName="S"
      eventTitle="E"
      dateLine="d"
      availableSongs={CATALOG}
      unitFilters={[{ key: "all", label: "All", color: null, kind: "all", artistId: null }]}
    />,
  );
}

const setlistCard = () => document.getElementById("setlist-card-107")!;

describe("board → full setlist mode", () => {
  it("an empty list is pre-filled with my expected songs, grouped, order marked provisional", async () => {
    // Added Liella! first: the draft still follows the board's group order.
    storePicks([
      { groupId: "2", songId: "20", title: "始まりは君の空" },
      { groupId: "1", songId: "10", title: "残陽" },
      { groupId: "1", songId: "11", title: "ハナムスビ" },
    ]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "toFullSetlist" }));

    const card = within(setlistCard());
    expect(card.getByTestId("predict-bridge-notice")).toHaveTextContent("bridgeImported(3)");
    // Announced by the live region that outlives the builder's remount.
    expect(card.getByTestId("predict-bridge-status")).toHaveTextContent("bridgeImported(3)");
    expect(card.getByTestId("predict-provisional")).toBeTruthy();
    // Rendered rows, top to bottom (the picker sheet is closed, so these
    // are the builder's rows only).
    expect(
      card.getAllByText(/^(残陽|ハナムスビ|始まりは君の空)$/).map((el) => el.textContent),
    ).toEqual(["残陽", "ハナムスビ", "始まりは君の空"]);
    expect(readPredictions("107")?.songs.map((e) => e.songId)).toEqual([10, 11, 20]);

    expect(trackEvent).toHaveBeenCalledWith("board_to_builder", {
      event_id: "107",
      imported_count: 3,
    });
    expect(scrollIntoView).toHaveBeenCalled();
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(setlistCard());
  });

  it("an existing list is left intact and the fan is told so", async () => {
    writePredictions("107", [
      {
        songId: 30,
        song: {
          originalTitle: "既存の曲",
          originalLanguage: "ja",
          variantLabel: null,
          baseVersionId: null,
          translations: [],
        },
      },
    ]);
    const before = window.localStorage.getItem("predict-107");
    storePicks([{ groupId: "1", songId: "10", title: "残陽" }]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "toFullSetlist" }));

    const card = within(setlistCard());
    expect(card.getByTestId("predict-bridge-notice")).toHaveTextContent("bridgeKept");
    expect(card.getByTestId("predict-bridge-status")).toHaveTextContent("bridgeKept");
    expect(card.queryByTestId("predict-provisional")).toBeNull();
    expect(card.getByText("既存の曲")).toBeTruthy();
    expect(card.queryByText("残陽")).toBeNull();
    expect(window.localStorage.getItem("predict-107")).toBe(before);
    expect(trackEvent).toHaveBeenCalledWith("board_to_builder", {
      event_id: "107",
      imported_count: 0,
    });
  });

  it("the builder's switch scrolls back to the board block", async () => {
    renderPage();
    await screen.findByRole("button", { name: "toFullSetlist" });
    fireEvent.click(within(setlistCard()).getByRole("button", { name: /toBoard/ }));
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(
      document.getElementById("fan-board-107"),
    );
  });

  it.each([
    ["before the D-7 window", { isWishPredictOpen: false }],
    ["after the show", { status: "completed" as const, isWishPredictOpen: false }],
  ])("%s: no bridge either way", async (_label, opts) => {
    renderPage(opts);
    await screen.findByRole("button", { name: "copy" });
    expect(screen.queryByRole("button", { name: "toFullSetlist" })).toBeNull();
    expect(screen.queryByRole("button", { name: /toBoard/ })).toBeNull();
  });
});

describe("<PredictedSetlist> bridge strip", () => {
  const entry = (songId: number, originalTitle: string) => ({
    songId,
    song: {
      originalTitle,
      originalLanguage: "ja",
      variantLabel: null,
      baseVersionId: null,
      translations: [],
    },
  });
  function renderBuilder(props: Partial<React.ComponentProps<typeof PredictedSetlist>> = {}) {
    return render(
      <PredictedSetlist
        eventId="107"
        locale="ko"
        startTime={new Date(LOCK)}
        status="upcoming"
        actualSongs={[]}
        seriesName="S"
        eventTitle="E"
        dateLine="d"
        availableSongs={[]}
        unitFilters={[]}
        {...props}
      />,
    );
  }

  it("a provisional list keeps its label after a reload (no bridge outcome)", () => {
    writePredictions("107", [entry(10, "残陽")], { provisional: true });
    renderBuilder();
    expect(screen.getByTestId("predict-provisional")).toBeTruthy();
    expect(screen.queryByTestId("predict-bridge-notice")).toBeNull();
  });

  it("nothing to import: no notice; a non-board event shows no strip at all", () => {
    writePredictions("107", [entry(10, "残陽")]);
    const view = renderBuilder({ bridgeOutcome: { kind: "none" } });
    expect(screen.queryByTestId("predict-bridge-notice")).toBeNull();
    expect(screen.queryByTestId("predict-provisional")).toBeNull();
    expect(screen.queryByRole("button", { name: /toBoard/ })).toBeNull();
    view.unmount();
  });

  it("locked (show started): no strip even for a provisional list", () => {
    writePredictions("107", [entry(10, "残陽")], { provisional: true });
    renderBuilder({
      startTime: new Date(Date.now() - 60_000),
      onBackToBoard: () => {},
      bridgeOutcome: { kind: "imported", count: 1 },
    });
    expect(screen.queryByTestId("predict-provisional")).toBeNull();
    expect(screen.queryByTestId("predict-bridge-notice")).toBeNull();
    expect(screen.queryByRole("button", { name: /toBoard/ })).toBeNull();
  });
});
