import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks/useMounted", () => ({
  useMounted: () => true,
}));

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

// SongSearch stub — exposes one button per scenario to simulate the
// picker resolving to a base song with no variant (pick-song) OR a
// base song plus a variant (pick-variant). Both buttons render
// unconditionally; tests pick whichever path they're exercising.
vi.mock("@/components/SongSearch", () => ({
  SongSearch: ({
    onSelect,
  }: {
    onSelect: (
      song: {
        id: number;
        originalTitle: string;
        baseVersionId: number | null;
        artists: never[];
        originalLanguage: string;
        variantLabel: null;
        translations: never[];
      },
      variant:
        | { id: number; variantLabel: string | null; translations: never[] }
        | undefined,
    ) => void;
  }) => {
    // Narrow the casts to just the empty-array fields so the rest
    // of the shape stays type-checked against the local onSelect
    // mock signature above. `never[]` is the parameter type in
    // that signature; bare `[]` literals widen to `any[]` outside
    // a contextual position, which is what was forcing the
    // earlier `as never` sledgehammer.
    const baseSong = {
      id: 100,
      originalTitle: "Dream Believers",
      baseVersionId: null,
      originalLanguage: "ja",
      variantLabel: null,
      translations: [] as never[],
      artists: [] as never[],
    };
    return (
      <>
        <button
          data-testid="pick-song"
          onClick={() => onSelect(baseSong, undefined)}
        >
          pick song
        </button>
        <button
          data-testid="pick-variant"
          onClick={() =>
            onSelect(baseSong, {
              id: 200,
              variantLabel: "105th Ver.",
              translations: [],
            })
          }
        >
          pick variant
        </button>
      </>
    );
  },
}));

const EVENT_PERFORMERS = [
  {
    stageIdentityId: "si-1",
    originalName: "세라스",
    originalShortName: null,
    originalLanguage: "ko",
    translations: [],
    isGuest: false,
    artistLinks: [],
  },
  {
    stageIdentityId: "si-2",
    originalName: "히메",
    originalShortName: null,
    originalLanguage: "ko",
    translations: [],
    isGuest: false,
    artistLinks: [],
  },
];

function mockFetch(routes: Record<string, unknown>) {
  const spy = vi.fn().mockImplementation((url: string) => {
    for (const [prefix, body] of Object.entries(routes)) {
      if (url.startsWith(prefix)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => body,
        } as unknown as Response);
      }
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      json: async () => ({ error: "no_mock" }),
    } as unknown as Response);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

import { ContestReportSheet } from "@/components/ContestReportSheet";

describe("ContestReportSheet", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders nothing when open=false", () => {
    mockFetch({});
    render(
      <ContestReportSheet
        eventId="1"
        setlistItemId={42}
        locale="ko"
        open={false}
        onClose={vi.fn()}
        onSubmitSuccess={vi.fn()}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("submit disabled until a song is picked for wrong_song type", async () => {
    mockFetch({});
    render(
      <ContestReportSheet
        eventId="1"
        setlistItemId={42}
        locale="ko"
        open
        onClose={vi.fn()}
        onSubmitSuccess={vi.fn()}
      />,
    );
    // Default type = wrong_song; no song picked → submit disabled
    const submit = screen.getByRole("button", { name: "submit" });
    expect(submit).toBeDisabled();
  });

  it("clicking pick-song enables submit for wrong_song", async () => {
    mockFetch({});
    render(
      <ContestReportSheet
        eventId="1"
        setlistItemId={42}
        locale="ko"
        open
        onClose={vi.fn()}
        onSubmitSuccess={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("pick-song"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "submit" })).not.toBeDisabled();
    });
  });

  it("switches to missing_performer and shows checklist after fetch", async () => {
    mockFetch({
      "/api/events/1/performers": { performers: EVENT_PERFORMERS },
    });
    render(
      <ContestReportSheet
        eventId="1"
        setlistItemId={42}
        locale="ko"
        open
        onClose={vi.fn()}
        onSubmitSuccess={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("radio", { name: "typeLabel.missing_performer" }),
    );
    await waitFor(() => {
      expect(screen.getAllByRole("checkbox").length).toBe(2);
    });
    // Submit still disabled until at least one performer checked
    expect(screen.getByRole("button", { name: "submit" })).toBeDisabled();
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "submit" })).not.toBeDisabled();
    });
  });

  it("other type requires non-empty comment to submit", async () => {
    mockFetch({});
    render(
      <ContestReportSheet
        eventId="1"
        setlistItemId={42}
        locale="ko"
        open
        onClose={vi.fn()}
        onSubmitSuccess={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "typeLabel.other" }));
    expect(screen.getByRole("button", { name: "submit" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "some report text" },
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "submit" })).not.toBeDisabled();
    });
  });

  it("wrong_variant + base song only → payload carries proposedSongId only", async () => {
    const fetchSpy = mockFetch({
      "/api/setlist-items/42/contests": {
        ok: true,
        report: { id: "report-uuid-2" },
      },
    });
    render(
      <ContestReportSheet
        eventId="1"
        setlistItemId={42}
        locale="ko"
        open
        onClose={vi.fn()}
        onSubmitSuccess={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("radio", { name: "typeLabel.wrong_variant" }),
    );
    // Base song picked, no variant — represents the user picking
    // 원곡 in SongSearch v2's stage 2.
    fireEvent.click(screen.getByTestId("pick-song"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "submit" })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    await waitFor(() => {
      const postCall = fetchSpy.mock.calls.find((call) => {
        const init = call[1] as RequestInit | undefined;
        return init?.method === "POST";
      });
      expect(postCall).toBeDefined();
      const body = JSON.parse((postCall![1] as RequestInit).body as string);
      expect(body.type).toBe("wrong_variant");
      expect(body.payload).toEqual({ proposedSongId: 100 });
      expect(body.payload.proposedVariantId).toBeUndefined();
    });
  });

  it("wrong_variant + variant picked → payload carries proposedSongId + proposedVariantId", async () => {
    const fetchSpy = mockFetch({
      "/api/setlist-items/42/contests": {
        ok: true,
        report: { id: "report-uuid-3" },
      },
    });
    render(
      <ContestReportSheet
        eventId="1"
        setlistItemId={42}
        locale="ko"
        open
        onClose={vi.fn()}
        onSubmitSuccess={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("radio", { name: "typeLabel.wrong_variant" }),
    );
    fireEvent.click(screen.getByTestId("pick-variant"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "submit" })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    await waitFor(() => {
      const postCall = fetchSpy.mock.calls.find((call) => {
        const init = call[1] as RequestInit | undefined;
        return init?.method === "POST";
      });
      expect(postCall).toBeDefined();
      const body = JSON.parse((postCall![1] as RequestInit).body as string);
      expect(body.type).toBe("wrong_variant");
      expect(body.payload).toEqual({
        proposedSongId: 100,
        proposedVariantId: 200,
      });
    });
  });

  it("submit POSTs with the right payload + onSubmitSuccess fires", async () => {
    const onSubmitSuccess = vi.fn();
    const fetchSpy = mockFetch({
      "/api/setlist-items/42/contests": {
        ok: true,
        report: { id: "report-uuid-1" },
      },
    });
    render(
      <ContestReportSheet
        eventId="1"
        setlistItemId={42}
        locale="ko"
        open
        onClose={vi.fn()}
        onSubmitSuccess={onSubmitSuccess}
      />,
    );
    fireEvent.click(screen.getByTestId("pick-song"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "submit" })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    await waitFor(() =>
      expect(onSubmitSuccess).toHaveBeenCalledWith("report-uuid-1"),
    );
    const postCall = fetchSpy.mock.calls.find((call) => {
      const init = call[1] as RequestInit | undefined;
      return init?.method === "POST";
    });
    expect(postCall).toBeDefined();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.type).toBe("wrong_song");
    expect(body.payload.proposedSongId).toBe(100);
  });
});
