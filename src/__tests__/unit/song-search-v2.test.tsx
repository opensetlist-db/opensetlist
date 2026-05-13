// Tests for SongSearch v2 (variant 2-stage picker + future-slot scaffolding).
// v1 behavior tests live in song-search-component.test.tsx; this file
// only exercises the v2-specific props: variantPicker + allowCreate.
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
import {
  SongSearch,
  type SongSearchResult,
  type SongVariant,
  type SongSearchTexts,
} from "@/components/SongSearch";

// Full text bundle: v1 keys + every v2 key. The component tolerates
// missing v2 keys (renders fallback strings) but the assertions below
// match on the exact strings passed in, so we wire them all up.
const TEXTS: SongSearchTexts = {
  placeholder: "PLACEHOLDER",
  loading: "LOADING",
  noResults: "NO_RESULTS",
  variantPickerTitle: "VARIANT_TITLE",
  variantPickerBack: "← BACK",
  variantPickerOriginalLabel: "원곡",
  // Placeholders match the i18n message format — the component
  // substitutes `{query}` and (for variant) `{josa}` at render time.
  createSongRow: "+ \"{query}\" 새 곡으로 추가",
  createVariantRow: "+ \"{query}\"{josa} 새 variant로 추가",
  createDisabledTooltip: "Phase 2에서 가능",
};

function makeVariant(id: number, label: string): SongVariant {
  return {
    id,
    variantLabel: label,
    translations: [],
  };
}

function makeSong(
  id: number,
  title: string,
  variants: SongVariant[] = [],
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
          originalName: "Hasunosora",
          originalShortName: null,
          originalLanguage: "ja",
          translations: [],
        },
      },
    ],
    // Only attach the variants array when the test wants stage 2 to be
    // reachable. Stage-2 entry is gated on `variants && variants.length > 0`
    // so leaving this undefined (empty default arg) mirrors the
    // production v1 payload shape.
    variants: variants.length > 0 ? variants : undefined,
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

// Render + drive the input through the debounce so the result list is
// visible. Mirrors the helper in song-search-component.test.tsx.
async function renderWithQuery(
  props: Parameters<typeof SongSearch>[0],
  query = "dream",
) {
  render(<SongSearch {...props} />);
  const input = screen.getByRole("combobox") as HTMLInputElement;
  fireEvent.change(input, { target: { value: query } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(305);
  });
  return input;
}

describe("SongSearch v2 — backward compatibility (variantPicker=false)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("variantPicker=false (default) → clicking a song fires onSelect(song) with single arg (v1 arity)", async () => {
    // v1 callers' tests assert `toHaveBeenCalledWith(song)` — that's a
    // strict-arity match, so the component must invoke with exactly
    // one arg when v2 is not opted into. Verifying the runtime arity
    // here protects every v1 caller's test from silently breaking.
    const song = makeSong(42, "Dream Believers");
    mockFetchOnceWith([song]);
    const onSelect = vi.fn();
    await renderWithQuery({ onSelect, locale: "ko", texts: TEXTS });

    fireEvent.click(screen.getByText("Dream Believers"));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]).toHaveLength(1);
    expect(onSelect.mock.calls[0][0]).toBe(song);
  });

  it("variantPicker=false → fetch URL does NOT include expandVariants", async () => {
    const fetchSpy = mockFetchOnceWith([]);
    render(<SongSearch onSelect={vi.fn()} locale="ko" texts={TEXTS} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "x" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(305);
    });
    const url = (fetchSpy.mock.calls[0][0] as string).toString();
    expect(url).not.toContain("expandVariants");
  });
});

describe("SongSearch v2 — variant picker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("variantPicker=true → fetch URL adds expandVariants=true", async () => {
    const fetchSpy = mockFetchOnceWith([]);
    render(
      <SongSearch
        onSelect={vi.fn()}
        locale="ko"
        texts={TEXTS}
        variantPicker
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "x" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(305);
    });
    const url = (fetchSpy.mock.calls[0][0] as string).toString();
    expect(url).toContain("expandVariants=true");
  });

  it("variantPicker=true + song has variants → stage 2 renders (back-link + base title + variant rows)", async () => {
    const song = makeSong(42, "Dream Believers", [
      makeVariant(101, "105th Ver."),
      makeVariant(102, "SAKURA Ver."),
    ]);
    mockFetchOnceWith([song]);
    await renderWithQuery({
      onSelect: vi.fn(),
      locale: "ko",
      texts: TEXTS,
      variantPicker: true,
    });

    fireEvent.click(screen.getByText("Dream Believers"));

    // Stage 2 markers
    expect(screen.getByText("← BACK")).toBeInTheDocument();
    expect(screen.getByText("VARIANT_TITLE")).toBeInTheDocument();
    expect(screen.getByText("원곡")).toBeInTheDocument();
    expect(screen.getByText("105th Ver.")).toBeInTheDocument();
    expect(screen.getByText("SAKURA Ver.")).toBeInTheDocument();
  });

  it("variantPicker=true + song has NO variants → onSelect(song, undefined) fires immediately (no stage 2)", async () => {
    const song = makeSong(99, "ハナムスビ"); // no variants attached
    mockFetchOnceWith([song]);
    const onSelect = vi.fn();
    await renderWithQuery({
      onSelect,
      locale: "ko",
      texts: TEXTS,
      variantPicker: true,
    });

    fireEvent.click(screen.getByText("ハナムスビ"));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(song, undefined);
    // And no stage-2 UI ever appeared
    expect(screen.queryByText("← BACK")).not.toBeInTheDocument();
  });

  it("stage 2 → picking 원곡 fires onSelect(song, undefined) (per plan §1 owner decision)", async () => {
    const song = makeSong(42, "Dream Believers", [
      makeVariant(101, "105th Ver."),
    ]);
    mockFetchOnceWith([song]);
    const onSelect = vi.fn();
    await renderWithQuery({
      onSelect,
      locale: "ko",
      texts: TEXTS,
      variantPicker: true,
    });

    fireEvent.click(screen.getByText("Dream Believers"));
    fireEvent.click(screen.getByText("원곡"));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(song, undefined);
  });

  it("stage 2 → picking a child variant fires onSelect(song, variant) with the correct variant id", async () => {
    const variant105 = makeVariant(101, "105th Ver.");
    const variantSakura = makeVariant(102, "SAKURA Ver.");
    const song = makeSong(42, "Dream Believers", [variant105, variantSakura]);
    mockFetchOnceWith([song]);
    const onSelect = vi.fn();
    await renderWithQuery({
      onSelect,
      locale: "ko",
      texts: TEXTS,
      variantPicker: true,
    });

    fireEvent.click(screen.getByText("Dream Believers"));
    fireEvent.click(screen.getByText("SAKURA Ver."));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(song, variantSakura);
  });

  it("stage 2 back-link → returns to stage 1 with the query intact (results re-render, no re-fetch)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        makeSong(42, "Dream Believers", [makeVariant(101, "105th Ver.")]),
      ],
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchSpy);
    const input = await renderWithQuery({
      onSelect: vi.fn(),
      locale: "ko",
      texts: TEXTS,
      variantPicker: true,
    });

    fireEvent.click(screen.getByText("Dream Believers"));
    // Sanity: now at stage 2
    expect(screen.getByText("← BACK")).toBeInTheDocument();

    fireEvent.click(screen.getByText("← BACK"));

    // Back at stage 1: result list re-rendered with the same query
    expect(input.value).toBe("dream");
    expect(screen.getByText("Dream Believers")).toBeInTheDocument();
    // Stage 2 markers gone
    expect(screen.queryByText("← BACK")).not.toBeInTheDocument();
    // No additional fetch was issued — the back link reuses cached state
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("stage 2 Escape goes back to stage 1 (matches the back-link), not 'close dropdown'", async () => {
    const song = makeSong(42, "Dream Believers", [makeVariant(101, "105th Ver.")]);
    mockFetchOnceWith([song]);
    const input = await renderWithQuery({
      onSelect: vi.fn(),
      locale: "ko",
      texts: TEXTS,
      variantPicker: true,
    });
    fireEvent.click(screen.getByText("Dream Believers"));
    expect(screen.getByText("← BACK")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });

    // Stage 2 cleared, stage 1 re-rendered
    expect(screen.queryByText("← BACK")).not.toBeInTheDocument();
    expect(screen.getByText("Dream Believers")).toBeInTheDocument();
    // Dropdown not closed (listbox still mounted)
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });
});

describe("SongSearch v2 — future-slot (allowCreate)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("allowCreate=true at stage 1 → future-slot row renders as aria-disabled", async () => {
    mockFetchOnceWith([makeSong(1, "Alpha")]);
    await renderWithQuery(
      {
        onSelect: vi.fn(),
        locale: "ko",
        texts: TEXTS,
        allowCreate: true,
      },
      "dream",
    );

    const futureSlot = screen.getByText(
      '+ "dream" 새 곡으로 추가',
    );
    expect(futureSlot).toBeInTheDocument();
    expect(futureSlot.getAttribute("aria-disabled")).toBe("true");
    expect(futureSlot.getAttribute("title")).toBe("Phase 2에서 가능");
  });

  it("allowCreate=true with empty results → future-slot still renders below the noResults state", async () => {
    mockFetchOnceWith([]);
    await renderWithQuery(
      {
        onSelect: vi.fn(),
        locale: "ko",
        texts: TEXTS,
        allowCreate: true,
      },
      "asdfgh",
    );

    expect(screen.getByText("NO_RESULTS")).toBeInTheDocument();
    expect(
      screen.getByText('+ "asdfgh" 새 곡으로 추가'),
    ).toBeInTheDocument();
  });

  it("allowCreate=false (default) → no future-slot rendered at stage 1", async () => {
    mockFetchOnceWith([makeSong(1, "Alpha")]);
    await renderWithQuery({
      onSelect: vi.fn(),
      locale: "ko",
      texts: TEXTS,
    });

    expect(
      screen.queryByText(/새 곡으로 추가/),
    ).not.toBeInTheDocument();
  });

  it("allowCreate=true + variantPicker=true at stage 2 → variant-create future-slot renders with josa-correct particle", async () => {
    // Korean object particle 을/를 follows the user's query; jongseong
    // present (받침 있음) → 을, absent → 를. "dream" ends in "m" which
    // is treated as Latin → es-hangul's josa() returns "를" for Latin
    // tails (no jongseong). Verifying the substitution is happening.
    const song = makeSong(42, "Dream Believers", [
      makeVariant(101, "105th Ver."),
    ]);
    mockFetchOnceWith([song]);
    await renderWithQuery(
      {
        onSelect: vi.fn(),
        locale: "ko",
        texts: TEXTS,
        variantPicker: true,
        allowCreate: true,
      },
      "dream",
    );

    fireEvent.click(screen.getByText("Dream Believers"));

    // Variant-create future-slot with substituted query + josa
    const variantSlot = screen.getByText(
      /\+ "dream"(을|를) 새 variant로 추가/,
    );
    expect(variantSlot).toBeInTheDocument();
    expect(variantSlot.getAttribute("aria-disabled")).toBe("true");
  });
});
