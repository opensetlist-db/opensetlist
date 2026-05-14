import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks/useMounted", () => ({
  useMounted: () => true,
}));

// `LAUNCH_FLAGS` is `as const` so the per-test flag flip needs a
// writable cast. The route's runtime read of `LAUNCH_FLAGS.addItemEnabled`
// resolves through the same object reference the test mutates.
import { LAUNCH_FLAGS } from "@/lib/launchFlags";
// `as const` narrows every flag to a literal type (`false`). Cast to
// a writable boolean shape so the test can flip flags freely. Runtime
// is fine — the object isn't Object.frozen.
type WritableFlags = { -readonly [K in keyof typeof LAUNCH_FLAGS]: boolean };
const mutableFlags = LAUNCH_FLAGS as unknown as WritableFlags;

// Stub SongSearch + vaul (same shape as the bottom-sheet test) so
// ActualSetlist's tree renders without pulling in the picker DOM or
// portal infra. The button-visibility tests only need to assert the
// button's presence/absence, not the sheet's internals.
vi.mock("@/components/SongSearch", () => ({
  SongSearch: () => null,
}));
vi.mock("vaul", () => {
  const passthrough = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Drawer: {
      Root: passthrough,
      Portal: passthrough,
      Overlay: passthrough,
      Content: passthrough,
      Title: passthrough,
    },
  };
});

import { ActualSetlist } from "@/components/ActualSetlist";
import type { LiveSetlistItem } from "@/lib/types/setlist";

function makeItem(overrides: Partial<LiveSetlistItem> = {}): LiveSetlistItem {
  return {
    id: 1,
    position: 1,
    isEncore: false,
    stageType: "full_group",
    unitName: null,
    status: "confirmed",
    performanceType: "live_performance",
    type: "song",
    createdAt: "2026-05-13T00:00:00.000Z",
    songs: [],
    performers: [],
    artists: [],
    ...overrides,
  };
}

describe("ActualSetlist — `+ 곡 추가` button visibility", () => {
  beforeEach(() => {
    mutableFlags.addItemEnabled = false;
  });
  afterEach(() => {
    mutableFlags.addItemEnabled = false;
  });

  it("does NOT render the add button when LAUNCH_FLAGS.addItemEnabled is false", () => {
    mutableFlags.addItemEnabled = false;
    render(
      <ActualSetlist
        items={[makeItem()]}
        reactionCounts={{}}
        locale="ko"
        eventId="1"
        status="ongoing"
      />,
    );
    expect(screen.queryByText("addButtonLabel")).toBeNull();
  });

  it("does NOT render the add button when event status is not 'ongoing' (pre-show / post-show)", () => {
    mutableFlags.addItemEnabled = true;
    render(
      <ActualSetlist
        items={[makeItem()]}
        reactionCounts={{}}
        locale="ko"
        eventId="1"
        status="upcoming"
      />,
    );
    expect(screen.queryByText("addButtonLabel")).toBeNull();
  });

  it("renders the add button when flag AND ongoing status are both satisfied", () => {
    mutableFlags.addItemEnabled = true;
    render(
      <ActualSetlist
        items={[makeItem()]}
        reactionCounts={{}}
        locale="ko"
        eventId="1"
        status="ongoing"
      />,
    );
    expect(screen.getByText("addButtonLabel")).toBeInTheDocument();
  });
});
