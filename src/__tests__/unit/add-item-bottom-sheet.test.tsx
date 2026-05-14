import { describe, it, expect, afterEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    if (vars) return `${key}:${JSON.stringify(vars)}`;
    return key;
  },
}));

vi.mock("@/hooks/useMounted", () => ({
  useMounted: () => true,
}));

// vaul Drawer compiles down to a portal + animated panel. The tests
// don't need the animation/portal — replace with a plain conditional
// wrapper that exposes the same children when `open` is true. Keeps
// the assertions DOM-shallow (no portal traversal) and avoids
// requestAnimationFrame in jsdom.
vi.mock("vaul", () => {
  const passthrough = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Drawer: {
      Root: ({
        open,
        children,
      }: {
        open: boolean;
        children: React.ReactNode;
      }) => (open ? <div role="dialog">{children}</div> : null),
      Portal: passthrough,
      Overlay: passthrough,
      Content: passthrough,
      Title: ({ children }: { children: React.ReactNode }) => (
        <h2>{children}</h2>
      ),
    },
  };
});

// SongSearch is exercised by its own test suite; here we just need a
// stub that lets us simulate a pick. Render a button per "song id"
// the test wants to expose, and fire onSelect with a fixture artist
// type so deriveStageType has data to work with.
vi.mock("@/components/SongSearch", () => ({
  SongSearch: ({
    onSelect,
  }: {
    onSelect: (
      song: { id: number; originalTitle: string; artists: { artist: { id: number; type: string } }[] },
      variant: undefined,
    ) => void;
  }) => (
    <div>
      <button
        data-testid="pick-fullgroup-song"
        onClick={() =>
          onSelect(
            {
              id: 1,
              originalTitle: "Dream Believers",
              originalLanguage: "ja",
              variantLabel: null,
              baseVersionId: null,
              translations: [],
              artists: [
                {
                  artist: {
                    id: 100,
                    type: "group",
                    originalName: "Hasunosora",
                    originalShortName: null,
                    originalLanguage: "ja",
                    translations: [],
                  },
                },
              ],
            } as never,
            undefined,
          )
        }
      >
        pick full-group
      </button>
      <button
        data-testid="pick-unit-song"
        onClick={() =>
          onSelect(
            {
              id: 2,
              originalTitle: "Holiday∞Holiday",
              originalLanguage: "ja",
              variantLabel: null,
              baseVersionId: null,
              translations: [],
              artists: [
                {
                  artist: {
                    id: 200,
                    type: "unit",
                    originalName: "スリーズブーケ",
                    originalShortName: null,
                    originalLanguage: "ja",
                    translations: [],
                  },
                },
              ],
            } as never,
            undefined,
          )
        }
      >
        pick unit
      </button>
    </div>
  ),
}));

import { AddItemBottomSheet } from "@/components/AddItemBottomSheet";

const EVENT_PERFORMERS = [
  {
    stageIdentityId: "si-1",
    originalName: "세라스",
    originalShortName: null,
    originalLanguage: "ko",
    translations: [],
    isGuest: false,
    artistLinks: [{ artistId: 200 }],
  },
  {
    stageIdentityId: "si-2",
    originalName: "히메",
    originalShortName: null,
    originalLanguage: "ko",
    translations: [],
    isGuest: false,
    artistLinks: [{ artistId: 200 }],
  },
  {
    stageIdentityId: "si-3",
    originalName: "코스즈",
    originalShortName: null,
    originalLanguage: "ko",
    translations: [],
    isGuest: false,
    artistLinks: [{ artistId: 200 }],
  },
  {
    stageIdentityId: "si-4",
    originalName: "루리노",
    originalShortName: null,
    originalLanguage: "ko",
    translations: [],
    isGuest: false,
    artistLinks: [{ artistId: 999 }], // not in the unit
  },
];

function mockFetch(
  routes: Record<string, unknown | ((url: string) => unknown)>,
) {
  const spy = vi.fn().mockImplementation((url: string) => {
    const handler = Object.entries(routes).find(([prefix]) =>
      url.startsWith(prefix),
    );
    if (!handler) {
      return Promise.resolve({
        ok: false,
        status: 404,
        json: async () => ({ error: "no_mock" }),
      } as unknown as Response);
    }
    const body =
      typeof handler[1] === "function"
        ? (handler[1] as (url: string) => unknown)(url)
        : handler[1];
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => body,
    } as unknown as Response);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

// Flushes a few microtask cycles. Component effects chain through
// fetch → .json() → state update → re-render → next-effect's fetch
// → ... so a single `await Promise.resolve()` only clears one level.
// 12 iterations is empirically enough to cover the deepest path
// (eventPerformers fetch → song pick → current-members fetch → set
// intersection → render). Cheap; no flakiness from real timers.
async function flushPromises() {
  await act(async () => {
    for (let i = 0; i < 12; i++) {
      await Promise.resolve();
    }
  });
}

describe("AddItemBottomSheet", () => {
  // Real timers — SongSearch is mocked out so its debounce timer
  // doesn't run; fake timers would only complicate microtask
  // ordering in the fetch-chain effects.
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders nothing when open=false", () => {
    mockFetch({});
    render(
      <AddItemBottomSheet
        eventId="1"
        locale="ko"
        open={false}
        presetPosition={null}
        items={[]}
        onClose={vi.fn()}
        onSubmitSuccess={vi.fn()}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the song picker on open with itemType=song (default)", async () => {
    mockFetch({
      "/api/events/1/performers": { performers: EVENT_PERFORMERS },
    });
    render(
      <AddItemBottomSheet
        eventId="1"
        locale="ko"
        open
        presetPosition={5}
        items={[]}
        onClose={vi.fn()}
        onSubmitSuccess={vi.fn()}
      />,
    );
    await flushPromises();
    // SongSearch stub renders these buttons; presence = picker visible.
    expect(screen.getByTestId("pick-fullgroup-song")).toBeInTheDocument();
    expect(screen.getByTestId("pick-unit-song")).toBeInTheDocument();
  });

  it("hides the song picker when itemType is MC", async () => {
    mockFetch({
      "/api/events/1/performers": { performers: EVENT_PERFORMERS },
    });
    render(
      <AddItemBottomSheet
        eventId="1"
        locale="ko"
        open
        presetPosition={5}
        items={[]}
        onClose={vi.fn()}
        onSubmitSuccess={vi.fn()}
      />,
    );
    await flushPromises();
    // Flip itemType to MC via the selector. The radio buttons use the
    // i18n keys as labels (passthrough mock); find by role.
    const mcButton = screen.getByRole("radio", { name: "itemTypeMc" });
    fireEvent.click(mcButton);
    expect(screen.queryByTestId("pick-fullgroup-song")).toBeNull();
  });

  it("auto-checks all non-guest event performers for a full-group song pick", async () => {
    mockFetch({
      "/api/events/1/performers": { performers: EVENT_PERFORMERS },
    });
    render(
      <AddItemBottomSheet
        eventId="1"
        locale="ko"
        open
        presetPosition={5}
        items={[]}
        onClose={vi.fn()}
        onSubmitSuccess={vi.fn()}
      />,
    );
    // waitFor polls until the eventPerformers fetch resolves and the
    // PerformerChecklist renders 4 boxes. Microtask flushing
    // (`await Promise.resolve()` loops) wasn't reliably picking up
    // the chained `.then`s + state-update + re-render path on every
    // run; waitFor keeps polling so the post-fetch state lands
    // deterministically.
    await waitFor(() =>
      expect(screen.getAllByRole("checkbox").length).toBe(4),
    );
    fireEvent.click(screen.getByTestId("pick-fullgroup-song"));
    await waitFor(() => {
      const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
      expect(boxes.length).toBe(4);
      expect(boxes.every((b) => b.checked)).toBe(true);
    });
  });

  it("auto-checks only the unit's current members when a unit-type song is picked", async () => {
    mockFetch({
      "/api/events/1/performers": { performers: EVENT_PERFORMERS },
      "/api/artists/200/current-members": {
        stageIdentityIds: ["si-1", "si-2", "si-3"], // matches unit credit
      },
    });
    render(
      <AddItemBottomSheet
        eventId="1"
        locale="ko"
        open
        presetPosition={5}
        items={[]}
        onClose={vi.fn()}
        onSubmitSuccess={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getAllByRole("checkbox").length).toBe(4),
    );
    fireEvent.click(screen.getByTestId("pick-unit-song"));
    // si-1/si-2/si-3 checked (∩ unit members), si-4 unchecked
    // (not in unit). waitFor lets the current-members fetch +
    // intersection dispatch land.
    await waitFor(() => {
      const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
      expect(boxes.length).toBe(4);
      const checkedCount = boxes.filter((b) => b.checked).length;
      expect(checkedCount).toBe(3);
    });
  });

  it("submit is disabled when itemType=song and no song is picked", async () => {
    mockFetch({
      "/api/events/1/performers": { performers: EVENT_PERFORMERS },
    });
    render(
      <AddItemBottomSheet
        eventId="1"
        locale="ko"
        open
        presetPosition={5}
        items={[]}
        onClose={vi.fn()}
        onSubmitSuccess={vi.fn()}
      />,
    );
    await flushPromises();
    const submit = screen.getByRole("button", { name: "submit" });
    expect(submit).toBeDisabled();
  });

  it("submit POSTs the correct payload and calls onSubmitSuccess with item id", async () => {
    const onSubmitSuccess = vi.fn();
    const fetchSpy = mockFetch({
      "/api/events/1/performers": { performers: EVENT_PERFORMERS },
      "/api/events/1/setlist-items": { ok: true, item: { id: 901 } },
    });
    render(
      <AddItemBottomSheet
        eventId="1"
        locale="ko"
        open
        presetPosition={5}
        items={[]}
        onClose={vi.fn()}
        onSubmitSuccess={onSubmitSuccess}
      />,
    );
    await waitFor(() =>
      expect(screen.getAllByRole("checkbox").length).toBe(4),
    );
    fireEvent.click(screen.getByTestId("pick-fullgroup-song"));
    // Wait for the song-pick effect's SET_PERFORMERS dispatch to land
    // (full-group default = all 4 non-guest performers checked).
    await waitFor(() => {
      const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
      expect(boxes.filter((b) => b.checked).length).toBe(4);
    });
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    await waitFor(() => expect(onSubmitSuccess).toHaveBeenCalledWith(901));

    const postCall = fetchSpy.mock.calls.find((call) => {
      const url = call[0] as string;
      const init = call[1] as RequestInit | undefined;
      return url.includes("/setlist-items") && init?.method === "POST";
    });
    expect(postCall).toBeDefined();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body).toEqual({
      itemType: "song",
      songId: 1,
      performerIds: expect.any(Array),
      isEncore: false,
      // Conflict-handling: position is now client-supplied. Test
      // passes presetPosition={5}, so body.position should mirror.
      position: 5,
    });
    expect(body.performerIds.length).toBe(4); // all four checked
  });

  it("encore toggle on → submit body has isEncore: true", async () => {
    const onSubmitSuccess = vi.fn();
    const fetchSpy = mockFetch({
      "/api/events/1/performers": { performers: EVENT_PERFORMERS },
      "/api/events/1/setlist-items": { ok: true, item: { id: 902 } },
    });
    render(
      <AddItemBottomSheet
        eventId="1"
        locale="ko"
        open
        presetPosition={5}
        items={[]}
        onClose={vi.fn()}
        onSubmitSuccess={onSubmitSuccess}
      />,
    );
    await waitFor(() =>
      expect(screen.getAllByRole("checkbox").length).toBe(4),
    );
    fireEvent.click(screen.getByTestId("pick-fullgroup-song"));
    await waitFor(() => {
      const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
      expect(boxes.filter((b) => b.checked).length).toBe(4);
    });
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    await waitFor(() => expect(onSubmitSuccess).toHaveBeenCalledWith(902));
    const postCall = fetchSpy.mock.calls.find((call) => {
      const url = call[0] as string;
      const init = call[1] as RequestInit | undefined;
      return url.includes("/setlist-items") && init?.method === "POST";
    });
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.isEncore).toBe(true);
  });

  it("shows an error message when the API returns 403 feature_flag_disabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/performers")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ performers: EVENT_PERFORMERS }),
          } as unknown as Response);
        }
        if (url.includes("/setlist-items")) {
          return Promise.resolve({
            ok: false,
            status: 403,
            json: async () => ({
              ok: false,
              error: "feature_flag_disabled",
            }),
          } as unknown as Response);
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({}),
        } as unknown as Response);
      }),
    );
    render(
      <AddItemBottomSheet
        eventId="1"
        locale="ko"
        open
        presetPosition={5}
        items={[]}
        onClose={vi.fn()}
        onSubmitSuccess={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getAllByRole("checkbox").length).toBe(4),
    );
    fireEvent.click(screen.getByTestId("pick-fullgroup-song"));
    await waitFor(() => {
      const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
      expect(boxes.filter((b) => b.checked).length).toBe(4);
    });
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "errorFeatureDisabled",
      ),
    );
  });
});
