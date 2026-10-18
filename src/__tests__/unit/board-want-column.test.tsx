import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// The "want" column of the fan board (n15-08), through the whole block
// with a mocked board read and mocked wish routes: two columns per
// group, my wishes (POST/DELETE on the shared wish route with anon +
// group), the cap per group independent of picks, highlight in the
// crowd TOP3, `board_wish_*` analytics, the shared `wish-{eventId}`
// storage, and legacy wishes (listed apart, removable, never re-posted).

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, values?: Record<string, unknown>) =>
      values ? `${key}(${Object.values(values).join(",")})` : key,
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
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
import type {
  BoardBlockSeed,
  BoardColumn,
  BoardReadResponse,
} from "@/lib/board/types";
import type { AvailableSong } from "@/lib/types/predict";

const LOCK = "2026-11-14T07:30:00.000Z";
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

function readBoard(
  over: { wishes?: BoardColumn; expects?: BoardColumn; locked?: boolean } = {},
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
        starters: [],
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
  } as unknown as AvailableSong;
}

const CATALOG = [
  song(10, "残陽", [1]),
  song(11, "ハナムスビ", [1]),
  song(12, "Dream Believers", [1]),
  song(13, "Special Thanks", [1]),
  song(30, "始まりは君の空", [2]),
];

const fetchMock = vi.fn();
type Handler = (url: string, init?: RequestInit) => { status: number; body: unknown };
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
    const r = handler(url, init);
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
const stored = () =>
  JSON.parse(window.localStorage.getItem("wish-107") ?? '{"wishes":[]}').wishes;

function legacyEntry(dbId: string, songId: number, title: string) {
  return {
    songId,
    dbId,
    song: {
      originalTitle: title,
      originalLanguage: "ja",
      variantLabel: null,
      baseVersionId: null,
      translations: [],
    },
  };
}

describe("<FanBoardSection> want column", () => {
  it("renders want and expect side by side, want first, with the explainer", async () => {
    renderBlock();
    const want = await screen.findByTestId("board-col-want");
    const expectEl = screen.getByTestId("board-col-expect");
    expect(
      want.compareDocumentPosition(expectEl) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(want).getByText("colWant")).toBeTruthy();
    expect(within(expectEl).getByText("colExpect")).toBeTruthy();
    expect(screen.getByText("explainer")).toBeTruthy();
    // Each column has its own "mine" section.
    expect(within(want).getByTestId("board-my-wishes")).toBeTruthy();
    expect(within(expectEl).getByTestId("board-my-picks")).toBeTruthy();
  });

  it("adds a wish: POST to the wish route with anon + group, counter 1/3, storage, analytics", async () => {
    handler = (url, init) => {
      if (url.startsWith("/api/events/107/board?")) return { status: 200, body: readBoard() };
      if (url === "/api/events/107/wishes" && init?.method === "POST") {
        return {
          status: 201,
          body: { id: "w-new", groupId: "1", songId: "10", createdAt: "2026-11-01T00:00:00.000Z" },
        };
      }
      return { status: 500, body: {} };
    };
    renderBlock();
    fireEvent.click(await screen.findByText("addWish(蓮ノ空)"));
    fireEvent.click(within(screen.getByTestId("picker")).getByText("pick-10"));
    await waitFor(() => expect(toast()).toBe("addedWish(蓮ノ空)"));

    const post = fetchMock.mock.calls.find(([u]) => u === "/api/events/107/wishes");
    expect(JSON.parse(post![1].body)).toEqual({ groupId: "1", songId: "10", anonId: ANON });
    expect(wantCol().getByTestId("board-pick-counter").textContent).toBe("counter(1,3)");
    // The expect column is a separate ballot.
    expect(expectCol().getByTestId("board-pick-counter").textContent).toBe("counter(0,3)");
    expect(trackEvent).toHaveBeenCalledWith("board_wish_add", {
      event_id: "107",
      group_id: "1",
      song_id: "10",
    });
    expect(trackEvent).not.toHaveBeenCalledWith("wish_add", expect.anything());
    // Stored in the shared wishlist key, tagged with its group.
    expect(stored()).toEqual([
      expect.objectContaining({ songId: 10, dbId: "w-new", groupId: "1" }),
    ]);
  });

  it("removes a wish: DELETE with the anon id; board_wish_remove", async () => {
    window.localStorage.setItem(
      "wish-107",
      JSON.stringify({ wishes: [{ ...legacyEntry("w1", 10, "残陽"), groupId: "1" }] }),
    );
    handler = (url, init) => {
      if (url.startsWith("/api/events/107/board?")) return { status: 200, body: readBoard() };
      if (url === "/api/events/107/wishes/w1" && init?.method === "DELETE") {
        return { status: 200, body: { id: "w1" } };
      }
      return { status: 500, body: {} };
    };
    renderBlock();
    fireEvent.click(await wantColAsync().then((c) => c.findByLabelText("removeAria(残陽)")));
    await waitFor(() => expect(toast()).toBe("removedWish"));
    const del = fetchMock.mock.calls.find(([u]) => u === "/api/events/107/wishes/w1");
    expect(JSON.parse(del![1].body)).toEqual({ anonId: ANON });
    expect(trackEvent).toHaveBeenCalledWith("board_wish_remove", {
      event_id: "107",
      group_id: "1",
      song_id: "10",
    });
    expect(stored()).toEqual([]);
  });

  it("at 3 wishes in a group the want add is disabled; picks are unaffected", async () => {
    window.localStorage.setItem(
      "wish-107",
      JSON.stringify({
        wishes: [10, 11, 12].map((id) => ({
          ...legacyEntry(`w${id}`, id, `s${id}`),
          groupId: "1",
        })),
      }),
    );
    renderBlock();
    const add = (await screen.findByText("addWish(蓮ノ空)")) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(wantCol().getByText("capReached(3)")).toBeTruthy();
    expect((screen.getByText("add(蓮ノ空)") as HTMLButtonElement).disabled).toBe(false);
  });

  it("a server cap refusal shows the error and changes nothing", async () => {
    handler = (url, init) => {
      if (url.startsWith("/api/events/107/board?")) return { status: 200, body: readBoard() };
      if (url === "/api/events/107/wishes" && init?.method === "POST") {
        return { status: 409, body: { error: "cap_reached" } };
      }
      return { status: 500, body: {} };
    };
    renderBlock();
    fireEvent.click(await screen.findByText("addWish(蓮ノ空)"));
    fireEvent.click(within(screen.getByTestId("picker")).getByText("pick-11"));
    await waitFor(() => expect(toast()).toBe("errorCap(3)"));
    expect(wantCol().getByTestId("board-pick-counter").textContent).toBe("counter(0,3)");
    expect(stored()).toEqual([]);
  });

  it("crowd TOP3 wishes with counts and labels; my wishes highlighted there", async () => {
    window.localStorage.setItem(
      "wish-107",
      JSON.stringify({ wishes: [{ ...legacyEntry("w1", 11, "ハナムスビ"), groupId: "1" }] }),
    );
    handler = (url) =>
      url.startsWith("/api/events/107/board?")
        ? {
            status: 200,
            body: readBoard({
              wishes: {
                top: [
                  { songId: "10", title: "残陽", count: 7, available: true },
                  { songId: "11", title: "ハナムスビ", count: 5, available: true },
                ],
                submissions: 12,
                participants: 3,
                label: "early",
              },
            }),
          }
        : { status: 500, body: {} };
    renderBlock();
    const col = await wantColAsync();
    const entries = await col.findAllByTestId("board-top-entry");
    expect(entries.map((e) => e.textContent)).toEqual([
      expect.stringContaining("submissions(7)"),
      expect.stringContaining("submissions(5)"),
    ]);
    expect(entries[1]).toHaveAttribute("data-mine", "true");
    expect(entries[1]).toHaveTextContent("mineWishBadge");
    expect(col.getByTestId("board-early")).toBeTruthy();
    // A wish is not a pick: the expect column shows no highlight.
    expect(expectCol().queryAllByTestId("board-top-entry")).toHaveLength(0);
  });

  it("a crowd song click in the want column is tracked as column: want", async () => {
    handler = (url) =>
      url.startsWith("/api/events/107/board?")
        ? {
            status: 200,
            body: readBoard({
              wishes: {
                top: [{ songId: "10", title: "残陽", count: 7, available: true }],
                submissions: 7,
                participants: 6,
                label: "ok",
              },
            }),
          }
        : { status: 500, body: {} };
    renderBlock();
    fireEvent.click(await screen.findByRole("link", { name: "残陽" }));
    expect(trackEvent).toHaveBeenCalledWith("board_song_click", {
      event_id: "107",
      group_id: "1",
      song_id: "10",
      column: "want",
      source: "crowd",
    });
  });

  it("legacy wishes: listed apart, never counted toward a group's 3, removable, never re-posted", async () => {
    window.localStorage.setItem(
      "wish-107",
      JSON.stringify({
        wishes: [
          legacyEntry("old-1", 10, "残陽"),
          { ...legacyEntry("w2", 11, "ハナムスビ"), groupId: "1" },
        ],
      }),
    );
    handler = (url, init) => {
      if (url.startsWith("/api/events/107/board?")) return { status: 200, body: readBoard() };
      if (url === "/api/events/107/wishes/old-1" && init?.method === "DELETE") {
        return { status: 200, body: { id: "old-1" } };
      }
      return { status: 500, body: {} };
    };
    renderBlock();
    const legacy = await screen.findByTestId("board-legacy-wishes");
    expect(within(legacy).getAllByTestId("board-legacy-wish")).toHaveLength(1);
    expect(within(legacy).getByText("残陽")).toBeTruthy();
    // Only the grouped wish uses a slot.
    expect(wantCol().getByTestId("board-pick-counter").textContent).toBe("counter(1,3)");

    fireEvent.click(within(legacy).getByLabelText("removeAria(残陽)"));
    await waitFor(() => expect(screen.queryByTestId("board-legacy-wishes")).toBeNull());
    // The grouped wish survives the legacy removal in storage.
    expect(stored()).toEqual([expect.objectContaining({ dbId: "w2", groupId: "1" })]);
    // Nothing was ever POSTed: the legacy wish is not re-filed under a group.
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST"),
    ).toBe(false);
    expect(trackEvent).not.toHaveBeenCalledWith("board_wish_remove", expect.anything());
  });

  it("a /board/mine restore fills my wishes, but never hands back legacy rows", async () => {
    handler = (url) => {
      if (url.startsWith("/api/events/107/board?")) return { status: 200, body: readBoard() };
      if (url.startsWith("/api/events/107/board/mine")) {
        return {
          status: 200,
          body: {
            picks: [],
            wishes: [
              {
                id: "w9",
                groupId: "1",
                songId: "12",
                title: "Dream Believers",
                available: true,
                createdAt: "2026-11-01T00:00:00.000Z",
              },
            ],
          },
        };
      }
      return { status: 500, body: {} };
    };
    renderBlock();
    const col = await wantColAsync();
    expect(await col.findByText("Dream Believers")).toBeTruthy();
    expect(stored()).toEqual([
      expect.objectContaining({ dbId: "w9", songId: 12, groupId: "1" }),
    ]);
  });

  it("locked board: no add / remove in the want column, legacy wishes read-only", async () => {
    window.localStorage.setItem(
      "wish-107",
      JSON.stringify({
        wishes: [
          legacyEntry("old-1", 10, "残陽"),
          { ...legacyEntry("w2", 11, "ハナムスビ"), groupId: "1" },
        ],
      }),
    );
    handler = (url) =>
      url.startsWith("/api/events/107/board?")
        ? { status: 200, body: readBoard({ locked: true }) }
        : { status: 500, body: {} };
    renderBlock();
    await screen.findByTestId("board-legacy-wishes");
    expect(screen.queryByText("addWish(蓮ノ空)")).toBeNull();
    expect(screen.queryByLabelText("removeAria(残陽)")).toBeNull();
    expect(screen.queryByLabelText("removeAria(ハナムスビ)")).toBeNull();
  });
});

async function wantColAsync() {
  return within(await screen.findByTestId("board-col-want"));
}
