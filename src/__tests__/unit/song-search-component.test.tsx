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

const TEXTS = {
  placeholder: "PLACEHOLDER",
  loading: "LOADING",
  noResults: "NO_RESULTS",
};

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
    render(<SongSearch onSelect={vi.fn()} locale="ko" texts={TEXTS} />);

    // Advance well past the debounce window — nothing should fire.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("debounces input: no fetch before 300ms, fires after", async () => {
    const fetchSpy = mockFetchOnceWith([]);
    render(<SongSearch onSelect={vi.fn()} locale="ko" texts={TEXTS} />);

    fireEvent.change(screen.getByRole("combobox"), {
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
    render(<SongSearch onSelect={vi.fn()} locale="ko" texts={TEXTS} />);

    const input = screen.getByRole("combobox");
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
        texts={TEXTS}
        includeVariants
        excludeSongIds={[10, 20]}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), {
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
    render(<SongSearch onSelect={vi.fn()} locale="ko" texts={TEXTS} />);

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "asdfgh1234" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(305);
    });

    expect(screen.getByText("NO_RESULTS")).toBeInTheDocument();
  });

  it("clears results and loading on non-ok server response (500)", async () => {
    // Drives the fetchResults catch path: !res.ok → throw → caught
    // (non-AbortError) → setResults([]) + setLoading(false). UI must
    // exit the loading state and fall through to noResults.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => [],
      } as unknown as Response),
    );
    render(<SongSearch onSelect={vi.fn()} locale="ko" texts={TEXTS} />);

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "dream" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(305);
    });

    expect(screen.getByText("NO_RESULTS")).toBeInTheDocument();
    expect(screen.queryByText("LOADING")).not.toBeInTheDocument();
  });

  it("calls onSelect with the full result and clears the query on row click", async () => {
    const song = makeSong(42, "Dream Believers");
    mockFetchOnceWith([song]);
    const onSelect = vi.fn();
    render(
      <SongSearch onSelect={onSelect} locale="ko" texts={TEXTS} />,
    );

    const input = screen.getByRole("combobox") as HTMLInputElement;
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

    render(<SongSearch onSelect={vi.fn()} locale="ko" texts={TEXTS} />);
    const input = screen.getByRole("combobox");

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
      <SongSearch
        onSelect={vi.fn()}
        locale="ko"
        texts={TEXTS}
        excludeSongIds={[7]}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "should" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(305);
    });

    expect(screen.getByText("Should Be Visible")).toBeInTheDocument();
    expect(screen.queryByText("Should Be Hidden")).not.toBeInTheDocument();
  });
});

describe("SongSearch — keyboard navigation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function renderWithResults(songs: SongSearchResult[], onSelect = vi.fn()) {
    mockFetchOnceWith(songs);
    render(<SongSearch onSelect={onSelect} locale="ko" texts={TEXTS} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "x" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(305);
    });
    return { input, onSelect };
  }

  it("option buttons carry tabIndex=-1 so Tab moves out of the combobox composite", async () => {
    // ARIA combobox + aria-activedescendant pattern: focus stays on
    // the input; the active option is highlighted but never receives
    // focus. Default <button> is tab-focusable, which would let Tab
    // walk through every result row instead of escaping the combobox.
    await renderWithResults([
      makeSong(1, "Alpha"),
      makeSong(2, "Beta"),
    ]);

    const alphaRow = screen.getByText("Alpha").closest("button")!;
    const betaRow = screen.getByText("Beta").closest("button")!;
    expect(alphaRow.getAttribute("tabindex")).toBe("-1");
    expect(betaRow.getAttribute("tabindex")).toBe("-1");
  });

  it("ArrowDown highlights the first option and sets aria-activedescendant", async () => {
    const { input } = await renderWithResults([
      makeSong(1, "Alpha"),
      makeSong(2, "Beta"),
    ]);

    expect(input.getAttribute("aria-activedescendant")).toBeNull();

    fireEvent.keyDown(input, { key: "ArrowDown" });

    const alphaRow = screen.getByText("Alpha").closest("button")!;
    expect(input.getAttribute("aria-activedescendant")).toBe(alphaRow.id);
    expect(alphaRow.getAttribute("aria-selected")).toBe("true");
    // Sibling row stays not-selected
    const betaRow = screen.getByText("Beta").closest("button")!;
    expect(betaRow.getAttribute("aria-selected")).toBe("false");
  });

  it("ArrowDown clamps at the last option (no wrap-around)", async () => {
    const { input } = await renderWithResults([
      makeSong(1, "Alpha"),
      makeSong(2, "Beta"),
    ]);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" }); // overflow attempt

    const betaRow = screen.getByText("Beta").closest("button")!;
    expect(input.getAttribute("aria-activedescendant")).toBe(betaRow.id);
  });

  it("ArrowUp clamps at the first option (does not go below 0)", async () => {
    const { input } = await renderWithResults([
      makeSong(1, "Alpha"),
      makeSong(2, "Beta"),
    ]);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" }); // attempts to go to -1
    fireEvent.keyDown(input, { key: "ArrowUp" });

    const alphaRow = screen.getByText("Alpha").closest("button")!;
    expect(input.getAttribute("aria-activedescendant")).toBe(alphaRow.id);
  });

  it("Enter on the active option calls onSelect with that song", async () => {
    const { input, onSelect } = await renderWithResults([
      makeSong(1, "Alpha"),
      makeSong(42, "Beta"),
    ]);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe(42);
  });

  it("Enter with no active option (-1) is a no-op (does not crash on undefined)", async () => {
    const { input, onSelect } = await renderWithResults([makeSong(1, "Alpha")]);

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Escape closes the dropdown", async () => {
    const { input } = await renderWithResults([makeSong(1, "Alpha")]);
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("clears aria-activedescendant when the dropdown closes via click-outside (option DOM is gone)", async () => {
    // Click-outside calls setOpen(false) but intentionally does NOT
    // touch activeIndex (preserves keyboard state if the user later
    // refocuses). aria-activedescendant must still drop because the
    // active option's DOM element no longer exists.
    const { input } = await renderWithResults([
      makeSong(1, "Alpha"),
      makeSong(2, "Beta"),
    ]);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).not.toBeNull();

    // Simulate mousedown outside the component — handleClickOutside is
    // attached to document mousedown.
    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input.getAttribute("aria-activedescendant")).toBeNull();
  });

  it("Typing a new query resets activeIndex (no stale highlight on the new result set)", async () => {
    const { input } = await renderWithResults([
      makeSong(1, "Alpha"),
      makeSong(2, "Beta"),
    ]);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).not.toBeNull();

    // New query — second fetch returns a different set
    mockFetchOnceWith([makeSong(3, "Gamma")]);
    fireEvent.change(input, { target: { value: "y" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(305);
    });

    expect(input.getAttribute("aria-activedescendant")).toBeNull();
    const gammaRow = screen.getByText("Gamma").closest("button")!;
    expect(gammaRow.getAttribute("aria-selected")).toBe("false");
  });
});

describe("SongSearch — variant + autoFocus props", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("default variant uses the admin-form input class (rounded-md, base text)", () => {
    render(<SongSearch onSelect={vi.fn()} locale="ko" texts={TEXTS} />);
    const input = screen.getByRole("combobox");
    expect(input.className).toContain("rounded-md");
    expect(input.className).toContain("text-base");
    // Compact pill styling should NOT leak.
    expect(input.className).not.toContain("rounded-full");
  });

  it("variant=\"compact\" swaps the input to the pill style (rounded-full, xs text, blue border)", () => {
    render(
      <SongSearch
        onSelect={vi.fn()}
        locale="ko"
        texts={TEXTS}
        variant="compact"
      />,
    );
    const input = screen.getByRole("combobox");
    expect(input.className).toContain("rounded-full");
    expect(input.className).toContain("text-xs");
    // Compact uses the wishlist blue border palette from the mockup
    // (#b5d4f4) rather than the gray default.
    expect(input.className).toContain("border-[#b5d4f4]");
    // And drops the default class.
    expect(input.className).not.toContain("rounded-md");
  });

  it("autoFocus={true} attaches autofocus on mount (input becomes the document active element)", async () => {
    render(
      <SongSearch
        onSelect={vi.fn()}
        locale="ko"
        texts={TEXTS}
        autoFocus
      />,
    );
    const input = screen.getByRole("combobox");
    // React applies the `autoFocus` attribute as a mount-time
    // imperative `.focus()` call. jsdom honors that, so the input is
    // the active element on first render.
    expect(document.activeElement).toBe(input);
  });

  it("autoFocus defaults to false — input is not focused on mount", async () => {
    render(<SongSearch onSelect={vi.fn()} locale="ko" texts={TEXTS} />);
    const input = screen.getByRole("combobox");
    expect(document.activeElement).not.toBe(input);
  });

  it("variant + autoFocus are independent — compact without autoFocus doesn't grab focus", () => {
    render(
      <SongSearch
        onSelect={vi.fn()}
        locale="ko"
        texts={TEXTS}
        variant="compact"
      />,
    );
    const input = screen.getByRole("combobox");
    expect(input.className).toContain("rounded-full");
    expect(document.activeElement).not.toBe(input);
  });
});
