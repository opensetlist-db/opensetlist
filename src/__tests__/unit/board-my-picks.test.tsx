import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// "My picks" on the fan board (n15), through the whole block with a
// mocked board read and mocked pick routes: the N/3 counter, the cap
// state, success / error feedback, highlight of my picks in the column,
// unavailable (soft-deleted) songs, the cross-group label, the
// `/board/mine` fallback, and the switch to read-only on a lock answer.

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, values?: Record<string, unknown>) =>
      values ? `${key}(${Object.values(values).join(",")})` : key,
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
// The real sheet is a vaul drawer; the block only needs its contract
// (songs in, selected ids in, toggle out).
vi.mock("@/components/predict/SongPickerSheet", () => ({
  SongPickerSheet: ({
    open,
    songs,
    selectedIds,
    onToggle,
  }: {
    open: boolean;
    songs: { songId: number }[];
    selectedIds: number[];
    onToggle: (id: number) => void;
  }) =>
    open ? (
      <div data-testid="picker">
        {songs.map((s) => (
          <button key={s.songId} type="button" onClick={() => onToggle(s.songId)}>
            {`pick-${s.songId}${selectedIds.includes(s.songId) ? "*" : ""}`}
          </button>
        ))}
      </div>
    ) : null,
}));

import { FanBoardSection } from "@/components/board/FanBoardSection";
import { trackEvent } from "@/lib/analytics";
import { ANON_ID_KEY } from "@/lib/anonId";
import type { BoardBlockSeed, BoardReadResponse } from "@/lib/board/types";
import type { AvailableSong } from "@/lib/types/predict";

const LOCK = "2026-11-14T07:30:00.000Z";
const SEED: BoardBlockSeed = {
  lockAt: LOCK,
  chips: [
    { groupId: "1", slug: "hasunosora", label: "蓮ノ空", color: null },
    { groupId: "2", slug: "liella", label: "Liella!", color: null },
  ],
  share: { eventName: "Fes Day.1", path: "/ko/events/107/fes-day1" },
};

function readBoard(over: Partial<{ locked: boolean; top: { songId: string; title: string; count: number; available: boolean }[] }> = {}): BoardReadResponse {
  return {
    enabled: true,
    status: "upcoming",
    locked: over.locked ?? false,
    lockAt: LOCK,
    asOf: "2026-10-24T00:00:00.000Z",
    groups: [
      {
        groupId: "1",
        slug: "hasunosora",
        name: "蓮ノ空",
        color: null,
        wishes: { top: [], submissions: 0, participants: 0, label: "operator" },
        expects: over.top
          ? { top: over.top, submissions: 7, participants: 2, label: "early" }
          : { top: [], submissions: 0, participants: 0, label: "operator" },
        starters: [],
      },
      {
        groupId: "2",
        slug: "liella",
        name: "Liella!",
        color: null,
        wishes: { top: [], submissions: 0, participants: 0, label: "operator" },
        expects: { top: [], submissions: 0, participants: 0, label: "operator" },
        starters: [],
      },
    ],
  };
}

function song(id: number, title: string, groups: number[]): AvailableSong {
  return {
    songId: id,
    originalTitle: title,
    originalLanguage: "ja",
    variantLabel: null,
    baseVersionId: null,
    translations: [],
    festivalGroupIds: groups,
  } as unknown as AvailableSong;
}

const CATALOG = [
  song(10, "残陽", [1]),
  song(11, "ハナムスビ", [1]),
  song(12, "Dream Believers", [1]),
  song(13, "Special Thanks", [1]),
  song(20, "Shared Song", [1, 2]),
  song(30, "始まりは君の空", [2]),
];

const fetchMock = vi.fn();
type Handler = (url: string, init?: RequestInit) => { status: number; body: unknown };
let handler: Handler;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.location.hash = "";
  handler = (url) =>
    url.startsWith("/api/events/107/board?")
      ? { status: 200, body: readBoard() }
      : { status: 500, body: {} };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const r = handler(url, init);
    return json(r.status, r.body);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function seedLocal(picks: { id: string; groupId: string; songId: string; title: string; available: boolean }[]) {
  window.localStorage.setItem("board-107", JSON.stringify({ picks }));
}

function renderBlock() {
  return render(
    <FanBoardSection eventId="107" locale="ko" seed={SEED} catalog={CATALOG} />,
  );
}

// Two columns render a counter each; these tests are about the expect
// column (want-column behaviour: `board-want-column.test.tsx`).
const expectCol = () => screen.getByTestId("board-col-expect");
const counter = () =>
  within(expectCol()).getByTestId("board-pick-counter").textContent;
const toast = () => screen.getByTestId("board-toast").textContent;

describe("<FanBoardSection> my picks", () => {
  it("adds a pick: POST with string ids, counter 1/3, success feedback, analytics", async () => {
    handler = (url, init) => {
      if (url.startsWith("/api/events/107/board?")) return { status: 200, body: readBoard() };
      if (url === "/api/events/107/board/picks" && init?.method === "POST") {
        return {
          status: 201,
          body: { id: "p-new", groupId: "1", songId: "10", createdAt: "2026-11-01T00:00:00.000Z" },
        };
      }
      return { status: 500, body: {} };
    };
    renderBlock();
    await screen.findByText("add(蓮ノ空)");
    expect(counter()).toBe("counter(0,3)");

    fireEvent.click(screen.getByText("add(蓮ノ空)"));
    // Only this group's songs are offered.
    const picker = screen.getByTestId("picker");
    expect(within(picker).queryByText("pick-30")).toBeNull();
    fireEvent.click(within(picker).getByText("pick-10"));

    await waitFor(() => expect(counter()).toBe("counter(1,3)"));
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST")!;
    const sent = JSON.parse(post[1].body as string);
    expect(sent).toMatchObject({ groupId: "1", songId: "10" });
    expect(typeof sent.anonId).toBe("string");
    expect(sent.anonId.length).toBeGreaterThan(0);
    expect(toast()).toBe("added(蓮ノ空)");
    expect(screen.getAllByTestId("board-my-pick")).toHaveLength(1);
    expect(trackEvent).toHaveBeenCalledWith("board_pick_add", {
      event_id: "107",
      group_id: "1",
      song_id: "10",
    });
    expect(JSON.parse(window.localStorage.getItem("board-107")!).picks[0]).toMatchObject({
      id: "p-new",
      groupId: "1",
      songId: "10",
      title: "残陽",
    });
  });

  it("at 3 picks the add control is disabled with an explanation", async () => {
    seedLocal([
      { id: "a", groupId: "1", songId: "10", title: "残陽", available: true },
      { id: "b", groupId: "1", songId: "11", title: "ハナムスビ", available: true },
      { id: "c", groupId: "1", songId: "12", title: "Dream Believers", available: true },
    ]);
    renderBlock();
    const add = await screen.findByText("add(蓮ノ空)");
    expect(counter()).toBe("counter(3,3)");
    expect((add as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("capReached(3)")).toBeTruthy();
    expect(add.getAttribute("aria-describedby")).toBe("board-cap-pick-1");
  });

  it("the cap is per group: another group's chip starts at 0/3", async () => {
    seedLocal([
      { id: "a", groupId: "1", songId: "10", title: "残陽", available: true },
      { id: "b", groupId: "1", songId: "11", title: "ハナムスビ", available: true },
      { id: "c", groupId: "1", songId: "12", title: "Dream Believers", available: true },
    ]);
    renderBlock();
    await screen.findByText("add(蓮ノ空)");
    fireEvent.click(screen.getByRole("tab", { name: "Liella!" }));
    expect(counter()).toBe("counter(0,3)");
    expect((screen.getByText("add(Liella!)") as HTMLButtonElement).disabled).toBe(false);
  });

  it("a server refusal shows error feedback and changes nothing", async () => {
    handler = (url) =>
      url.startsWith("/api/events/107/board?")
        ? { status: 200, body: readBoard() }
        : { status: 409, body: { error: "cap_reached" } };
    renderBlock();
    fireEvent.click(await screen.findByText("add(蓮ノ空)"));
    fireEvent.click(screen.getByText("pick-10"));
    await waitFor(() => expect(toast()).toBe("errorCap(3)"));
    expect(counter()).toBe("counter(0,3)");
    expect(trackEvent).not.toHaveBeenCalledWith("board_pick_add", expect.anything());
  });

  it("network failure → generic error feedback", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/events/107/board?")) return json(200, readBoard());
      throw new TypeError("Failed to fetch");
    });
    renderBlock();
    fireEvent.click(await screen.findByText("add(蓮ノ空)"));
    fireEvent.click(screen.getByText("pick-11"));
    await waitFor(() => expect(toast()).toBe("errorGeneric(3)"));
  });

  it("a song already picked under another group is refused locally", async () => {
    seedLocal([{ id: "a", groupId: "2", songId: "20", title: "Shared Song", available: true }]);
    renderBlock();
    fireEvent.click(await screen.findByText("add(蓮ノ空)"));
    fireEvent.click(screen.getByText("pick-20"));
    expect(toast()).toBe("errorGroupConflict(3)");
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
  });

  it("a cross-group song shows which group it counts under", async () => {
    seedLocal([{ id: "a", groupId: "1", songId: "20", title: "Shared Song", available: true }]);
    renderBlock();
    await screen.findByText("Shared Song");
    expect(screen.getByText("countedUnder(蓮ノ空)")).toBeTruthy();
  });

  it("removes a pick: DELETE with the server id + anon, success feedback", async () => {
    window.localStorage.setItem(ANON_ID_KEY, "anon-1");
    seedLocal([{ id: "p1", groupId: "1", songId: "10", title: "残陽", available: true }]);
    handler = (url, init) => {
      if (url.startsWith("/api/events/107/board?")) return { status: 200, body: readBoard() };
      if (url === "/api/events/107/board/picks/p1" && init?.method === "DELETE") {
        return { status: 200, body: { id: "p1" } };
      }
      return { status: 500, body: {} };
    };
    renderBlock();
    fireEvent.click(await screen.findByLabelText("removeAria(残陽)"));
    await waitFor(() => expect(counter()).toBe("counter(0,3)"));
    const del = fetchMock.mock.calls.find((c) => c[1]?.method === "DELETE")!;
    expect(JSON.parse(del[1].body as string)).toEqual({ anonId: "anon-1" });
    expect(toast()).toBe("removed");
    expect(trackEvent).toHaveBeenCalledWith("board_pick_remove", {
      event_id: "107",
      group_id: "1",
      song_id: "10",
    });
  });

  it("an unavailable (soft-deleted) song renders without a link and stays removable", async () => {
    seedLocal([{ id: "p1", groupId: "1", songId: "99", title: "消えた曲", available: true }]);
    renderBlock();
    const row = (await screen.findAllByTestId("board-my-pick"))[0];
    // Song 99 is not in the live catalog → unavailable.
    expect(within(row).queryByRole("link")).toBeNull();
    expect(within(row).getByText("(unavailable)")).toBeTruthy();
    expect(within(row).getByLabelText("removeAria(消えた曲)")).toBeTruthy();
    // It still holds a slot.
    expect(counter()).toBe("counter(1,3)");
  });

  it("highlights my picks where they appear in the column", async () => {
    seedLocal([{ id: "p1", groupId: "1", songId: "10", title: "残陽", available: true }]);
    handler = (url) =>
      url.startsWith("/api/events/107/board?")
        ? {
            status: 200,
            body: readBoard({
              top: [
                { songId: "10", title: "残陽", count: 4, available: true },
                { songId: "11", title: "ハナムスビ", count: 3, available: true },
              ],
            }),
          }
        : { status: 500, body: {} };
    renderBlock();
    const entries = await screen.findAllByTestId("board-top-entry");
    expect(entries[0].getAttribute("data-mine")).toBe("true");
    expect(entries[1].getAttribute("data-mine")).toBeNull();
    expect(within(entries[0]).getByText("mineBadge")).toBeTruthy();
  });

  it("restores from /board/mine when nothing is stored locally", async () => {
    window.localStorage.setItem(ANON_ID_KEY, "anon-1");
    handler = (url) => {
      if (url.startsWith("/api/events/107/board?")) return { status: 200, body: readBoard() };
      if (url.startsWith("/api/events/107/board/mine?")) {
        return {
          status: 200,
          body: {
            picks: [
              {
                id: "p9",
                groupId: "1",
                songId: "11",
                title: "ハナムスビ",
                available: false,
                createdAt: "2026-11-01T00:00:00.000Z",
              },
            ],
          },
        };
      }
      return { status: 500, body: {} };
    };
    renderBlock();
    await screen.findByText("ハナムスビ");
    expect(counter()).toBe("counter(1,3)");
    const mineCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/board/mine?"))!;
    // The id rides in the header, never the URL.
    expect(String(mineCall[0])).not.toContain("anon-1");
    expect(new Headers(mineCall[1].headers).get("OpenSetlist-Anon-Token")).toBe("anon-1");
    expect(JSON.parse(window.localStorage.getItem("board-107")!).picks).toHaveLength(1);
  });

  it("a restore cut off by an effect cleanup (StrictMode / locale switch) is asked again", async () => {
    window.localStorage.setItem(ANON_ID_KEY, "anon-1");
    let release: () => void = () => {};
    let mineCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/events/107/board?")) return json(200, readBoard());
      if (url.startsWith("/api/events/107/board/mine?")) {
        mineCalls += 1;
        // Hold the first answer until after the cleanup has run.
        if (mineCalls === 1) await new Promise<void>((r) => (release = r));
        return json(200, {
          picks: [
            { id: "p9", groupId: "1", songId: "11", title: "ハナムスビ", available: true, createdAt: "2026-11-01T00:00:00.000Z" },
          ],
        });
      }
      return json(500, {});
    });
    const view = render(
      <StrictMode>
        <FanBoardSection eventId="107" locale="ko" seed={SEED} catalog={CATALOG} />
      </StrictMode>,
    );
    await waitFor(() => expect(mineCalls).toBe(1));
    // Re-run the effect (its deps change) while request 1 is in flight.
    view.rerender(
      <StrictMode>
        <FanBoardSection eventId="107" locale="ja" seed={SEED} catalog={CATALOG} />
      </StrictMode>,
    );
    release();
    await screen.findByText("ハナムスビ");
    expect(mineCalls).toBe(2);
  });

  it("the header says closed once the block locks at lockAt", async () => {
    render(
      <FanBoardSection
        eventId="107"
        locale="ko"
        seed={{ ...SEED, lockAt: new Date(Date.now() - 1000).toISOString() }}
        catalog={CATALOG}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2 }).nextElementSibling?.textContent).toContain("closed"),
    );
    expect(screen.queryByText(/openUntil/)).toBeNull();
  });

  it("a transient /board/mine failure (503 busy, network) is retried a bounded number of times", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      window.localStorage.setItem(ANON_ID_KEY, "anon-1");
      let mineCalls = 0;
      fetchMock.mockImplementation(async (url: string) => {
        if (url.startsWith("/api/events/107/board?")) return json(200, readBoard());
        if (url.startsWith("/api/events/107/board/mine?")) {
          mineCalls += 1;
          if (mineCalls === 1) return json(503, { error: "busy" });
          if (mineCalls === 2) throw new TypeError("Failed to fetch");
          return json(200, {
            picks: [
              { id: "p9", groupId: "1", songId: "11", title: "ハナムスビ", available: true, createdAt: "2026-11-01T00:00:00.000Z" },
            ],
          });
        }
        return json(500, {});
      });
      renderBlock();
      await waitFor(() => expect(mineCalls).toBe(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      await screen.findByText("ハナムスビ");
      expect(mineCalls).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up after the retry budget on a persistent busy answer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      window.localStorage.setItem(ANON_ID_KEY, "anon-1");
      let mineCalls = 0;
      fetchMock.mockImplementation(async (url: string) => {
        if (url.startsWith("/api/events/107/board?")) return json(200, readBoard());
        if (url.startsWith("/api/events/107/board/mine?")) {
          mineCalls += 1;
          return json(503, { error: "busy" });
        }
        return json(500, {});
      });
      renderBlock();
      await waitFor(() => expect(mineCalls).toBe(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(mineCalls).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not ask /board/mine when picks are stored locally or no anon id exists", async () => {
    renderBlock();
    await screen.findByText("add(蓮ノ空)");
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/board/mine"))).toBe(false);
  });

  it("a board_locked answer flips the block to read-only", async () => {
    seedLocal([{ id: "p1", groupId: "1", songId: "10", title: "残陽", available: true }]);
    handler = (url) =>
      url.startsWith("/api/events/107/board?")
        ? { status: 200, body: readBoard() }
        : { status: 403, body: { error: "board_locked" } };
    renderBlock();
    fireEvent.click(await screen.findByText("add(蓮ノ空)"));
    fireEvent.click(screen.getByText("pick-11"));
    await waitFor(() => expect(toast()).toBe("errorLocked(3)"));
    expect(screen.queryByText("add(蓮ノ空)")).toBeNull();
    expect(screen.queryByLabelText("removeAria(残陽)")).toBeNull();
    // My picks stay visible.
    expect(screen.getByText("残陽")).toBeTruthy();
  });

  it("goes read-only at the lock time even if the read said open", async () => {
    seedLocal([{ id: "p1", groupId: "1", songId: "10", title: "残陽", available: true }]);
    render(
      <FanBoardSection
        eventId="107"
        locale="ko"
        seed={{ ...SEED, lockAt: new Date(Date.now() - 1000).toISOString() }}
        catalog={CATALOG}
      />,
    );
    await screen.findByText("残陽");
    await waitFor(() => expect(screen.queryByText("add(蓮ノ空)")).toBeNull());
    expect(screen.queryByLabelText("removeAria(残陽)")).toBeNull();
  });

  it("a lock more than ~24 days out is still reached (the timer re-arms)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const lockAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    try {
      render(
        <FanBoardSection
          eventId="107"
          locale="ko"
          seed={{ ...SEED, lockAt: lockAt.toISOString() }}
          catalog={CATALOG}
        />,
      );
      await screen.findByText("add(蓮ノ空)");
      await act(async () => {
        vi.advanceTimersByTime(30 * 24 * 60 * 60 * 1000 + 1000);
      });
      expect(screen.queryByText("add(蓮ノ空)")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a locked board shows my picks without add/remove controls", async () => {
    seedLocal([{ id: "p1", groupId: "1", songId: "10", title: "残陽", available: true }]);
    handler = (url) =>
      url.startsWith("/api/events/107/board?")
        ? { status: 200, body: readBoard({ locked: true }) }
        : { status: 500, body: {} };
    renderBlock();
    await screen.findByText("残陽");
    expect(screen.queryByText("add(蓮ノ空)")).toBeNull();
    expect(screen.queryByLabelText("removeAria(残陽)")).toBeNull();
  });
});
