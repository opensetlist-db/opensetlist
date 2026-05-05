import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
} from "@testing-library/react";
import { SongSearch, type SongSearchResult } from "@/components/SongSearch";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => `SongSearch.${key}`,
}));

function makeSong(
  id: number,
  title: string,
  artistName = "Hasunosora",
): SongSearchResult {
  return {
    id,
    originalTitle: title,
    originalLanguage: "ja",
    variantLabel: null,
    baseVersionId: null,
    translations: [],
    artists: [
      {
        artist: {
          id: 1,
          originalName: artistName,
          originalShortName: null,
          originalLanguage: "ja",
          translations: [],
        },
      },
    ],
  };
}

function mockFetchOnceWith(songs: SongSearchResult[]) {
  const fetchSpy = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => songs,
  } as unknown as Response);
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

describe("SongSearch — debounce + fetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not fire fetch for empty input", async () => {
    const fetchSpy = mockFetchOnceWith([]);
    render(<SongSearch onSelect={vi.fn()} locale="ko" />);

    // Advance well past the debounce window — nothing should fire.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("debounces input: no fetch before 300ms, fires after", async () => {
    const fetchSpy = mockFetchOnceWith([]);
    render(<SongSearch onSelect={vi.fn()} locale="ko" />);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "dream" },
    });

    // Just under the debounce window: still nothing.
    await act(async () => {
      vi.advanceTimersByTime(299);
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    // Cross the threshold.
    await act(async () => {
      vi.advanceTimersByTime(2);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = (fetchSpy.mock.calls[0][0] as string).toString();
    expect(url).toContain("/api/songs/search?");
    expect(url).toContain("q=dream");
  });

  it("collapses bursty keystrokes into a single fetch", async () => {
    const fetchSpy = mockFetchOnceWith([]);
    render(<SongSearch onSelect={vi.fn()} locale="ko" />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "d" } });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.change(input, { target: { value: "dr" } });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.change(input, { target: { value: "dream" } });
    await act(async () => {
      vi.advanceTimersByTime(305);
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = (fetchSpy.mock.calls[0][0] as string).toString();
    expect(url).toContain("q=dream");
  });

  it("propagates includeVariants and excludeIds to the fetch URL", async () => {
    const fetchSpy = mockFetchOnceWith([]);
    render(
      <SongSearch
        onSelect={vi.fn()}
        locale="ko"
        includeVariants
        excludeSongIds={[10, 20]}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "x" },
    });
    await act(async () => {
      vi.advanceTimersByTime(305);
    });

    const url = (fetchSpy.mock.calls[0][0] as string).toString();
    expect(url).toContain("includeVariants=true");
    // URLSearchParams encodes commas as %2C
    expect(url).toMatch(/excludeIds=10(,|%2C)20/);
  });
});

describe("SongSearch — rendering", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Note: advanceTimersByTimeAsync is required (not the sync variant)
  // because the component's debounced callback awaits a Promise from
  // fetch, and waitFor / findBy* themselves poll on setTimeout — both
  // of which would deadlock under purely synchronous fake timers.
  it("renders the noResults state when the API returns []", async () => {
    mockFetchOnceWith([]);
    render(<SongSearch onSelect={vi.fn()} locale="ko" />);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "asdfgh1234" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(305);
    });

    expect(screen.getByText("SongSearch.noResults")).toBeInTheDocument();
  });

  it("calls onSelect with the full result and clears the query on row click", async () => {
    const song = makeSong(42, "Dream Believers");
    mockFetchOnceWith([song]);
    const onSelect = vi.fn();
    render(<SongSearch onSelect={onSelect} locale="ko" />);

    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "dream" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(305);
    });

    const row = screen.getByText("Dream Believers");
    fireEvent.click(row);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(song);
    expect(input.value).toBe("");
  });

  it("ignores stale responses when a newer query supersedes an in-flight fetch (race fix)", async () => {
    // Race scenario: two fetches in flight at once (debounce windows
    // ≥300ms apart, both already past the timer). If the older fetch
    // resolves AFTER the newer one, a naive setResults would overwrite
    // the correct (newer) results with stale data. Fix uses
    // AbortController to cancel the older fetch when a newer one
    // starts.
    let resolveFirst: (v: SongSearchResult[]) => void = () => {};
    const firstPromise = new Promise<SongSearchResult[]>((r) => {
      resolveFirst = r;
    });

    const fetchSpy = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes("q=a&") || url.endsWith("q=a")) {
          // First fetch ("a"): hangs until we manually resolve it,
          // and rejects with AbortError if aborted.
          return new Promise((resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
            firstPromise.then((data) => {
              resolve({ ok: true, json: async () => data } as Response);
            });
          });
        }
        // Second fetch ("ab"): resolves immediately.
        return Promise.resolve({
          ok: true,
          json: async () => [makeSong(2, "Ab Song")],
        } as unknown as Response);
      });
    vi.stubGlobal("fetch", fetchSpy);

    render(<SongSearch onSelect={vi.fn()} locale="ko" />);
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "a" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(305);
    });

    fireEvent.change(input, { target: { value: "ab" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(305);
    });

    // Resolve the stale ("a") fetch AFTER the new one already wrote
    // its results. Without the AbortController fix, this would clobber
    // the newer "ab" results.
    await act(async () => {
      resolveFirst([makeSong(1, "A Song")]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Ab Song")).toBeInTheDocument();
    expect(screen.queryByText("A Song")).not.toBeInTheDocument();
  });

  it("hides results whose id appears in excludeSongIds (defense-in-depth)", async () => {
    mockFetchOnceWith([
      makeSong(7, "Should Be Hidden"),
      makeSong(8, "Should Be Visible"),
    ]);
    render(
      <SongSearch onSelect={vi.fn()} locale="ko" excludeSongIds={[7]} />,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "should" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(305);
    });

    expect(screen.getByText("Should Be Visible")).toBeInTheDocument();
    expect(screen.queryByText("Should Be Hidden")).not.toBeInTheDocument();
  });
});
