import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

// The board and the setlist card end to end through the real
// <LiveSetlist> → <SetlistSection> → <PredictedSetlist>: no mode switch
// between them, a start button into the Predicted tab, and the
// builder's "import my expected songs".

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
import { writeWishes } from "@/lib/wishStorage";
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
    wishes: { top: [], submissions: 0, participants: 0, label: "operator" },
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
    releaseDate: null,
  };
}

const CATALOG = [
  song(10, "残陽", [1]),
  song(11, "ハナムスビ", [1]),
  song(20, "始まりは君の空", [2]),
  song(30, "既存の曲", [1]),
];

const display = (originalTitle: string) => ({
  originalTitle,
  originalLanguage: "ja",
  variantLabel: null,
  baseVersionId: null,
  translations: [],
});
const entry = (songId: number, title: string) => ({ songId, song: display(title) });
/** A stored board expected song (the `board-{eventId}` local copy). */
const pick = (groupId: string, songId: string, available = true) => ({
  id: `p-${groupId}-${songId}`,
  groupId,
  songId,
  title: songId,
  available,
});
function storePicks(picks: ReturnType<typeof pick>[]) {
  window.localStorage.setItem("board-107", JSON.stringify({ picks }));
}
/** A stored wish; `groupId` set = a board wish, absent = legacy wishlist. */
const wish = (songId: number, title: string, groupId?: string) => ({
  songId,
  dbId: `w${songId}${groupId ?? ""}`,
  song: display(title),
  ...(groupId ? { groupId } : {}),
});

const fetchMock = vi.fn();

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

describe("board and setlist card on one page", () => {
  it("no mode switch on the board; the card is titled Setlist and offers to start a prediction", async () => {
    renderPage();
    // Positive control: the board's own actions did render.
    await screen.findByRole("button", { name: "copy" });
    expect(screen.queryByRole("button", { name: "toFullSetlist" })).toBeNull();
    const card = within(setlistCard());
    expect(card.getByRole("heading", { level: 2 })).toHaveTextContent("setlist");
    expect(card.queryByRole("tablist")).toBeNull();
    expect(card.getByTestId("predict-start")).toHaveTextContent("startPredict");
  });

  it("starting opens the Predicted tab: scoring rule and save note first, no board link note or way back", async () => {
    renderPage();
    const card = within(setlistCard());
    fireEvent.click(await card.findByTestId("predict-start"));
    expect(
      card.getByRole("tab", { name: "tabPredicted" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(card.getByText("description")).toBeTruthy();
    expect(card.getByTestId("predict-save-note")).toHaveTextContent("saveNote");
    expect(card.queryByTestId("predict-board-link-note")).toBeNull();
    expect(card.queryByRole("button", { name: /toBoard\b/ })).toBeNull();
  });

  it("a stored list opens straight into the tabs (no start button)", async () => {
    writePredictions("107", [entry(30, "既存の曲")]);
    renderPage();
    const card = within(setlistCard());
    expect(await card.findByRole("tab", { name: "tabPredicted" })).toBeTruthy();
    expect(card.getByText("既存の曲")).toBeTruthy();
    expect(card.queryByTestId("predict-start")).toBeNull();
  });

  it("after the show: no start button", async () => {
    renderPage({ status: "completed", isWishPredictOpen: false });
    await screen.findByRole("button", { name: "copy" });
    expect(screen.queryByTestId("predict-start")).toBeNull();
  });

  it("before the wish/predict window: no board and no start button (one open date)", async () => {
    // Positive control: the SAME seed mounts the board and the start
    // button once the window is open, so the absence below is the
    // window gate's doing.
    const open = renderPage();
    await screen.findByRole("button", { name: "copy" });
    expect(document.getElementById("fan-board-107")).not.toBeNull();
    expect(screen.getByTestId("predict-start")).toBeTruthy();
    open.unmount();
    fetchMock.mockClear();

    renderPage({ isWishPredictOpen: false });
    expect(document.getElementById("fan-board-107")).toBeNull();
    expect(screen.queryByRole("button", { name: "copy" })).toBeNull();
    expect(screen.queryByTestId("predict-start")).toBeNull();
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("/board")),
    ).toHaveLength(0);
  });
});

describe("<PredictedSetlist> import my expected songs", () => {
  const FILTERS = [{ key: "all", label: "All", color: null, kind: "all" as const, artistId: null }];
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
        availableSongs={CATALOG}
        unitFilters={FILTERS}
        boardGroups={SEED.chips}
        {...props}
      />,
    );
  }

  it("appends my board expected songs in board group order, skipping listed, duplicate and unavailable ones", () => {
    writePredictions("107", [entry(10, "残陽")]);
    // Liella! picked first: the import still follows the board's group order.
    storePicks([
      pick("2", "20"),
      pick("1", "10"), // already in the list
      pick("1", "11"),
      pick("1", "30", false), // moderated out
      pick("1", "99"), // not in the catalog any more
    ]);
    renderBuilder();
    fireEvent.click(screen.getByTestId("predict-import-picks"));

    expect(readPredictions("107")?.songs.map((e) => e.songId)).toEqual([10, 11, 20]);
    // Board order is not a ranking: the list asks to be arranged.
    expect(readPredictions("107")?.provisional).toBe(true);
    expect(screen.getByTestId("predict-provisional")).toBeTruthy();
    expect(screen.getByTestId("predict-import-note")).toHaveTextContent("importPicksDone(2)");
    expect(trackEvent).toHaveBeenCalledWith("predict_board_import", {
      event_id: "107",
      added_count: 2,
    });
  });

  it("wishes are never imported — this list is a prediction", () => {
    // A board wish and no expected song: nothing to add.
    writeWishes("107", [wish(11, "ハナムスビ", "1")]);
    renderBuilder();
    fireEvent.click(screen.getByTestId("predict-import-picks"));
    expect(readPredictions("107")).toBeNull();
    expect(screen.getByTestId("predict-import-note")).toHaveTextContent("importPicksNone");
  });

  it("nothing new to import: the list is untouched and the fan is told so", () => {
    writePredictions("107", [entry(10, "残陽")]);
    storePicks([pick("1", "10")]);
    const before = window.localStorage.getItem("predict-107");
    renderBuilder();
    fireEvent.click(screen.getByTestId("predict-import-picks"));
    expect(window.localStorage.getItem("predict-107")).toBe(before);
    expect(screen.getByTestId("predict-import-note")).toHaveTextContent("importPicksNone");
    expect(screen.queryByTestId("predict-provisional")).toBeNull();
  });

  it("only on board events, and only before the start", () => {
    // Positive control: board event, before the start.
    const open = renderBuilder();
    expect(screen.getByTestId("predict-import-picks")).toBeTruthy();
    open.unmount();

    const noBoard = renderBuilder({ boardGroups: undefined });
    expect(screen.queryByTestId("predict-import-picks")).toBeNull();
    noBoard.unmount();

    renderBuilder({ startTime: new Date(Date.now() - 60_000) });
    expect(screen.queryByTestId("predict-import-picks")).toBeNull();
  });

  it("a provisional list keeps its label after a reload", () => {
    writePredictions("107", [entry(10, "残陽")], { provisional: true });
    renderBuilder();
    expect(screen.getByTestId("predict-provisional")).toBeTruthy();
  });

  it("removing the last imported song ends the provisional label", () => {
    writePredictions("107", [entry(10, "残陽")], { provisional: true });
    renderBuilder();
    expect(screen.getByTestId("predict-provisional")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("removeAria"));
    expect(readPredictions("107")?.provisional).toBeUndefined();
    // Build a list by hand from the picker: no label, in memory or stored.
    fireEvent.click(screen.getByText("add"));
    fireEvent.click(screen.getByText("ハナムスビ"));
    expect(readPredictions("107")?.songs.map((e) => e.songId)).toEqual([11]);
    expect(screen.queryByTestId("predict-provisional")).toBeNull();
    expect(readPredictions("107")?.provisional).toBeUndefined();
  });

  it("locked (show started): no strip even for a provisional list", () => {
    writePredictions("107", [entry(10, "残陽")], { provisional: true });
    renderBuilder({ startTime: new Date(Date.now() - 60_000) });
    expect(screen.queryByTestId("predict-provisional")).toBeNull();
  });
});
