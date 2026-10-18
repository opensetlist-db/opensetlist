import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

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
import type { BoardBlockSeed, BoardGroupView, BoardReadResponse } from "@/lib/board/types";
import type { ResolvedEventStatus } from "@/lib/eventStatus";

const LOCK = "2026-11-14T07:30:00.000Z";
const SEED: BoardBlockSeed = {
  lockAt: LOCK,
  chips: [
    { groupId: "1", slug: "hasunosora", label: "蓮ノ空", color: "#f8b500" },
    { groupId: "2", slug: "liella", label: "Liella!", color: null },
    { groupId: "3", slug: "aqours", label: "Aqours", color: null },
  ],
};

function group(id: string, slug: string, name: string, starters: BoardGroupView["starters"] = []): BoardGroupView {
  return {
    groupId: id,
    slug,
    name,
    color: null,
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
    await screen.findByText("残陽");
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
    const starters = await screen.findAllByTestId("board-starter");
    expect(starters).toHaveLength(2);
    expect(starters[0].textContent).toContain("残陽");
    expect(starters[0].textContent).toContain("operatorPick");
    expect(screen.getByText("operatorNote")).toBeTruthy();
    // Song titles link to the localized bare-id song page.
    expect(screen.getByText("残陽").closest("a")?.getAttribute("href")).toBe("/ko/songs/10");
    expect(screen.getByRole("tab", { name: "蓮ノ空" }).getAttribute("aria-selected")).toBe("true");
  });

  it("as-of and open-until line both render", async () => {
    respond(READY);
    renderBlock();
    await screen.findByText("残陽");
    expect(screen.getByText(/asOf\(/)).toBeTruthy();
    expect(screen.getByText(/openUntil\(/)).toBeTruthy();
  });

  it("one group open at a time; a group without starters shows the empty invitation", async () => {
    respond(READY);
    renderBlock();
    await screen.findByText("残陽");
    fireEvent.click(screen.getByRole("tab", { name: "Liella!" }));
    expect(screen.queryByText("残陽")).toBeNull();
    expect(screen.getByText("empty")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Liella!" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "蓮ノ空" }).getAttribute("aria-selected")).toBe("false");
  });

  it("#board-<slug> selects that group", async () => {
    window.location.hash = "#board-aqours";
    respond(READY);
    renderBlock();
    await screen.findByText("empty");
    expect(screen.getByRole("tab", { name: "Aqours" }).getAttribute("aria-selected")).toBe("true");
  });

  it("an unknown fragment leaves the first group open", async () => {
    window.location.hash = "#board-nope";
    respond(READY);
    renderBlock();
    await screen.findByText("残陽");
  });

  it("board_view fires once per viewed group, with event and group ids", async () => {
    respond(READY);
    renderBlock();
    await screen.findByText("残陽");
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

  it.each(["upcoming", "completed"] as const)("%s mounts the block and requests the board", async (status) => {
    respond(READY);
    renderLiveSetlist(status);
    await screen.findByText("残陽");
    expect(boardCalls()).toHaveLength(1);
  });

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

  it("no seed (board off) → nothing mounted, no request", () => {
    renderLiveSetlist("upcoming", null);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(boardCalls()).toHaveLength(0);
  });

  it("an upcoming page that turns ongoing unmounts the block", async () => {
    respond(READY);
    const view = renderLiveSetlist("upcoming");
    await screen.findByText("残陽");
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
  });
});
