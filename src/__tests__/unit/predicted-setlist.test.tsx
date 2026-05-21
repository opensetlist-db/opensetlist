import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    if (vars) return `${key}:${JSON.stringify(vars)}`;
    return key;
  },
}));

vi.mock("@/hooks/useMounted", () => ({
  useMounted: () => true,
}));

// Force the mobile shape across these tests — the "+ 곡 추가" trigger
// only appears when `!isDesktopPicker`. Tests that specifically need
// the desktop 2-col layout cover that path in
// `predicted-setlist-desktop-picker.test.tsx`.
vi.mock("@/hooks/useIsDesktop", () => ({
  useIsDesktop: () => false,
}));

// Stub `vaul` so the picker sheet's `Drawer.*` primitives render
// as plain divs in jsdom — we test the "sheet opens" semantics by
// asserting on the visible body content, not on portal mounting.
vi.mock("vaul", () => {
  const passthrough = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Drawer: {
      Root: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
        open ? <div data-testid="drawer-root">{children}</div> : null,
      Portal: passthrough,
      Overlay: passthrough,
      Content: passthrough,
      Title: passthrough,
    },
  };
});

import { PredictedSetlist } from "@/components/PredictedSetlist";
import { DIMMED_ROW_OPACITY } from "@/components/PredictSongRow";
import { writePredictions, type PredictionEntry } from "@/lib/predictionsStorage";
import type { WishSongDisplay } from "@/lib/wishStorage";
import type { LiveSetlistItem } from "@/lib/types/setlist";
import type { AvailableSong, UnitFilter } from "@/lib/types/predict";

// Minimal `availableSongs` + `unitFilters` so the picker trigger
// actually renders pre-show. Tests that need the trigger absent
// (locked / post-show) override with empty arrays inline.
const SAMPLE_AVAILABLE: AvailableSong[] = [
  {
    songId: 10,
    originalTitle: "残陽",
    originalLanguage: "ja",
    variantLabel: null,
    baseVersionId: null,
    translations: [],
    unit: {
      artistId: 1,
      slug: "hasunosora",
      label: "Hasunosora",
      color: "#0277BD",
      isSubUnit: false,
      isMainUnit: false,
    },
    isMultiArtist: false,
    creditedArtistIds: [1],
  },
];
const SAMPLE_FILTERS: UnitFilter[] = [
  { key: "all", label: "All", color: null, kind: "all", artistId: null },
];

const FUTURE = new Date(Date.now() + 60 * 60 * 1000); // +1h
const PAST = new Date(Date.now() - 60 * 60 * 1000); // -1h

const SAMPLE_SONG: WishSongDisplay = {
  originalTitle: "残陽",
  originalLanguage: "ja",
  variantLabel: null,
  baseVersionId: null,
  translations: [],
};

function entry(songId: number, originalTitle = `song-${songId}`): PredictionEntry {
  return { songId, song: { ...SAMPLE_SONG, originalTitle } };
}

let nextItemId = 1;
function actual(songId: number): LiveSetlistItem {
  return {
    id: nextItemId++,
    position: songId,
    isEncore: false,
    stageType: "full_group",
    unitName: null,
    status: "confirmed",
    performanceType: "live_performance",
    type: "song",
    createdAt: "2026-05-23T12:00:00.000Z",
    confirmCount: 0,
    songs: [
      {
        song: {
          id: songId,
          slug: `s-${songId}`,
          originalTitle: `song-${songId}`,
          originalLanguage: "ja",
          variantLabel: null,
          baseVersionId: null,
          translations: [],
          artists: [],
        },
      },
    ],
    performers: [],
    artists: [],
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("PredictedSetlist — render gates by status + lock", () => {
  it("pre-show: renders the `+ 곡 추가` link and the pre-show hint", () => {
    render(
      <PredictedSetlist
        eventId="1"
        locale="ko"
        startTime={FUTURE}
        status="upcoming"
        actualSongs={[]}
        seriesName="Test Series"
        eventTitle="Test Event"
        dateLine="2026-05-23"
        availableSongs={SAMPLE_AVAILABLE}
        unitFilters={SAMPLE_FILTERS}
      />,
    );
    expect(screen.getByText("add")).toBeTruthy();
    expect(screen.getByText(/preShowHint:/)).toBeTruthy();
  });

  it("locked (status ongoing, startTime past): no `+ 곡 추가`, no ✕, no drag handle", () => {
    writePredictions("1", [entry(10)]);
    render(
      <PredictedSetlist
        eventId="1"
        locale="ko"
        startTime={PAST}
        status="ongoing"
        actualSongs={[actual(10)]}
        seriesName="Test Series"
        eventTitle="Test Event"
        dateLine="2026-05-23" availableSongs={[]} unitFilters={[]}
      />,
    );
    expect(screen.queryByText("add")).toBeNull();
    // The remove ✕ button uses removeAria; should be absent.
    expect(screen.queryByLabelText("removeAria")).toBeNull();
    // Drag handle uses dragHandleAria; should be absent when locked.
    expect(screen.queryByLabelText("dragHandleAria")).toBeNull();
  });

  it("post-show: shows the after-hint + the final score", () => {
    writePredictions("1", [entry(10), entry(20)]);
    render(
      <PredictedSetlist
        eventId="1"
        locale="ko"
        startTime={PAST}
        status="completed"
        actualSongs={[actual(10), actual(20)]}
        seriesName="Test Series"
        eventTitle="Test Event"
        dateLine="2026-05-23" availableSongs={[]} unitFilters={[]}
      />,
    );
    expect(screen.getByText("afterHint")).toBeTruthy();
    expect(screen.getByText(/finalScore:/)).toBeTruthy();
  });
});

describe("PredictedSetlist — add / remove", () => {
  it("pre-show + populated catalog: clicking add opens the picker sheet", () => {
    render(
      <PredictedSetlist
        eventId="1"
        locale="ko"
        startTime={FUTURE}
        status="upcoming"
        actualSongs={[]}
        seriesName="Test Series"
        eventTitle="Test Event"
        dateLine="2026-05-23"
        availableSongs={SAMPLE_AVAILABLE}
        unitFilters={SAMPLE_FILTERS}
      />,
    );
    // Sheet's title is rendered through the mocked `t("picker.sheetTitle")`.
    expect(screen.queryByText("picker.sheetTitle")).toBeNull();
    fireEvent.click(screen.getByText("add"));
    expect(screen.getByText("picker.sheetTitle")).toBeTruthy();
  });

  it("pre-show + empty catalog: picker trigger is hidden (only copy-from-past renders)", () => {
    render(
      <PredictedSetlist
        eventId="1"
        locale="ko"
        startTime={FUTURE}
        status="upcoming"
        actualSongs={[]}
        seriesName="Test Series"
        eventTitle="Test Event"
        dateLine="2026-05-23"
        availableSongs={[]}
        unitFilters={[]}
      />,
    );
    expect(screen.queryByText("add")).toBeNull();
    expect(screen.getByText("copyFromPast")).toBeTruthy();
  });

  it("pre-show: ✕ removes a row + persists to localStorage", () => {
    writePredictions("1", [entry(10, "A"), entry(20, "B")]);
    render(
      <PredictedSetlist
        eventId="1"
        locale="ko"
        startTime={FUTURE}
        status="upcoming"
        actualSongs={[]}
        seriesName="Test Series"
        eventTitle="Test Event"
        dateLine="2026-05-23" availableSongs={[]} unitFilters={[]}
      />,
    );
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.getByText("B")).toBeTruthy();
    // Two ✕ buttons via removeAria.
    const removeButtons = screen.getAllByLabelText("removeAria");
    expect(removeButtons).toHaveLength(2);
    fireEvent.click(removeButtons[0]);
    expect(screen.queryByText("A")).toBeNull();
    expect(screen.getByText("B")).toBeTruthy();
    // localStorage updated.
    const stored = JSON.parse(window.localStorage.getItem("predict-1")!);
    expect(stored.songs).toHaveLength(1);
    expect(stored.songs[0].songId).toBe(20);
  });
});

describe("PredictedSetlist — match-highlight states", () => {
  it("during-show in-rank match: row title gets matched-bg styling", () => {
    writePredictions("1", [entry(10, "残陽"), entry(20, "ハナ")]);
    render(
      <PredictedSetlist
        eventId="1"
        locale="ko"
        startTime={PAST}
        status="ongoing"
        actualSongs={[actual(10)]} // 1 actual; predicted song 10 at rank 1 → in-rank match
        seriesName="Test Series"
        eventTitle="Test Event"
        dateLine="2026-05-23" availableSongs={[]} unitFilters={[]}
      />,
    );
    // The matched row's title span gets the wishlistMatchBg color.
    const titleSpan = screen.getByText("残陽");
    // colors.wishlistMatchBg = #bbf7d0 → rgb(187, 247, 208)
    expect(titleSpan.getAttribute("style")?.toLowerCase()).toContain(
      "rgb(187, 247, 208)",
    );
  });

  it("during-show below-divider: rows past actual count get opacity 0.4", () => {
    writePredictions("1", [
      entry(10, "A"),
      entry(20, "B"),
      entry(30, "C"),
    ]);
    render(
      <PredictedSetlist
        eventId="1"
        locale="ko"
        startTime={PAST}
        status="ongoing"
        actualSongs={[actual(99)]} // 1 actual, no match
        seriesName="Test Series"
        eventTitle="Test Event"
        dateLine="2026-05-23" availableSongs={[]} unitFilters={[]}
      />,
    );
    // Rows at rank 2 + 3 are below the divider (rank > total=1) → opacity 0.4.
    const rowB = screen.getByText("B").closest("div[style*='opacity']")!;
    expect(rowB.getAttribute("style")).toContain(
      `opacity: ${DIMMED_ROW_OPACITY}`,
    );
  });

  it("during-show: divider renders between in-rank and below-divider rows", () => {
    writePredictions("1", [entry(10, "A"), entry(20, "B"), entry(30, "C")]);
    render(
      <PredictedSetlist
        eventId="1"
        locale="ko"
        startTime={PAST}
        status="ongoing"
        actualSongs={[actual(99)]} // 1 actual → divider after rank 1
        seriesName="Test Series"
        eventTitle="Test Event"
        dateLine="2026-05-23" availableSongs={[]} unitFilters={[]}
      />,
    );
    expect(screen.getByText(/dividerLabel:/)).toBeTruthy();
  });
});
