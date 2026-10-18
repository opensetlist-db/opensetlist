import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// "Put on the board" (n15-09b) end to end through the real
// <LiveSetlist> → <SetlistSection> → <PredictedSetlist> →
// <BoardPublishProposal>, with only the network stubbed: derive the
// proposal from the list, edit it, preview against my current picks,
// publish, and see the board block show the new picks.

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
import { trackEvent } from "@/lib/analytics";
import { writePredictions, type PredictionEntry } from "@/lib/predictionsStorage";
import { readBoardPicks } from "@/lib/board/pickStorage";
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
    wishes: { top: [], submissions: 0, participants: 0, label: "operator" },
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
  song(12, "既存の曲", [1]),
  song(20, "始まりは君の空", [2]),
  // Crossover: credited to both groups.
  song(40, "Link to the FUTURE", [1, 2]),
];

const entry = (s: AvailableSong): PredictionEntry => ({
  songId: s.songId,
  song: {
    originalTitle: s.originalTitle,
    originalLanguage: s.originalLanguage,
    variantLabel: s.variantLabel,
    baseVersionId: s.baseVersionId,
    translations: s.translations,
  },
});
const byId = (id: number) => CATALOG.find((s) => s.songId === id)!;
const storeList = (ids: number[]) => writePredictions("107", ids.map((id) => entry(byId(id))));

function storePicks(picks: { groupId: string; songId: string; title: string }[]) {
  window.localStorage.setItem(
    "board-107",
    JSON.stringify({
      picks: picks.map((p, i) => ({ ...p, id: `old-${i}`, available: true })),
    }),
  );
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const fetchMock = vi.fn();
/** What the PUT should answer; the default echoes the request as rows. */
let putAnswer: (body: { picks: { groupId: string; songId: string }[] }) => Response;

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  putAnswer = (body) =>
    json(200, {
      picks: body.picks.map((p, i) => ({
        ...p,
        id: `new-${i}`,
        createdAt: "2026-10-20T00:00:00.000Z",
      })),
    });
  fetchMock.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "PUT") return putAnswer(JSON.parse(String(init.body)));
    if (String(url).includes("/board/mine")) return json(200, { picks: [] });
    return json(200, READY);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function renderPage({
  status = "upcoming",
  startTime = new Date(LOCK),
}: { status?: ResolvedEventStatus; startTime?: Date } = {}) {
  return render(
    <LiveSetlist
      eventId="107"
      items={[]}
      reactionCounts={{}}
      top3Wishes={[]}
      initialTrendingSongs={[]}
      startTime={startTime}
      unknownSongLabel="unknown"
      isOngoing={false}
      locale="ko"
      status={status}
      isWishPredictOpen
      board={SEED}
      seriesName="S"
      eventTitle="E"
      dateLine="d"
      availableSongs={CATALOG}
      unitFilters={[{ key: "all", label: "All", color: null, kind: "all", artistId: null }]}
    />,
  );
}

const card = () => within(document.getElementById("setlist-card-107")!);
const board = () => within(document.getElementById("fan-board-107")!);
const proposal = () => within(screen.getByTestId("board-publish-proposal"));
const chipsOf = (groupId: string) =>
  within(
    screen
      .getAllByTestId("proposal-group")
      .find((el) => el.getAttribute("data-group") === groupId)!,
  )
    .queryAllByTestId("proposal-chip")
    .map((el) => el.firstChild?.textContent);
const putCalls = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT");

async function openProposal() {
  // Wait for the board read so the block (and its anchor) is ready.
  await screen.findByRole("button", { name: "copy" });
  fireEvent.click(card().getByRole("button", { name: /toBoardPublish/ }));
  return proposal();
}

describe("full setlist → board proposal → published picks", () => {
  it("derives, edits, previews against my picks, publishes, and the board shows the new set", async () => {
    // Group 1 gets the first three of its songs; 12 is a fourth, left out.
    storeList([11, 20, 10, 40, 12]);
    storePicks([
      { groupId: "1", songId: "10", title: "残陽" },
      { groupId: "1", songId: "12", title: "既存の曲" },
    ]);
    renderPage();
    const panel = await openProposal();

    expect(chipsOf("1")).toEqual(["ハナムスビ", "残陽", "Link to the FUTURE"]);
    expect(chipsOf("2")).toEqual(["始まりは君の空"]);
    expect(panel.getByTestId("preview-removed")).toHaveTextContent("既存の曲");
    expect(panel.getByTestId("preview-added")).toHaveTextContent(
      // `copySongSeparator` is the mocked " / " join.
      "ハナムスビcopySongSeparator始まりは君の空copySongSeparatorLink to the FUTURE",
    );

    // Swap: drop ハナムスビ, bring 既存の曲 back in (it stays on the board).
    fireEvent.click(panel.getByRole("button", { name: "removeAria(ハナムスビ)" }));
    fireEvent.change(panel.getByRole("combobox", { name: "add(蓮ノ空)" }), {
      target: { value: "12" },
    });
    // Count the crossover under Liella! instead.
    fireEvent.change(
      panel.getByRole("combobox", { name: "proposalCountUnderAria(Link to the FUTURE)" }),
      { target: { value: "2" } },
    );
    expect(chipsOf("1")).toEqual(["残陽", "既存の曲"]);
    expect(chipsOf("2")).toEqual(["始まりは君の空", "Link to the FUTURE"]);
    expect(panel.queryByTestId("preview-removed")).toBeNull();

    fireEvent.click(panel.getByRole("button", { name: "publish" }));
    await waitFor(() => expect(screen.queryByTestId("board-publish-proposal")).toBeNull());

    const [[url, init]] = putCalls();
    expect(url).toBe("/api/events/107/board/picks");
    expect(JSON.parse(String(init.body)).picks).toEqual([
      { groupId: "2", songId: "20" },
      { groupId: "1", songId: "10" },
      { groupId: "2", songId: "40" },
      { groupId: "1", songId: "12" },
    ]);
    // Local copy rewritten from the server's answer, titles included.
    expect(readBoardPicks("107").map((p) => `${p.id}:${p.songId}:${p.title}`)).toEqual([
      "new-0:20:始まりは君の空",
      "new-1:10:残陽",
      "new-2:40:Link to the FUTURE",
      "new-3:12:既存の曲",
    ]);
    expect(trackEvent).toHaveBeenCalledWith("board_publish", {
      event_id: "107",
      pick_count: 4,
    });
    expect(card().getByTestId("predict-board-published")).toHaveTextContent(
      "boardPublished(4)",
    );
    // The board block re-read the ballot: group 1 (the open column)
    // shows the published picks.
    expect(
      board()
        .getAllByTestId("board-my-pick")
        .map((el) => el.textContent),
    ).toEqual([expect.stringContaining("残陽"), expect.stringContaining("既存の曲")]);
  });

  it("a refused publish changes nothing and says why", async () => {
    storeList([10, 11]);
    storePicks([{ groupId: "1", songId: "12", title: "既存の曲" }]);
    const before = window.localStorage.getItem("board-107");
    putAnswer = () => json(409, { error: "cap_reached" });
    renderPage();
    const panel = await openProposal();
    fireEvent.click(panel.getByRole("button", { name: "publish" }));

    expect(await panel.findByRole("alert")).toHaveTextContent("errorCap(3)");
    expect(screen.getByTestId("board-publish-proposal")).toBeTruthy();
    expect(window.localStorage.getItem("board-107")).toBe(before);
    expect(trackEvent).not.toHaveBeenCalledWith("board_publish", expect.anything());
  });

  it("later edits to the full list leave the published picks alone", async () => {
    storeList([10, 11, 20]);
    const view = renderPage();
    const panel = await openProposal();
    fireEvent.click(panel.getByRole("button", { name: "publish" }));
    await waitFor(() => expect(putCalls()).toHaveLength(1));
    await waitFor(() => expect(readBoardPicks("107")).toHaveLength(3));
    const published = window.localStorage.getItem("board-107");

    // Edit the list in the builder: remove every row.
    for (const btn of card().getAllByRole("button", { name: "removeAria" })) {
      fireEvent.click(btn);
    }
    // Reload the page: the board still shows what was published.
    view.unmount();
    renderPage();
    await screen.findByRole("button", { name: "copy" });
    expect(window.localStorage.getItem("board-107")).toBe(published);
    // 10 and 11 under 蓮ノ空 (the open column); 20 sits under Liella!.
    expect(board().getAllByTestId("board-my-pick")).toHaveLength(2);
    expect(putCalls()).toHaveLength(1);
  });

  it("the preview falls back to /board/mine when the local copy is empty", async () => {
    window.localStorage.setItem("opensetlist_anon_id", "anon-from-elsewhere");
    storeList([10]);
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return putAnswer(JSON.parse(String(init.body)));
      if (String(url).includes("/board/mine")) {
        return json(200, {
          picks: [
            {
              id: "srv-1",
              groupId: "2",
              songId: "20",
              title: "始まりは君の空",
              available: true,
              createdAt: "2026-10-01T00:00:00.000Z",
            },
          ],
        });
      }
      return json(200, READY);
    });
    renderPage();
    const panel = await openProposal();
    expect(await panel.findByTestId("preview-removed")).toHaveTextContent("始まりは君の空");
  });

  it("the server's picks replace a stale local copy as the preview baseline", async () => {
    window.localStorage.setItem("opensetlist_anon_id", "anon-two-devices");
    storeList([10]);
    // This tab remembers 10 only; another device since added 20.
    storePicks([{ groupId: "1", songId: "10", title: "残陽" }]);
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return putAnswer(JSON.parse(String(init.body)));
      if (String(url).includes("/board/mine")) {
        return json(200, {
          picks: [
            { id: "s1", groupId: "1", songId: "10", title: "残陽", available: true, createdAt: "2026-10-01T00:00:00.000Z" },
            { id: "s2", groupId: "2", songId: "20", title: "始まりは君の空", available: true, createdAt: "2026-10-02T00:00:00.000Z" },
          ],
        });
      }
      return json(200, READY);
    });
    renderPage();
    const panel = await openProposal();
    expect(await panel.findByTestId("preview-removed")).toHaveTextContent("始まりは君の空");
  });

  it("a lock refusal keeps confirm disabled", async () => {
    storeList([10]);
    putAnswer = () => json(403, { error: "board_locked" });
    renderPage();
    const panel = await openProposal();
    fireEvent.click(panel.getByRole("button", { name: "publish" }));
    expect(await panel.findByRole("alert")).toHaveTextContent("errorLocked");
    expect(panel.getByRole("button", { name: "publish" })).toBeDisabled();
  });

  it("no publish from an empty list", async () => {
    renderPage();
    await screen.findByRole("button", { name: "copy" });
    expect(card().queryByRole("button", { name: /toBoardPublish/ })).toBeNull();
  });

  it("no publish once the start time has passed", async () => {
    storeList([10]);
    renderPage({ startTime: new Date(Date.now() - 1000) });
    await screen.findByRole("button", { name: "copy" });
    expect(card().queryByRole("button", { name: /toBoardPublish/ })).toBeNull();
  });
});
