import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, values?: Record<string, unknown>) =>
      values ? `${key}(${Object.values(values).join(",")})` : key,
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
// LiveSetlist's other children are irrelevant to the board guard.
vi.mock("@/components/EventWishSection", () => ({
  EventWishSection: () => <div data-testid="event-wish-section" />,
}));
vi.mock("@/components/SetlistSection", () => ({
  SetlistSection: () => <div data-testid="setlist-section" />,
}));
vi.mock("@/components/TrendingSongs", () => ({
  TrendingSongs: () => null,
}));

import { FanBoardSection } from "@/components/board/FanBoardSection";
import { BOARD_TIMEOUT_MS } from "@/lib/board/config";
import { LiveSetlist } from "@/components/LiveSetlist";
import { trackEvent } from "@/lib/analytics";
import { absoluteUrl } from "@/lib/seo/entityUrl";
import { groupIdFromFragment } from "@/lib/board/fragment";
import type { BoardBlockSeed, BoardGroupView, BoardReadResponse } from "@/lib/board/types";
import type { ResolvedEventStatus } from "@/lib/eventStatus";
import type { AvailableSong } from "@/lib/types/predict";

const LOCK = "2026-11-14T07:30:00.000Z";
const SEED: BoardBlockSeed = {
  lockAt: LOCK,
  chips: [
    { groupId: "1", slug: "hasunosora", label: "蓮ノ空", color: "#f8b500" },
    { groupId: "2", slug: "liella", label: "Liella!", color: null },
    { groupId: "3", slug: "aqours", label: "Aqours", color: null },
  ],
  share: { eventName: "ラブライブ！フェス Day.1", path: "/ko/events/107/lovelive-fes-day1" },
};

function group(id: string, slug: string, name: string, starters: BoardGroupView["starters"] = []): BoardGroupView {
  return {
    groupId: id,
    slug,
    name,
    color: null,
    wishes: { top: [], submissions: 0, participants: 0, label: "operator" },
    expects: { top: [], submissions: 0, participants: 0, label: "operator" },
    starters,
  };
}

const READY: BoardReadResponse = {
  enabled: true,
  status: "upcoming",
  locked: false,
  lockAt: LOCK,
  asOf: "2026-10-24T00:00:00.000Z",
  groups: [
    group("1", "hasunosora", "蓮ノ空", [
      { songId: "10", title: "残陽" },
      { songId: "11", title: "ハナムスビ" },
    ]),
    group("2", "liella", "Liella!"),
    group("3", "aqours", "Aqours"),
  ],
};

const fetchMock = vi.fn();

function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  window.location.hash = "";
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function renderBlock() {
  return render(<FanBoardSection eventId="107" locale="ko" seed={SEED} />);
}

describe("<FanBoardSection>", () => {
  it("fetches the board for its event + locale after mount", async () => {
    respond(READY);
    renderBlock();
    await screen.findAllByText("残陽");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/events/107/board?locale=ko");
  });

  it("shows chips in roster order while loading", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderBlock();
    expect(screen.getAllByRole("tab").map((b) => b.textContent)).toEqual([
      "蓮ノ空",
      "Liella!",
      "Aqours",
    ]);
    expect(screen.getByText("loading")).toBeTruthy();
  });

  it("first group open by default, with labelled operator starter picks", async () => {
    respond(READY);
    renderBlock();
    const col = within(await screen.findByTestId("board-col-expect"));
    const starters = col.getAllByTestId("board-starter");
    expect(starters).toHaveLength(2);
    expect(starters[0].textContent).toContain("残陽");
    expect(starters[0].textContent).toContain("operatorPick");
    expect(col.getByText("operatorNote")).toBeTruthy();
    // Song titles link to the localized bare-id song page.
    expect(col.getByText("残陽").closest("a")?.getAttribute("href")).toBe("/ko/songs/10");
    // Zero wishes too → the want column falls back to the same starters.
    expect(
      within(screen.getByTestId("board-col-want")).getAllByTestId("board-starter"),
    ).toHaveLength(2);
    expect(screen.getByRole("tab", { name: "蓮ノ空" }).getAttribute("aria-selected")).toBe("true");
  });

  it("the header is one short open-until line — no as-of stamp, no clock time", async () => {
    respond(READY);
    renderBlock();
    await screen.findAllByText("残陽");
    const line = screen.getByRole("heading", { level: 2 }).nextElementSibling;
    // The mock renders `key(args)` when a message gets arguments, so an
    // exact "openUntil" also proves no `{time}` is passed any more.
    expect(line?.textContent).toBe("openUntil");
    expect(screen.queryByText(/asOf/)).toBeNull();
  });

  it("one group open at a time; a group without starters shows the empty invitation", async () => {
    respond(READY);
    renderBlock();
    await screen.findAllByText("残陽");
    fireEvent.click(screen.getByRole("tab", { name: "Liella!" }));
    expect(screen.queryByText("残陽")).toBeNull();
    // Both columns of the group invite a first entry.
    expect(screen.getAllByText("empty")).toHaveLength(2);
    expect(screen.getByRole("tab", { name: "Liella!" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "蓮ノ空" }).getAttribute("aria-selected")).toBe("false");
  });

  it("#board-<slug> selects that group", async () => {
    window.location.hash = "#board-aqours";
    respond(READY);
    renderBlock();
    await screen.findAllByText("empty");
    expect(screen.getByRole("tab", { name: "Aqours" }).getAttribute("aria-selected")).toBe("true");
  });

  it("an unknown fragment leaves the first group open", async () => {
    window.location.hash = "#board-nope";
    respond(READY);
    renderBlock();
    await screen.findAllByText("残陽");
  });

  it("board_view fires once per viewed group, with event and group ids", async () => {
    respond(READY);
    renderBlock();
    await screen.findAllByText("残陽");
    fireEvent.click(screen.getByRole("tab", { name: "Liella!" }));
    fireEvent.click(screen.getByRole("tab", { name: "蓮ノ空" }));
    expect(vi.mocked(trackEvent).mock.calls).toEqual([
      ["board_view", { event_id: "107", group_id: "1" }],
      ["board_view", { event_id: "107", group_id: "2" }],
    ]);
  });

  it("a disabled answer removes the block entirely", async () => {
    respond({ enabled: false });
    const { container } = renderBlock();
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("a locked stub (show started) removes the block", async () => {
    respond({ enabled: true, status: "ongoing", locked: true, lockAt: LOCK });
    const { container } = renderBlock();
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("a 500 collapses to one line", async () => {
    respond({ error: "x" }, 500);
    renderBlock();
    await screen.findByText("loadError");
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("gives up after the timeout and collapses to one line", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    renderBlock();
    expect(screen.queryByText("loadError")).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(BOARD_TIMEOUT_MS);
    });
    expect(screen.getByText("loadError")).toBeTruthy();
  });
});

describe("<FanBoardSection> crowd TOP3", () => {
  function crowd(
    label: "early" | "ok",
    top: BoardGroupView["expects"]["top"],
    participants = label === "ok" ? 6 : 2,
  ): BoardReadResponse {
    const submissions = top.reduce((n, e) => n + e.count, 0);
    return {
      ...READY,
      groups: [
        {
          ...group("1", "hasunosora", "蓮ノ空", [{ songId: "12", title: "スターター" }]),
          expects: { top, submissions, participants, label },
        },
        group("2", "liella", "Liella!"),
      ],
    } as BoardReadResponse;
  }
  const TOP: BoardGroupView["expects"]["top"] = [
    { songId: "10", title: "残陽", count: 7, available: true },
    { songId: "11", title: "ハナムスビ", count: 3, available: true },
  ];

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("early column: counts as submissions, early-sample label, no starters", async () => {
    respond(crowd("early", TOP));
    renderBlock();
    const entries = await screen.findAllByTestId("board-top-entry");
    expect(entries.map((e) => e.textContent)).toEqual([
      expect.stringContaining("submissions(7)"),
      expect.stringContaining("submissions(3)"),
    ]);
    expect(screen.getByTestId("board-early")).toHaveTextContent("earlySample");
    // Starters are operator copy for empty columns only (the want column
    // here IS empty, so it shows them; the expect column must not).
    const expectCol = within(screen.getByTestId("board-col-expect"));
    expect(expectCol.queryByTestId("board-starter")).toBeNull();
    // Plain counts, never shares.
    expect(screen.getByRole("tabpanel").textContent).not.toMatch(/%/);
  });

  it("ok column: TOP3 without the early-sample label", async () => {
    respond(crowd("ok", TOP));
    renderBlock();
    await screen.findAllByTestId("board-top-entry");
    expect(screen.queryByTestId("board-early")).toBeNull();
  });

  it("operator column: starters, no crowd rows, no early label", async () => {
    respond(READY);
    renderBlock();
    await screen.findAllByTestId("board-starter");
    expect(screen.queryByTestId("board-top-entry")).toBeNull();
    expect(screen.queryByTestId("board-early")).toBeNull();
  });

  it("my own pick is highlighted where it appears in the TOP3", async () => {
    window.localStorage.setItem(
      "board-107",
      JSON.stringify({
        picks: [{ id: "p1", groupId: "1", songId: "11", title: "ハナムスビ", available: true }],
      }),
    );
    respond(crowd("ok", TOP));
    renderBlock();
    const entries = await screen.findAllByTestId("board-top-entry");
    expect(entries[0]).not.toHaveAttribute("data-mine");
    expect(entries[1]).toHaveAttribute("data-mine", "true");
    expect(entries[1]).toHaveTextContent("mineBadge");
  });

  it("titles link to the bare-id song page; a click is tracked", async () => {
    respond(crowd("ok", TOP));
    renderBlock();
    const link = await screen.findByRole("link", { name: "残陽" });
    expect(link).toHaveAttribute("href", "/ko/songs/10");
    fireEvent.click(link);
    expect(trackEvent).toHaveBeenCalledWith("board_song_click", {
      event_id: "107",
      group_id: "1",
      song_id: "10",
      column: "expect",
      source: "crowd",
    });
  });

  it("a removed (soft-deleted) song keeps its row and count but has no link", async () => {
    respond(
      crowd("ok", [
        { songId: "99", title: "", count: 5, available: false },
        ...TOP,
      ]),
    );
    renderBlock();
    const [removed] = await screen.findAllByTestId("board-top-entry");
    expect(removed.querySelector("a")).toBeNull();
    expect(removed).toHaveTextContent("unavailable");
    expect(removed).toHaveTextContent("submissions(5)");
  });

  it("explore link opens the group's page and is tracked", async () => {
    respond(crowd("early", TOP));
    renderBlock();
    const link = await screen.findByRole("link", { name: "explore(蓮ノ空)" });
    expect(link).toHaveAttribute("href", "/ko/artists/1/hasunosora");
    fireEvent.click(link);
    expect(trackEvent).toHaveBeenCalledWith("board_explore_click", {
      event_id: "107",
      group_id: "1",
    });
  });
});

describe("<FanBoardSection> copy my picks", () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();

  function storePicks(picks: { id: string; groupId: string; songId: string; title: string }[]) {
    window.localStorage.setItem(
      "board-107",
      JSON.stringify({ picks: picks.map((p) => ({ ...p, available: true })) }),
    );
  }

  beforeEach(() => {
    window.localStorage.clear();
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });
  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  });

  it("disabled at zero picks", async () => {
    respond(READY);
    renderBlock();
    const button = await screen.findByRole("button", { name: "copy" });
    expect(button).toBeDisabled();
  });

  it("copies the picks text with the canonical URL + the open group's fragment; toast + board_copy", async () => {
    storePicks([
      { id: "p1", groupId: "1", songId: "10", title: "残陽" },
      { id: "p2", groupId: "3", songId: "30", title: "未体験HORIZON" },
    ]);
    respond(READY);
    renderBlock();
    // Open Liella! — a group I skipped: the link still opens the group
    // I was on, the text still lists only the groups I picked in.
    fireEvent.click(await screen.findByRole("tab", { name: "Liella!" }));
    const button = screen.getByRole("button", { name: "copy" });
    expect(button).toBeEnabled();
    fireEvent.click(button);

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const url = `${absoluteUrl("/ko/events/107/lovelive-fes-day1")}#board-liella`;
    expect(writeText.mock.calls[0][0]).toBe(
      `copyTemplate(ラブライブ！フェス Day.1,copyLine(蓮ノ空,残陽)
copyLine(Aqours,未体験HORIZON),${url})`,
    );
    // The fragment is the one the board itself parses.
    expect(groupIdFromFragment(new URL(url).hash, READY.groups)).toBe("2");
    expect(await screen.findByTestId("board-toast")).toHaveTextContent("copied");
    expect(trackEvent).toHaveBeenCalledWith("board_copy", {
      event_id: "107",
      group_id: "2",
      count: 2,
    });
  });

  it("no clipboard API → fallback message, nothing tracked", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    storePicks([{ id: "p1", groupId: "1", songId: "10", title: "残陽" }]);
    respond(READY);
    renderBlock();
    fireEvent.click(await screen.findByRole("button", { name: "copy" }));
    await waitFor(() =>
      expect(screen.getByTestId("board-toast")).toHaveTextContent("copyUnavailable"),
    );
    expect(trackEvent).not.toHaveBeenCalledWith("board_copy", expect.anything());
  });

  it("a refused clipboard write → the same fallback message", async () => {
    writeText.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    storePicks([{ id: "p1", groupId: "1", songId: "10", title: "残陽" }]);
    respond(READY);
    renderBlock();
    fireEvent.click(await screen.findByRole("button", { name: "copy" }));
    await waitFor(() =>
      expect(screen.getByTestId("board-toast")).toHaveTextContent("copyUnavailable"),
    );
    expect(trackEvent).not.toHaveBeenCalledWith("board_copy", expect.anything());
  });

  it("festival: a pick is copied only while its song is still in ITS group's catalog", async () => {
    // Song 10 moved out of 蓮ノ空 (group 1) and now belongs to Aqours
    // (group 3) only. "My picks" shows the 蓮ノ空 pick unavailable, so
    // the copied text must not list it under 蓮ノ空 either.
    const song = (id: number, title: string, groups: number[]) =>
      ({
        songId: id,
        originalTitle: title,
        originalLanguage: "ja",
        variantLabel: null,
        baseVersionId: null,
        translations: [],
        festivalGroupIds: groups,
        // Group-direct credit to the first group: the picker derives
        // its unit chips from these (n15 board picker).
        unit: { artistId: groups[0] ?? 0, slug: `g${groups[0] ?? 0}`, label: `g${groups[0] ?? 0}`, color: "#888888", isSubUnit: false, isMainUnit: false },
        isMultiArtist: false,
        creditedArtistIds: groups.slice(0, 1),
        releaseDate: null,
      }) as unknown as AvailableSong;
    storePicks([
      { id: "p1", groupId: "1", songId: "10", title: "残陽" },
      { id: "p2", groupId: "1", songId: "11", title: "ハナムスビ" },
    ]);
    respond(READY);
    render(
      <FanBoardSection
        eventId="107"
        locale="ko"
        seed={SEED}
        catalog={[song(10, "残陽", [3]), song(11, "ハナムスビ", [1])]}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain("copyLine(蓮ノ空,ハナムスビ)");
    expect(writeText.mock.calls[0][0]).not.toContain("残陽");
  });
});

describe("<LiveSetlist> board guard", () => {
  function renderLiveSetlist(status: ResolvedEventStatus, board: BoardBlockSeed | null = SEED) {
    return render(
      <LiveSetlist
        eventId="107"
        items={[]}
        reactionCounts={{}}
        top3Wishes={[]}
        initialTrendingSongs={[]}
        startTime={new Date(LOCK)}
        unknownSongLabel="unknown"
        isOngoing={status === "ongoing"}
        locale="ko"
        status={status}
        isWishPredictOpen={status === "upcoming"}
        board={board}
        seriesName="S"
        eventTitle="E"
        dateLine="d"
        availableSongs={[]}
        unitFilters={[]}
      />,
    );
  }

  const boardCalls = () =>
    fetchMock.mock.calls.filter(([url]) => String(url).includes("/board"));

  it.each(["upcoming", "completed"] as const)(
    "%s mounts the block and requests the board; the standalone wishlist is replaced (n15)",
    async (status) => {
      respond(READY);
      renderLiveSetlist(status);
      await screen.findAllByText("残陽");
      expect(boardCalls()).toHaveLength(1);
      expect(screen.queryByTestId("event-wish-section")).toBeNull();
    },
  );

  it.each(["ongoing", "cancelled"] as const)(
    "%s: no block, no board request; today's wishlist still renders",
    (status) => {
      respond(READY);
      renderLiveSetlist(status);
      expect(screen.queryByRole("tablist")).toBeNull();
      expect(screen.getByTestId("event-wish-section")).toBeTruthy();
      expect(boardCalls()).toHaveLength(0);
    },
  );

  it.each(["upcoming", "completed"] as const)(
    "%s without a seed (board off) → no block, no request, today's wishlist",
    (status) => {
      renderLiveSetlist(status, null);
      expect(screen.queryByRole("tablist")).toBeNull();
      expect(boardCalls()).toHaveLength(0);
      expect(screen.getByTestId("event-wish-section")).toBeTruthy();
    },
  );

  it("an upcoming page that turns ongoing unmounts the block", async () => {
    respond(READY);
    const view = renderLiveSetlist("upcoming");
    await screen.findAllByText("残陽");
    view.rerender(
      <LiveSetlist
        eventId="107"
        items={[]}
        reactionCounts={{}}
        top3Wishes={[]}
        initialTrendingSongs={[]}
        startTime={new Date(LOCK)}
        unknownSongLabel="unknown"
        isOngoing
        locale="ko"
        status="ongoing"
        isWishPredictOpen={false}
        board={SEED}
        seriesName="S"
        eventTitle="E"
        dateLine="d"
        availableSongs={[]}
        unitFilters={[]}
      />,
    );
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(boardCalls()).toHaveLength(1);
    // …and today's wishlist takes the board's place for the show.
    expect(screen.getByTestId("event-wish-section")).toBeTruthy();
  });
});

describe("<FanBoardSection> post-show result mode (n15)", () => {
  const SHORTLIST = [
    { songId: "10", title: "残陽", count: 7, available: true, played: true },
    { songId: "11", title: "ハナムスビ", count: 3, available: true, played: false },
    { songId: "99", title: "", count: 2, available: false, played: true },
  ];

  function completed(
    tallyGroups = [{ groupId: "1", shortlist: SHORTLIST, played: 2, size: 3 }],
    overall = { played: 2, size: 3 },
  ): BoardReadResponse {
    return {
      enabled: true,
      status: "completed",
      locked: true,
      lockAt: LOCK,
      asOf: "2026-11-15T00:00:00.000Z",
      groups: [
        {
          ...group("1", "hasunosora", "蓮ノ空", [{ songId: "12", title: "スターター" }]),
          expects: {
            top: SHORTLIST.map((e) => ({
              songId: e.songId,
              title: e.title,
              count: e.count,
              available: e.available,
            })),
            submissions: 12,
            participants: 6,
            label: "ok",
          },
        },
        group("2", "liella", "Liella!", [{ songId: "20", title: "始まりは君の空" }]),
      ],
      tally: { ...overall, groups: tallyGroups, playedSongIds: ["10", "99", "30"] },
    };
  }

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("overall and per-group lines read N of K", async () => {
    respond(completed());
    renderBlock();
    expect(await screen.findByTestId("board-tally-overall")).toHaveTextContent(
      "tallyOverall(2,3)",
    );
    expect(
      within(screen.getByTestId("board-col-expect")).getByTestId("board-tally-group"),
    ).toHaveTextContent("tallyGroup(2,3)");
  });

  it("each shortlist song shows ✓ or ✕; the removed song has no link but is graded", async () => {
    respond(completed());
    renderBlock();
    const expectCol = within(await screen.findByTestId("board-col-expect"));
    const entries = await expectCol.findAllByTestId("board-top-entry");
    expect(entries.map((e) => e.getAttribute("data-played"))).toEqual([
      "true",
      "false",
      "true",
    ]);
    expect(within(entries[0]).getByLabelText("tallyPlayed")).toHaveTextContent("✓");
    expect(within(entries[1]).getByLabelText("tallyNotPlayed")).toHaveTextContent("✕");
    expect(entries[2].querySelector("a")).toBeNull();
    expect(entries[2]).toHaveTextContent("unavailable");
  });

  it("the want column is never graded", async () => {
    respond(completed());
    renderBlock();
    await screen.findByTestId("board-tally-overall");
    const wantCol = within(screen.getByTestId("board-col-want"));
    expect(wantCol.queryByTestId("board-tally-group")).toBeNull();
    expect(wantCol.queryByLabelText("tallyPlayed")).toBeNull();
  });

  it("a group nobody picked keeps its starters, ungraded, with no N of K line", async () => {
    respond(
      completed([
        { groupId: "1", shortlist: SHORTLIST, played: 2, size: 3 },
        { groupId: "2", shortlist: [], played: 0, size: 0 },
      ]),
    );
    renderBlock();
    await screen.findByTestId("board-tally-overall");
    fireEvent.click(screen.getByRole("tab", { name: "Liella!" }));
    const expectCol = within(screen.getByTestId("board-col-expect"));
    expect(expectCol.getByTestId("board-starter")).toHaveTextContent("始まりは君の空");
    expect(expectCol.queryByTestId("board-tally-group")).toBeNull();
    expect(expectCol.queryByLabelText("tallyPlayed")).toBeNull();
    expect(expectCol.queryByLabelText("tallyNotPlayed")).toBeNull();
  });

  it("no shortlist anywhere → no overall line", async () => {
    respond(completed([], { played: 0, size: 0 }));
    renderBlock();
    await screen.findAllByTestId("board-top-entry");
    expect(screen.queryByTestId("board-tally-overall")).toBeNull();
  });

  it("my picks that were played are highlighted — shortlisted or not", async () => {
    window.localStorage.setItem(
      "board-107",
      JSON.stringify({
        picks: [
          { id: "p1", groupId: "1", songId: "11", title: "ハナムスビ", available: true },
          { id: "p2", groupId: "1", songId: "30", title: "AURORA FLOWER", available: true },
        ],
      }),
    );
    respond(completed());
    renderBlock();
    await screen.findByTestId("board-tally-overall");
    const mine = within(screen.getByTestId("board-my-picks")).getAllByTestId(
      "board-my-pick",
    );
    expect(mine.map((e) => e.getAttribute("data-played"))).toEqual([null, "true"]);
    expect(mine[1]).toHaveTextContent("minePlayed");
  });

  it("an upcoming board shows no result mode", async () => {
    respond(READY);
    renderBlock();
    await screen.findAllByTestId("board-starter");
    expect(screen.queryByTestId("board-tally-overall")).toBeNull();
    expect(screen.queryByTestId("board-tally-group")).toBeNull();
  });
});
