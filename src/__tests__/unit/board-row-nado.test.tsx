import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// One-tap 「나도」 on fan board rows (n17), through the whole block
// with a mocked board read and mocked pick/wish routes: every state of
// the row button (default / checked / pending / unavailable / 3-of-3 /
// picked under another group / starter row / locked), the shared write
// path with `source: "row"` analytics, per-column scoping, and no
// optimistic change to the public count.

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, values?: Record<string, unknown>) =>
      values ? `${key}(${Object.values(values).join(",")})` : key,
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/components/predict/SongPickerSheet", () => ({
  SongPickerSheet: () => null,
}));

import { FanBoardSection } from "@/components/board/FanBoardSection";
import { trackEvent } from "@/lib/analytics";
import { ANON_ID_KEY } from "@/lib/anonId";
import type {
  BoardBlockSeed,
  BoardColumn,
  BoardReadResponse,
  BoardSongRef,
} from "@/lib/board/types";
import type { AvailableSong } from "@/lib/types/predict";

const LOCK = "2099-11-14T07:30:00.000Z";
const ANON = "0f5e7c1a-1111-4222-8333-444455556666";
const SEED: BoardBlockSeed = {
  lockAt: LOCK,
  chips: [
    { groupId: "1", slug: "hasunosora", label: "蓮ノ空", color: null },
    { groupId: "2", slug: "liella", label: "Liella!", color: null },
  ],
  share: { eventName: "Fes Day.1", path: "/ko/events/107/fes-day1" },
};
const EMPTY: BoardColumn = {
  top: [],
  submissions: 0,
  participants: 0,
  label: "operator",
};

function crowd(
  rows: { songId: string; title: string; count: number; available?: boolean }[],
): BoardColumn {
  const total = rows.reduce((n, r) => n + r.count, 0);
  return {
    top: rows.map((r) => ({ ...r, available: r.available ?? true })),
    submissions: total,
    participants: total,
    label: "early",
  };
}

function readBoard(
  over: {
    wishes?: BoardColumn;
    expects?: BoardColumn;
    starters?: BoardSongRef[];
    locked?: boolean;
  } = {},
): BoardReadResponse {
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
        wishes: over.wishes ?? EMPTY,
        expects: over.expects ?? EMPTY,
        starters: over.starters ?? [],
      },
      {
        groupId: "2",
        slug: "liella",
        name: "Liella!",
        color: null,
        wishes: EMPTY,
        expects: EMPTY,
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
    unit: { artistId: groups[0] ?? 0, slug: `g${groups[0] ?? 0}`, label: `g${groups[0] ?? 0}`, color: "#888888", isSubUnit: false, isMainUnit: false },
    isMultiArtist: false,
    creditedArtistIds: groups.slice(0, 1),
    releaseDate: null,
  } as unknown as AvailableSong;
}

const CATALOG = [
  song(10, "残陽", [1, 2]),
  song(11, "ハナムスビ", [1]),
  song(12, "Dream Believers", [1]),
  song(13, "Special Thanks", [1]),
  song(30, "始まりは君の空", [2]),
];

const ZANYO = [{ songId: "10", title: "残陽", count: 4 }];

const fetchMock = vi.fn();
type Reply = { status: number; body: unknown };
type Handler = (url: string, init?: RequestInit) => Reply | Promise<Reply>;
let handler: Handler;

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(ANON_ID_KEY, ANON);
  window.location.hash = "";
  handler = (url) =>
    url.startsWith("/api/events/107/board?")
      ? { status: 200, body: readBoard() }
      : { status: 500, body: {} };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const r = await handler(url, init);
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function renderBlock() {
  return render(
    <FanBoardSection eventId="107" locale="ko" seed={SEED} catalog={CATALOG} />,
  );
}

const wantCol = () => within(screen.getByTestId("board-col-want"));
const expectCol = () => within(screen.getByTestId("board-col-expect"));
const toast = () => screen.getByTestId("board-toast").textContent;
const posts = () =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");

function storeWishes(entries: { dbId: string; songId: number; title: string; groupId: string }[]) {
  window.localStorage.setItem(
    "wish-107",
    JSON.stringify({
      wishes: entries.map((e) => ({
        songId: e.songId,
        dbId: e.dbId,
        song: {
          originalTitle: e.title,
          originalLanguage: "ja",
          variantLabel: null,
          baseVersionId: null,
          translations: [],
        },
        groupId: e.groupId,
      })),
    }),
  );
}

function storePicks(entries: { id: string; songId: string; title: string; groupId: string }[]) {
  window.localStorage.setItem(
    "board-107",
    JSON.stringify({ picks: entries.map((e) => ({ ...e, available: true })) }),
  );
}

describe("<FanBoardSection> one-tap 나도 on rows", () => {
  it("shows a column-specific button on crowd rows; the title stays the song link", async () => {
    handler = (url) =>
      url.includes("/board?")
        ? { status: 200, body: readBoard({ wishes: crowd(ZANYO), expects: crowd(ZANYO) }) }
        : { status: 500, body: {} };
    renderBlock();
    const want = await screen.findByTestId("board-col-want");
    const wantBtn = within(want).getByTestId("board-nado");
    expect(wantBtn.textContent).toBe("nadoWish");
    expect(wantBtn.getAttribute("aria-pressed")).toBe("false");
    expect(wantBtn.getAttribute("aria-label")).toBe("nadoWishAria(残陽)");
    expect(wantBtn.closest("a")).toBeNull();
    const link = within(want).getByText("残陽").closest("a");
    expect(link?.getAttribute("href")).toContain("/songs/10");
    expect(expectCol().getByTestId("board-nado").textContent).toBe("nadoExpect");
  });

  it("adds through the wish route, checks the row, counts 1/3, tracks source=row, keeps the public count", async () => {
    let releaseRead: ((r: Reply) => void) | null = null;
    let reads = 0;
    handler = (url, init) => {
      if (url.includes("/board?")) {
        reads++;
        // The follow-up read after the save is held, so the row's count
        // must still be the cached aggregate's — never a local +1.
        if (reads === 2) return new Promise<Reply>((resolve) => { releaseRead = resolve; });
        return { status: 200, body: readBoard({ wishes: crowd(ZANYO) }) };
      }
      if (url === "/api/events/107/wishes" && init?.method === "POST") {
        return { status: 201, body: { id: "w1", groupId: "1", songId: "10" } };
      }
      return { status: 500, body: {} };
    };
    renderBlock();
    fireEvent.click((await screen.findAllByTestId("board-nado"))[0]);
    await waitFor(() =>
      expect(wantCol().getByTestId("board-nado").getAttribute("aria-pressed")).toBe("true"),
    );
    const [, init] = posts()[0];
    expect(JSON.parse(String(init?.body))).toEqual({ groupId: "1", songId: "10", anonId: ANON });
    expect(trackEvent).toHaveBeenCalledWith("board_wish_add", {
      event_id: "107",
      group_id: "1",
      song_id: "10",
      source: "row",
    });
    expect(toast()).toBe("addedWish(蓮ノ空)");
    expect(
      within(wantCol().getByTestId("board-my-wishes")).getByTestId("board-pick-counter").textContent,
    ).toBe("counter(1,3)");
    // The picker's own list shows the same entry.
    expect(within(wantCol().getByTestId("board-my-wishes")).getByText("残陽")).toBeTruthy();
    expect(wantCol().getByText("submissions(4)")).toBeTruthy();
    await waitFor(() => expect(releaseRead).not.toBeNull());
    await act(async () => { releaseRead!({ status: 200, body: readBoard({ wishes: crowd([{ ...ZANYO[0], count: 5 }]) }) }); });
    expect(wantCol().getByText("submissions(5)")).toBeTruthy();
  });

  it("removes a checked row through the delete route with source=row", async () => {
    storeWishes([{ dbId: "w1", songId: 10, title: "残陽", groupId: "1" }]);
    handler = (url, init) => {
      if (url.includes("/board?")) return { status: 200, body: readBoard({ wishes: crowd(ZANYO) }) };
      if (url === "/api/events/107/wishes/w1" && init?.method === "DELETE") {
        return { status: 200, body: { id: "w1" } };
      }
      return { status: 500, body: {} };
    };
    renderBlock();
    await waitFor(() =>
      expect(wantCol().getByTestId("board-nado").getAttribute("aria-pressed")).toBe("true"),
    );
    fireEvent.click(wantCol().getByTestId("board-nado"));
    await waitFor(() =>
      expect(wantCol().getByTestId("board-nado").getAttribute("aria-pressed")).toBe("false"),
    );
    expect(trackEvent).toHaveBeenCalledWith("board_wish_remove", {
      event_id: "107",
      group_id: "1",
      song_id: "10",
      source: "row",
    });
    expect(toast()).toBe("removedWish");
  });

  it("blocks repeat taps while the write is pending", async () => {
    let finish: ((r: Reply) => void) | null = null;
    handler = (url, init) => {
      if (url.includes("/board?")) return { status: 200, body: readBoard({ expects: crowd(ZANYO) }) };
      if (url === "/api/events/107/board/picks" && init?.method === "POST") {
        return new Promise<Reply>((resolve) => { finish = resolve; });
      }
      return { status: 500, body: {} };
    };
    renderBlock();
    const btn = await waitFor(() => expectCol().getByTestId("board-nado"));
    fireEvent.click(btn);
    await waitFor(() => expect(expectCol().getByTestId("board-nado")).toHaveProperty("disabled", true));
    fireEvent.click(expectCol().getByTestId("board-nado"));
    expect(posts()).toHaveLength(1);
    await act(async () => {
      finish!({ status: 201, body: { id: "p1", groupId: "1", songId: "10" } });
    });
    await waitFor(() =>
      expect(expectCol().getByTestId("board-nado").getAttribute("aria-pressed")).toBe("true"),
    );
    expect(trackEvent).toHaveBeenCalledWith("board_pick_add", expect.objectContaining({ source: "row" }));
  });

  it("offers no add on an unavailable song, but keeps my own vote removable", async () => {
    storeWishes([{ dbId: "w2", songId: 11, title: "ハナムスビ", groupId: "1" }]);
    handler = (url) =>
      url.includes("/board?")
        ? {
            status: 200,
            body: readBoard({
              wishes: crowd([
                { songId: "10", title: "残陽", count: 3, available: false },
                { songId: "11", title: "ハナムスビ", count: 2, available: false },
              ]),
            }),
          }
        : { status: 500, body: {} };
    renderBlock();
    await waitFor(() => expect(wantCol().getAllByTestId("board-top-entry")).toHaveLength(2));
    const [other, mine] = wantCol().getAllByTestId("board-top-entry");
    expect(within(other).queryByTestId("board-nado")).toBeNull();
    const btn = within(mine).getByTestId("board-nado");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn).toHaveProperty("disabled", false);
  });

  it("disables adds at 3/3 with the reason, refused locally; my rows stay removable", async () => {
    storeWishes([
      { dbId: "w1", songId: 11, title: "ハナムスビ", groupId: "1" },
      { dbId: "w2", songId: 12, title: "Dream Believers", groupId: "1" },
      { dbId: "w3", songId: 13, title: "Special Thanks", groupId: "1" },
    ]);
    handler = (url) =>
      url.includes("/board?")
        ? {
            status: 200,
            body: readBoard({
              wishes: crowd([
                { songId: "10", title: "残陽", count: 5 },
                { songId: "11", title: "ハナムスビ", count: 2 },
              ]),
              expects: crowd(ZANYO),
            }),
          }
        : { status: 500, body: {} };
    renderBlock();
    await waitFor(() => expect(wantCol().getByTestId("board-row-cap")).toBeTruthy());
    const [full, mine] = wantCol().getAllByTestId("board-top-entry");
    const blocked = within(full).getByTestId("board-nado");
    expect(blocked).toHaveProperty("disabled", true);
    const note = wantCol().getByTestId("board-row-cap");
    expect(note.textContent).toBe("rowCapNote(3)");
    expect(blocked.getAttribute("aria-describedby")).toBe(note.id);
    fireEvent.click(blocked);
    expect(posts()).toHaveLength(0);
    expect(within(mine).getByTestId("board-nado")).toHaveProperty("disabled", false);
    // The expect column has its own cap: the same song is addable there.
    expect(expectCol().getByTestId("board-nado")).toHaveProperty("disabled", false);
    expect(expectCol().queryByTestId("board-row-cap")).toBeNull();
  });

  it("at 3/3, a song mine under another group says where, not why the cap", async () => {
    storeWishes([
      { dbId: "w1", songId: 11, title: "ハナムスビ", groupId: "1" },
      { dbId: "w2", songId: 12, title: "Dream Believers", groupId: "1" },
      { dbId: "w3", songId: 13, title: "Special Thanks", groupId: "1" },
      { dbId: "w9", songId: 10, title: "残陽", groupId: "2" },
    ]);
    handler = (url) =>
      url.includes("/board?")
        ? { status: 200, body: readBoard({ wishes: crowd(ZANYO) }) }
        : { status: 500, body: {} };
    renderBlock();
    await waitFor(() => expect(wantCol().getByTestId("board-nado-elsewhere")).toBeTruthy());
    expect(wantCol().getByTestId("board-nado-elsewhere").textContent).toBe(
      "pickedElsewhere(Liella!)",
    );
    // No cap-disabled row is left, so no cap note either; the counter
    // proves the column did load at 3/3.
    expect(
      within(wantCol().getByTestId("board-my-wishes")).getByTestId("board-pick-counter").textContent,
    ).toBe("counter(3,3)");
    expect(wantCol().queryByTestId("board-row-cap")).toBeNull();
  });

  // The client-side half (no request at 3/3) is the test above; this
  // is the server half as the row sees it: a 409 the local state could
  // not predict (another tab filled the cap) reads like the picker's.
  it("surfaces a server 409 cap refusal the same way the picker does", async () => {
    handler = (url, init) => {
      if (url.includes("/board?")) return { status: 200, body: readBoard({ wishes: crowd(ZANYO) }) };
      if (url === "/api/events/107/wishes" && init?.method === "POST") {
        // Another tab filled the cap after this one last read storage.
        return { status: 409, body: { error: "cap_reached", code: "cap_reached" } };
      }
      return { status: 500, body: {} };
    };
    renderBlock();
    fireEvent.click(await waitFor(() => wantCol().getByTestId("board-nado")));
    await waitFor(() => expect(toast()).toBe("errorCap(3)"));
    expect(wantCol().getByTestId("board-nado").getAttribute("aria-pressed")).toBe("false");
    expect(window.localStorage.getItem("wish-107")).toBeNull();
  });

  it("says where a song already counts instead of moving it, per column", async () => {
    // Picked (expect) under Liella!, not wished anywhere.
    storePicks([{ id: "p9", songId: "10", title: "残陽", groupId: "2" }]);
    handler = (url) =>
      url.includes("/board?")
        ? { status: 200, body: readBoard({ wishes: crowd(ZANYO), expects: crowd(ZANYO) }) }
        : { status: 500, body: {} };
    renderBlock();
    await waitFor(() => expect(expectCol().getByTestId("board-nado-elsewhere")).toBeTruthy());
    expect(expectCol().getByTestId("board-nado-elsewhere").textContent).toBe(
      "pickedElsewhere(Liella!)",
    );
    expect(expectCol().queryByTestId("board-nado")).toBeNull();
    // A wish and an expect pick of the same song are independent.
    expect(wantCol().getByTestId("board-nado").getAttribute("aria-pressed")).toBe("false");
  });

  it("puts the button on operator starter rows too", async () => {
    handler = (url, init) => {
      if (url.includes("/board?")) {
        return { status: 200, body: readBoard({ starters: [{ songId: "12", title: "Dream Believers" }] }) };
      }
      if (url === "/api/events/107/board/picks" && init?.method === "POST") {
        return { status: 201, body: { id: "p1", groupId: "1", songId: "12" } };
      }
      return { status: 500, body: {} };
    };
    renderBlock();
    const starter = (await screen.findAllByTestId("board-starter")).find((el) =>
      screen.getByTestId("board-col-expect").contains(el),
    )!;
    fireEvent.click(within(starter).getByTestId("board-nado"));
    await waitFor(() =>
      expect(within(starter).getByTestId("board-nado").getAttribute("aria-pressed")).toBe("true"),
    );
    expect(JSON.parse(String(posts()[0][1]?.body))).toMatchObject({ groupId: "1", songId: "12" });
  });

  it("renders no row buttons once the board is locked", async () => {
    storeWishes([{ dbId: "w1", songId: 10, title: "残陽", groupId: "1" }]);
    handler = (url) =>
      url.includes("/board?")
        ? {
            status: 200,
            body: readBoard({ locked: true, wishes: crowd(ZANYO), expects: crowd(ZANYO) }),
          }
        : { status: 500, body: {} };
    renderBlock();
    await waitFor(() => expect(screen.getAllByTestId("board-top-entry")).toHaveLength(2));
    expect(screen.queryAllByTestId("board-nado")).toHaveLength(0);
    // My vote still reads as mine.
    expect(wantCol().getByText("mineWishBadge")).toBeTruthy();
  });
});
