import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    if (vars) return `${key}:${JSON.stringify(vars)}`;
    return key;
  },
}));

import { SongPickerContent } from "@/components/predict/SongPickerContent";
import type { AvailableSong, UnitFilter } from "@/lib/types/predict";

const HASUNOSORA = {
  artistId: 1,
  slug: "hasunosora",
  label: "Hasunosora",
  color: "#0277BD",
  isSubUnit: false,
  isMainUnit: false,
};

const CERISE = {
  artistId: 2,
  slug: "cerise",
  label: "Cerise Bouquet",
  color: "#e91e8c",
  isSubUnit: true,
  isMainUnit: true,
};

const DOLLCHESTRA = {
  artistId: 3,
  slug: "dollchestra",
  label: "DOLLCHESTRA",
  color: "#6c3fc5",
  isSubUnit: true,
  isMainUnit: true,
};

function song(
  songId: number,
  originalTitle: string,
  unit: AvailableSong["unit"],
  translations: AvailableSong["translations"] = [],
  variantLabel: string | null = null,
  isMultiArtist: boolean = false,
  creditedArtistIds?: number[],
): AvailableSong {
  return {
    songId,
    originalTitle,
    originalLanguage: "ja",
    variantLabel,
    baseVersionId: null,
    translations,
    unit,
    isMultiArtist,
    // Default to the canonical unit's artistId for single-credit
    // songs. Tests that need multi-credit routing pass an explicit
    // array (e.g. [2, 3, 4] for a Cerise + DOLL + MCP collab).
    creditedArtistIds: creditedArtistIds ?? [unit.artistId],
  };
}

const SONGS: AvailableSong[] = [
  song(10, "Dream Believers", HASUNOSORA),
  song(11, "Hanamusubi", HASUNOSORA),
  song(20, "Aoku Haruka", CERISE),
  song(21, "Cerise Tune", CERISE),
  song(30, "Dollscape", DOLLCHESTRA),
];

const FILTERS: UnitFilter[] = [
  { key: "all", label: "All", color: null, kind: "all", artistId: null },
  {
    key: "group",
    label: "Hasunosora",
    color: "#0277BD",
    kind: "group",
    artistId: 1,
  },
  {
    key: "cerise",
    label: "Cerise Bouquet",
    color: "#e91e8c",
    kind: "individual",
    artistId: 2,
  },
  {
    key: "dollchestra",
    label: "DOLLCHESTRA",
    color: "#6c3fc5",
    kind: "individual",
    artistId: 3,
  },
  // Catch-all `others` chip — for testing the bucket-routing.
  // SONGS doesn't include any artistId not covered by group/individual,
  // so this chip will render nothing in the picker (matches the
  // server-side rule: emit `others` only when ≥1 song falls in).
  // Tests that need the "covered → empty" path use FILTERS_WITH_ORPHAN
  // below.
  { key: "others", label: "Others", color: "#0277BD", kind: "others", artistId: null },
];

describe("<SongPickerContent>", () => {
  it("renders all songs under `all` filter (default selection)", () => {
    render(
      <SongPickerContent
        songs={SONGS}
        selectedIds={[]}
        unitFilters={FILTERS}
        onToggle={() => {}}
        locale="ko"
      />,
    );
    expect(screen.getByText("Dream Believers")).toBeTruthy();
    expect(screen.getByText("Aoku Haruka")).toBeTruthy();
    expect(screen.getByText("Dollscape")).toBeTruthy();
  });

  it("filters by search query on originalTitle", () => {
    render(
      <SongPickerContent
        songs={SONGS}
        selectedIds={[]}
        unitFilters={FILTERS}
        onToggle={() => {}}
        locale="ko"
      />,
    );
    const input = screen.getByPlaceholderText("picker.searchPlaceholder");
    fireEvent.change(input, { target: { value: "Aoku" } });
    expect(screen.queryByText("Dream Believers")).toBeNull();
    expect(screen.getByText("Aoku Haruka")).toBeTruthy();
  });

  it("filters by search query across translations (cross-locale)", () => {
    const localized = song(40, "ブルウモーメント", HASUNOSORA, [
      { locale: "en", title: "Blue Moment", variantLabel: null },
    ]);
    render(
      <SongPickerContent
        songs={[localized]}
        selectedIds={[]}
        unitFilters={FILTERS}
        onToggle={() => {}}
        locale="ko"
      />,
    );
    const input = screen.getByPlaceholderText("picker.searchPlaceholder");
    fireEvent.change(input, { target: { value: "Blue Moment" } });
    expect(screen.getByText("ブルウモーメント")).toBeTruthy();
  });

  it("filters by unit kind=group → only group-direct songs", () => {
    render(
      <SongPickerContent
        songs={SONGS}
        selectedIds={[]}
        unitFilters={FILTERS}
        onToggle={() => {}}
        locale="ko"
      />,
    );
    // The filter chip + every Hasunosora row's inline badge share
    // the same text — pick the chip (first match in document order).
    fireEvent.click(screen.getAllByText("Hasunosora")[0]);
    expect(screen.getByText("Dream Believers")).toBeTruthy();
    expect(screen.getByText("Hanamusubi")).toBeTruthy();
    expect(screen.queryByText("Aoku Haruka")).toBeNull();
    expect(screen.queryByText("Dollscape")).toBeNull();
  });

  it("filters by unit kind=others → only songs whose unit lacks an individual chip", () => {
    // SONGS' Cerise + Dollchestra are covered by individual chips,
    // and Hasunosora by the group chip — every song's unit is
    // covered. Add a synthetic orphan song whose unit (`solo-misc`,
    // artistId 99) has no individual / group chip → should be the
    // only result under `others`.
    const orphan: AvailableSong = {
      songId: 999,
      originalTitle: "Orphan Solo",
      originalLanguage: "ja",
      variantLabel: null,
      baseVersionId: null,
      translations: [],
      unit: {
        artistId: 99,
        slug: "solo-misc",
        label: "Misc Solo",
        color: "#888",
        isSubUnit: true,
        isMainUnit: false,
      },
      isMultiArtist: false,
      creditedArtistIds: [99],
    };
    render(
      <SongPickerContent
        songs={[...SONGS, orphan]}
        selectedIds={[]}
        unitFilters={FILTERS}
        onToggle={() => {}}
        locale="ko"
      />,
    );
    fireEvent.click(screen.getByText("Others"));
    expect(screen.queryByText("Dream Believers")).toBeNull();
    expect(screen.queryByText("Aoku Haruka")).toBeNull();
    expect(screen.queryByText("Dollscape")).toBeNull();
    expect(screen.getByText("Orphan Solo")).toBeTruthy();
  });

  it("filters by unit kind=individual → only the matching artist", () => {
    render(
      <SongPickerContent
        songs={SONGS}
        selectedIds={[]}
        unitFilters={FILTERS}
        onToggle={() => {}}
        locale="ko"
      />,
    );
    fireEvent.click(screen.getAllByText("DOLLCHESTRA")[0]);
    expect(screen.queryByText("Dream Believers")).toBeNull();
    expect(screen.queryByText("Aoku Haruka")).toBeNull();
    expect(screen.getByText("Dollscape")).toBeTruthy();
  });

  it("clicking a row calls onToggle with the song's songId", () => {
    const onToggle = vi.fn();
    render(
      <SongPickerContent
        songs={SONGS}
        selectedIds={[]}
        unitFilters={FILTERS}
        onToggle={onToggle}
        locale="ko"
      />,
    );
    fireEvent.click(screen.getByText("Dream Believers"));
    expect(onToggle).toHaveBeenCalledWith(10);
  });

  it("renders + glyph for unselected, − glyph for selected", () => {
    const { rerender } = render(
      <SongPickerContent
        songs={SONGS}
        selectedIds={[]}
        unitFilters={FILTERS}
        onToggle={() => {}}
        locale="ko"
      />,
    );
    // 5 rows + nothing selected → all show "+"
    expect(screen.queryAllByText("+").length).toBeGreaterThanOrEqual(5);
    rerender(
      <SongPickerContent
        songs={SONGS}
        selectedIds={[10]}
        unitFilters={FILTERS}
        onToggle={() => {}}
        locale="ko"
      />,
    );
    expect(screen.queryAllByText("−").length).toBe(1);
  });

  it("renders the noResults message when filtered list is empty", () => {
    render(
      <SongPickerContent
        songs={SONGS}
        selectedIds={[]}
        unitFilters={FILTERS}
        onToggle={() => {}}
        locale="ko"
      />,
    );
    const input = screen.getByPlaceholderText("picker.searchPlaceholder");
    fireEvent.change(input, { target: { value: "xyznomatch" } });
    expect(screen.getByText("picker.noResults")).toBeTruthy();
  });

  it("renders the emptyCatalog message when songs.length === 0", () => {
    render(
      <SongPickerContent
        songs={[]}
        selectedIds={[]}
        unitFilters={FILTERS}
        onToggle={() => {}}
        locale="ko"
      />,
    );
    expect(screen.getByText("picker.emptyCatalog")).toBeTruthy();
    // Search input + filter row are also hidden in the empty
    // catalog branch.
    expect(screen.queryByPlaceholderText("picker.searchPlaceholder")).toBeNull();
  });

  it("renders the confirm button only when onClose prop is provided", () => {
    const { rerender } = render(
      <SongPickerContent
        songs={SONGS}
        selectedIds={[]}
        unitFilters={FILTERS}
        onToggle={() => {}}
        locale="ko"
      />,
    );
    // Without onClose: no confirm bar.
    expect(screen.queryByText(/picker\.confirmButton/)).toBeNull();
    rerender(
      <SongPickerContent
        songs={SONGS}
        selectedIds={[10]}
        unitFilters={FILTERS}
        onToggle={() => {}}
        locale="ko"
        onClose={() => {}}
      />,
    );
    // Confirm bar present; label includes the selected count via
    // the mocked `t` (passes vars through as JSON).
    expect(screen.getByText(/picker\.confirmButton/)).toBeTruthy();
  });

  it("clicking the confirm button calls onClose", () => {
    const onClose = vi.fn();
    render(
      <SongPickerContent
        songs={SONGS}
        selectedIds={[10]}
        unitFilters={FILTERS}
        onToggle={() => {}}
        locale="ko"
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByText(/picker\.confirmButton/));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("inline unit badges only appear under composite (all/sub) filters", () => {
    const { rerender } = render(
      <SongPickerContent
        songs={SONGS}
        selectedIds={[]}
        unitFilters={FILTERS}
        onToggle={() => {}}
        locale="ko"
      />,
    );
    // Under `all`: every row shows a unit badge inline. Cerise label
    // appears on the filter chip (1) + 2 song rows = 3 occurrences.
    expect(screen.getAllByText("Cerise Bouquet").length).toBeGreaterThanOrEqual(2);
    // Switch to the individual `Cerise Bouquet` filter (kind: "individual").
    rerender(
      <SongPickerContent
        songs={SONGS}
        selectedIds={[]}
        unitFilters={FILTERS}
        onToggle={() => {}}
        locale="ko"
      />,
    );
    fireEvent.click(
      screen.getAllByText("Cerise Bouquet")[0], // the filter chip
    );
    // Inline badges hidden → only the filter chip itself contains
    // "Cerise Bouquet" (1 occurrence).
    expect(screen.getAllByText("Cerise Bouquet").length).toBe(1);
  });

  it("result count line reports total + selected", () => {
    render(
      <SongPickerContent
        songs={SONGS}
        selectedIds={[10, 20]}
        unitFilters={FILTERS}
        onToggle={() => {}}
        locale="ko"
      />,
    );
    // mocked t() emits `picker.resultCount:{"count":5,"selected":2}`
    expect(screen.getByText(/picker\.resultCount:.*"count":5.*"selected":2/)).toBeTruthy();
  });

  it("multi-artist song routes to `others` only — never under any individual chip", () => {
    // A song whose `unit` happens to point at Cerise (artistId 2)
    // but `isMultiArtist: true` (multi-solo collab where Cerise is
    // just the display fallback). It must NOT show under the
    // Cerise individual chip; it MUST show under `others`.
    const multi = song(
      500,
      "Multi-Solo Collab",
      CERISE, // unit points here, but routing must ignore it
      [],
      null,
      true, // isMultiArtist
    );
    const orphan = song(999, "Orphan", {
      artistId: 99,
      slug: "solo-misc",
      label: "Misc Solo",
      color: "#888",
      isSubUnit: true,
      isMainUnit: false,
    });
    const { rerender } = render(
      <SongPickerContent
        songs={[...SONGS, multi, orphan]}
        selectedIds={[]}
        unitFilters={FILTERS}
        onToggle={() => {}}
        locale="ko"
      />,
    );
    // Under Cerise filter → multi-artist song should be excluded.
    fireEvent.click(screen.getAllByText("Cerise Bouquet")[0]);
    expect(screen.queryByText("Multi-Solo Collab")).toBeNull();
    expect(screen.getByText("Aoku Haruka")).toBeTruthy(); // sanity
    // Under others filter → multi-artist song must be included.
    rerender(
      <SongPickerContent
        songs={[...SONGS, multi, orphan]}
        selectedIds={[]}
        unitFilters={FILTERS}
        onToggle={() => {}}
        locale="ko"
      />,
    );
    fireEvent.click(screen.getByText("Others"));
    expect(screen.getByText("Multi-Solo Collab")).toBeTruthy();
    expect(screen.getByText("Orphan")).toBeTruthy();
  });

  it("multi-main-unit collab song appears under EVERY credited main unit's individual chip", () => {
    // A song credited to 3 main units (Cerise + DOLLCHESTRA + a
    // hypothetical third main unit at artistId 4) — operator
    // reported that pre-fix the song only showed under whichever
    // main unit won the canonical-routing race. With the fix, the
    // server emits `creditedArtistIds: [2, 3, 4]` and the picker
    // should surface the row under each of the three individual
    // chips when filtered.
    const THIRD_MAIN = {
      artistId: 4,
      slug: "mira-cra-park",
      label: "Mira-Cra Park!",
      color: "#fbc02d",
      isSubUnit: true,
      isMainUnit: true,
    };
    const filtersWith3rd = [
      ...FILTERS,
      {
        key: THIRD_MAIN.slug,
        label: THIRD_MAIN.label,
        color: THIRD_MAIN.color,
        kind: "individual" as const,
        artistId: THIRD_MAIN.artistId,
      },
    ];
    // Canonical `unit` points at Cerise (won the routing race).
    const multiMain = song(
      600,
      "Three-Unit Collab",
      CERISE,
      [],
      null,
      false, // NOT isMultiArtist (main unit credits exist)
      [CERISE.artistId, DOLLCHESTRA.artistId, THIRD_MAIN.artistId],
    );

    // Filter by Cerise (canonical) → song visible.
    const { rerender } = render(
      <SongPickerContent
        songs={[...SONGS, multiMain]}
        selectedIds={[]}
        unitFilters={filtersWith3rd}
        onToggle={() => {}}
        locale="ko"
      />,
    );
    fireEvent.click(screen.getAllByText("Cerise Bouquet")[0]);
    expect(screen.getByText("Three-Unit Collab")).toBeTruthy();

    // Filter by DOLLCHESTRA (non-canonical credited) → still visible.
    rerender(
      <SongPickerContent
        songs={[...SONGS, multiMain]}
        selectedIds={[]}
        unitFilters={filtersWith3rd}
        onToggle={() => {}}
        locale="ko"
      />,
    );
    fireEvent.click(screen.getAllByText("DOLLCHESTRA")[0]);
    expect(screen.getByText("Three-Unit Collab")).toBeTruthy();

    // Filter by Mira-Cra Park! (non-canonical credited) → still visible.
    rerender(
      <SongPickerContent
        songs={[...SONGS, multiMain]}
        selectedIds={[]}
        unitFilters={filtersWith3rd}
        onToggle={() => {}}
        locale="ko"
      />,
    );
    fireEvent.click(screen.getAllByText("Mira-Cra Park!")[0]);
    expect(screen.getByText("Three-Unit Collab")).toBeTruthy();
  });

  it("`others` filter excludes a multi-main-unit collab whose credited units are all covered by chips", () => {
    // Two main units credited (Cerise + DOLLCHESTRA), no group, no
    // solo. Both have individual chips in FILTERS → none of the
    // credited IDs is uncovered → song must NOT appear under `others`.
    // Tests the new `coveredArtistIds.some` predicate that checks
    // the full credited set, not just the canonical unit.
    const multiMain = song(
      601,
      "Cerise + DOLL Collab",
      CERISE,
      [],
      null,
      false,
      [2, 3], // Cerise + DOLLCHESTRA, both have chips
    );
    render(
      <SongPickerContent
        songs={[...SONGS, multiMain]}
        selectedIds={[]}
        unitFilters={FILTERS}
        onToggle={() => {}}
        locale="ko"
      />,
    );
    fireEvent.click(screen.getByText("Others"));
    expect(screen.queryByText("Cerise + DOLL Collab")).toBeNull();
  });

  it("under `others` filter, multi-artist songs still respect the search query (no short-circuit bypass)", () => {
    // Regression for a CR-caught bug: the `kind === "others"` branch
    // used to `return true` early on `song.isMultiArtist`, which
    // skipped the search-query filter below. Result: a multi-artist
    // song matched the `others` chip even when the typed query
    // matched nothing about it. The fix routes multi-artist songs
    // through the same search filter as every other row.
    const multi = song(
      500,
      "Multi-Solo Collab", // does NOT contain "xyznomatch"
      CERISE,
      [],
      null,
      true, // isMultiArtist
    );
    render(
      <SongPickerContent
        songs={[...SONGS, multi]}
        selectedIds={[]}
        unitFilters={FILTERS}
        onToggle={() => {}}
        locale="ko"
      />,
    );
    fireEvent.click(screen.getByText("Others"));
    // Sanity: with no query, the multi-artist row IS visible.
    expect(screen.getByText("Multi-Solo Collab")).toBeTruthy();
    // Type a query that doesn't match the title / translations /
    // unit.label of the multi-artist row.
    const input = screen.getByPlaceholderText("picker.searchPlaceholder");
    fireEvent.change(input, { target: { value: "xyznomatch" } });
    // Multi-artist row must now be filtered out by the search query.
    expect(screen.queryByText("Multi-Solo Collab")).toBeNull();
    // And the empty-results message appears.
    expect(screen.getByText("picker.noResults")).toBeTruthy();
  });

  it("filter chips expose active state via aria-pressed", () => {
    render(
      <SongPickerContent
        songs={SONGS}
        selectedIds={[]}
        unitFilters={FILTERS}
        onToggle={() => {}}
        locale="ko"
      />,
    );
    // Initial: `all` chip is active by default.
    expect(screen.getByText("All").getAttribute("aria-pressed")).toBe("true");
    // Filter labels also appear on row badges; pick the chip
    // (first DOM occurrence).
    const hasunosoraChip = screen.getAllByText("Hasunosora")[0];
    expect(hasunosoraChip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(hasunosoraChip);
    expect(hasunosoraChip.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("All").getAttribute("aria-pressed")).toBe("false");
  });

  it("song rows expose selection state via aria-pressed", () => {
    const { rerender } = render(
      <SongPickerContent
        songs={SONGS}
        selectedIds={[]}
        unitFilters={FILTERS}
        onToggle={() => {}}
        locale="ko"
      />,
    );
    const row = screen.getByText("Dream Believers").closest('[role="button"]');
    expect(row?.getAttribute("aria-pressed")).toBe("false");
    rerender(
      <SongPickerContent
        songs={SONGS}
        selectedIds={[10]}
        unitFilters={FILTERS}
        onToggle={() => {}}
        locale="ko"
      />,
    );
    const rowAfter = screen.getByText("Dream Believers").closest('[role="button"]');
    expect(rowAfter?.getAttribute("aria-pressed")).toBe("true");
  });

  it("multi-artist songs render under a dedicated section header (not under the first-credited solo)", () => {
    // A multi-artist song whose `unit` happens to point at Cerise
    // as a display fallback. Under the composite `all` filter, the
    // section grouping must place it under the generic "multi
    // soloists" section — NOT under the Cerise section header
    // alongside legitimate Cerise-only songs.
    const multi = song(
      500,
      "Multi-Solo Collab",
      CERISE, // display fallback only; routing must ignore
      [],
      null,
      true, // isMultiArtist
    );
    render(
      <SongPickerContent
        songs={[...SONGS, multi]}
        selectedIds={[]}
        unitFilters={FILTERS}
        onToggle={() => {}}
        locale="ko"
      />,
    );
    // The multi-artist song shows up …
    expect(screen.getByText("Multi-Solo Collab")).toBeTruthy();
    // … and the dedicated section header is rendered.
    expect(screen.getByText("picker.multiArtistSection")).toBeTruthy();
    // The inline unit badge ("Cerise Bouquet") is suppressed on the
    // multi-artist row. Under `all`, the label appears on:
    //   1. the Cerise filter chip,
    //   2. the Cerise section header,
    //   3-4. the two Cerise-only song badges (Aoku Haruka + Cerise Tune)
    // → exactly 4 occurrences. If the multi row leaked a badge,
    //   the count would be 5.
    expect(screen.getAllByText("Cerise Bouquet").length).toBe(4);
  });

  it("clearing the search input via × button restores all rows", () => {
    render(
      <SongPickerContent
        songs={SONGS}
        selectedIds={[]}
        unitFilters={FILTERS}
        onToggle={() => {}}
        locale="ko"
      />,
    );
    const input = screen.getByPlaceholderText(
      "picker.searchPlaceholder",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Aoku" } });
    expect(screen.queryByText("Dream Believers")).toBeNull();
    fireEvent.click(screen.getByLabelText("picker.searchClearAria"));
    expect(input.value).toBe("");
    expect(screen.getByText("Dream Believers")).toBeTruthy();
  });
});
