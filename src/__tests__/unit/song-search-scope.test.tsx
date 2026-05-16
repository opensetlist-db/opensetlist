// Tests for SongSearch v2 scope-filter prop (multi-IP support).
// v1 + variant-picker behavior tests live in
// song-search-component.test.tsx + song-search-v2.test.tsx; this file
// only exercises the URL-param contract for the four scope kinds, so a
// regression in URL construction surfaces in isolation instead of
// hiding behind a stage-2 assertion.
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  SongSearch,
  type SongSearchScope,
} from "@/components/SongSearch";

const TEXTS = {
  placeholder: "PLACEHOLDER",
  loading: "LOADING",
  noResults: "NO_RESULTS",
};

function mockFetchOnceWith(songs: unknown[] = []) {
  const fetchSpy = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => songs,
  } as unknown as Response);
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

// Extract the URL the component handed to `fetch`. The component
// currently passes a plain string, but `fetch` accepts string | URL |
// Request, so the helper handles all three rather than casting blindly
// — if a refactor ever swaps the call site to `new URL(...)` or a
// `Request`, the tests don't silently start asserting against
// `"[object Object]"` (the result of `Object.toString()` on a non-string).
function urlFromFetchCall(
  fetchSpy: ReturnType<typeof vi.fn>,
  callIndex = 0,
): string {
  const arg = fetchSpy.mock.calls[callIndex]?.[0];
  if (typeof arg === "string") return arg;
  if (arg instanceof URL) return arg.toString();
  if (arg instanceof Request) return arg.url;
  throw new Error(
    `Unexpected fetch arg type at call ${callIndex}: ${Object.prototype.toString.call(arg)}`,
  );
}

// Type the props loosely — only `scope` is the variable here, and we
// want to be able to pass it (or omit it) without retyping the whole
// prop bag for each test.
type ScopeTestProps = {
  scope?: SongSearchScope;
};

async function renderAndTypeOnce(extra: ScopeTestProps = {}) {
  const fetchSpy = mockFetchOnceWith([]);
  render(
    <SongSearch
      onSelect={vi.fn()}
      locale="ko"
      texts={TEXTS}
      {...extra}
    />,
  );
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "dream" },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(305);
  });
  return fetchSpy;
}

describe("SongSearch v2 — scope URL params", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("omitted scope → URL has no scope/scopeId/scopeArtistIds params (byte-identical to v1)", async () => {
    const fetchSpy = await renderAndTypeOnce();
    const url = urlFromFetchCall(fetchSpy);
    expect(url).not.toContain("scope=");
    expect(url).not.toContain("scopeId=");
    expect(url).not.toContain("scopeArtistIds=");
  });

  it("scope={ kind: 'all' } explicit → same URL shape as omitted (no scope params)", async () => {
    // Defensive: a caller threading the default explicitly should not
    // start sending scope=all on the wire — that would be wasteful and
    // would diverge from the v1 baseline used in song-search-component.test.tsx
    // for backward-compat assertions.
    const fetchSpy = await renderAndTypeOnce({ scope: { kind: "all" } });
    const url = urlFromFetchCall(fetchSpy);
    expect(url).not.toContain("scope=");
  });

  it("scope={ kind: 'event', eventId: 42 } → URL has scope=event&scopeId=42", async () => {
    const fetchSpy = await renderAndTypeOnce({
      scope: { kind: "event", eventId: 42 },
    });
    const url = urlFromFetchCall(fetchSpy);
    expect(url).toContain("scope=event");
    expect(url).toContain("scopeId=42");
  });

  it("scope={ kind: 'series', seriesId: 7 } → URL has scope=series&scopeId=7", async () => {
    const fetchSpy = await renderAndTypeOnce({
      scope: { kind: "series", seriesId: 7 },
    });
    const url = urlFromFetchCall(fetchSpy);
    expect(url).toContain("scope=series");
    expect(url).toContain("scopeId=7");
  });

  it("scope={ kind: 'artist', artistIds: [3, 5] } → URL has scope=artist&scopeArtistIds=3%2C5", async () => {
    const fetchSpy = await renderAndTypeOnce({
      scope: { kind: "artist", artistIds: [3, 5] },
    });
    const url = urlFromFetchCall(fetchSpy);
    expect(url).toContain("scope=artist");
    // URLSearchParams MUST percent-encode the comma to %2C — if the
    // implementation ever switches to a raw `,` (e.g. by building the
    // string with template literals instead of URLSearchParams) the
    // server's `parseCsvBigIntIds` would still parse it, but the
    // wire shape would silently diverge from our documented contract
    // and from `excludeIds`. The strict check pins the contract.
    expect(url).toContain("scopeArtistIds=3%2C5");
  });

  it("scope coexists with other v2 params (excludeIds, expandVariants)", async () => {
    // The four URL-building blocks in fetchResults are independent —
    // adding scope shouldn't disturb any of the existing param plumbing.
    // Belt-and-suspenders for future refactors that might reorder them.
    //
    // `includeVariants` is intentionally NOT set here: as of the CR
    // #353 fixup, the component suppresses `includeVariants` whenever
    // `variantPicker` is on (the two are conceptually exclusive — see
    // the comment block in `fetchResults`). The dedicated suppression
    // test below pins that behavior.
    const fetchSpy = mockFetchOnceWith([]);
    render(
      <SongSearch
        onSelect={vi.fn()}
        locale="ko"
        texts={TEXTS}
        variantPicker
        excludeSongIds={[10, 20]}
        scope={{ kind: "event", eventId: 99 }}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "x" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(305);
    });
    const url = urlFromFetchCall(fetchSpy);
    expect(url).toContain("expandVariants=true");
    expect(url).toContain("excludeIds=10%2C20");
    expect(url).toContain("scope=event");
    expect(url).toContain("scopeId=99");
  });

  it("variantPicker suppresses includeVariants — the two flags are conceptually exclusive", async () => {
    // CR #353 fixup: a caller that opts into the v2 two-stage picker
    // should not also send `includeVariants=true`, because the server
    // forces base-only when `expandVariants=true` and the redundant
    // param is misleading on the wire. The component drops
    // `includeVariants` itself rather than expecting callers to know.
    //
    // This test pins the suppression. If a future refactor decouples
    // the params on the route side, the same combination would
    // resurrect a real bug (child variants reaching stage 1), so the
    // assertion is the trip-wire.
    const fetchSpy = mockFetchOnceWith([]);
    render(
      <SongSearch
        onSelect={vi.fn()}
        locale="ko"
        texts={TEXTS}
        includeVariants
        variantPicker
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "x" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(305);
    });
    const url = urlFromFetchCall(fetchSpy);
    expect(url).not.toContain("includeVariants=true");
    expect(url).toContain("expandVariants=true");
  });

  it("includeVariants alone (no variantPicker) still rides the URL — admin flat-variant path", async () => {
    // Admin SetlistBuilder relies on `includeVariants=true` to surface
    // flat variant rows in its search results. The suppression must
    // ONLY trigger when `variantPicker` is also on; otherwise this
    // legitimate admin use case would silently lose its variant rows.
    const fetchSpy = mockFetchOnceWith([]);
    render(
      <SongSearch
        onSelect={vi.fn()}
        locale="ko"
        texts={TEXTS}
        includeVariants
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "x" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(305);
    });
    const url = urlFromFetchCall(fetchSpy);
    expect(url).toContain("includeVariants=true");
    expect(url).not.toContain("expandVariants=true");
  });
});

describe("SongSearch v2 — scope change triggers refetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("changing scope on the consumer side → next typed query uses the new scope's URL", async () => {
    // Mid-session scope change is rare in practice (the consumer is
    // bound to a single event page), but the prop is in fetchResults'
    // useCallback dep list to keep the closure honest. This test
    // verifies the URL re-derives after a prop swap.
    const fetchSpy = mockFetchOnceWith([]);
    const { rerender } = render(
      <SongSearch
        onSelect={vi.fn()}
        locale="ko"
        texts={TEXTS}
        scope={{ kind: "event", eventId: 1 }}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "a" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(305);
    });
    expect(urlFromFetchCall(fetchSpy)).toContain("scopeId=1");

    // Parent swaps scope; user types again.
    rerender(
      <SongSearch
        onSelect={vi.fn()}
        locale="ko"
        texts={TEXTS}
        scope={{ kind: "event", eventId: 2 }}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "ab" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(305);
    });
    const lastCallUrl = urlFromFetchCall(
      fetchSpy,
      fetchSpy.mock.calls.length - 1,
    );
    expect(lastCallUrl).toContain("scopeId=2");
  });
});
