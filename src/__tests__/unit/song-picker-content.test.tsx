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
};

const CERISE = {
  artistId: 2,
  slug: "cerise",
  label: "Cerise Bouquet",
  color: "#e91e8c",
  isSubUnit: true,
};

const DOLLCHESTRA = {
  artistId: 3,
  slug: "dollchestra",
  label: "DOLLCHESTRA",
  color: "#6c3fc5",
  isSubUnit: true,
};

function song(
  songId: number,
  originalTitle: string,
  unit: AvailableSong["unit"],
  translations: AvailableSong["translations"] = [],
  variantLabel: string | null = null,
): AvailableSong {
  return {
    songId,
    originalTitle,
    originalLanguage: "ja",
    variantLabel,
    baseVersionId: null,
    translations,
    unit,
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
  { key: "sub", label: "Units / Solo", color: "#0277BD", kind: "sub", artistId: null },
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

  it("filters by unit kind=sub → only sub-unit songs (group excluded)", () => {
    render(
      <SongPickerContent
        songs={SONGS}
        selectedIds={[]}
        unitFilters={FILTERS}
        onToggle={() => {}}
        locale="ko"
      />,
    );
    fireEvent.click(screen.getByText("Units / Solo"));
    expect(screen.queryByText("Dream Believers")).toBeNull();
    expect(screen.getByText("Aoku Haruka")).toBeTruthy();
    expect(screen.getByText("Dollscape")).toBeTruthy();
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
