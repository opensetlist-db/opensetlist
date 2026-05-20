import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    if (vars) return `${key}:${JSON.stringify(vars)}`;
    return key;
  },
}));

// Stub `vaul` so portal-mounted children land in the test DOM and
// the closed/open distinction collapses to "render or not". Same
// passthrough convention as `add-item-bottom-sheet.test.tsx`.
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
      }) => (open ? <div data-testid="drawer-root">{children}</div> : null),
      Portal: passthrough,
      Overlay: passthrough,
      Content: passthrough,
      Title: passthrough,
    },
  };
});

import { SongPickerSheet } from "@/components/predict/SongPickerSheet";
import type { AvailableSong, UnitFilter } from "@/lib/types/predict";

const SONGS: AvailableSong[] = [
  {
    songId: 10,
    originalTitle: "Dream Believers",
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
  },
];

const FILTERS: UnitFilter[] = [
  { key: "all", label: "All", color: null, kind: "all", artistId: null },
];

describe("<SongPickerSheet>", () => {
  it("renders SongPickerContent when open=true", () => {
    render(
      <SongPickerSheet
        
        locale="ko"
        
        songs={SONGS}
        selectedIds={[]}
        unitFilters={FILTERS}
        open={true}
        onOpenChange={() => {}}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText("picker.sheetTitle")).toBeTruthy();
    expect(screen.getByText("Dream Believers")).toBeTruthy();
  });

  it("renders nothing when open=false (drawer collapsed)", () => {
    render(
      <SongPickerSheet
        
        locale="ko"
        
        songs={SONGS}
        selectedIds={[]}
        unitFilters={FILTERS}
        open={false}
        onOpenChange={() => {}}
        onToggle={() => {}}
      />,
    );
    expect(screen.queryByText("picker.sheetTitle")).toBeNull();
    expect(screen.queryByText("Dream Believers")).toBeNull();
  });

  it("× close button calls onOpenChange(false)", () => {
    const onOpenChange = vi.fn();
    render(
      <SongPickerSheet
        
        locale="ko"
        
        songs={SONGS}
        selectedIds={[]}
        unitFilters={FILTERS}
        open={true}
        onOpenChange={onOpenChange}
        onToggle={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("picker.closeAria"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("confirm bar (rendered because SongPickerContent received onClose) calls onOpenChange(false)", () => {
    const onOpenChange = vi.fn();
    render(
      <SongPickerSheet
        
        locale="ko"
        
        songs={SONGS}
        selectedIds={[10]}
        unitFilters={FILTERS}
        open={true}
        onOpenChange={onOpenChange}
        onToggle={() => {}}
      />,
    );
    fireEvent.click(screen.getByText(/picker\.confirmButton/));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("toggling a row forwards through to the onToggle prop", () => {
    const onToggle = vi.fn();
    render(
      <SongPickerSheet
        
        locale="ko"
        
        songs={SONGS}
        selectedIds={[]}
        unitFilters={FILTERS}
        open={true}
        onOpenChange={() => {}}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByText("Dream Believers"));
    expect(onToggle).toHaveBeenCalledWith(10);
  });
});
