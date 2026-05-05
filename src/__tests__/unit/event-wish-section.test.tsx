import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Identity-mapped translations — keys are stable test fixtures.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    if (vars) {
      // Mirror next-intl's ICU `{count, plural, ...}` handling enough
      // for our component which uses `t("count", { count })`. Just
      // echo the count + key so assertions can match.
      return `${key}:${JSON.stringify(vars)}`;
    }
    return key;
  },
}));

// Force the hydration branch so localStorage reads run.
vi.mock("@/hooks/useMounted", () => ({
  useMounted: () => true,
}));

import { EventWishSection } from "@/components/EventWishSection";
import { writeWishes, type WishEntry } from "@/lib/wishStorage";
import type { FanTop3Entry } from "@/lib/types/setlist";
import type { SongMatchInputItem } from "@/lib/songMatch";

const FUTURE = new Date(Date.now() + 60 * 60 * 1000); // 1h from now
const PAST = new Date(Date.now() - 60 * 60 * 1000);   // 1h ago

function fanEntry(id: number, count: number, originalTitle = `song-${id}`): FanTop3Entry {
  return {
    count,
    song: {
      id,
      originalTitle,
      originalLanguage: "ja",
      variantLabel: null,
      baseVersionId: null,
      translations: [],
    },
  };
}

function setlistItem(songId: number, baseVersionId: number | null = null): SongMatchInputItem {
  return { songs: [{ song: { id: songId, baseVersionId } }] };
}

function localWish(songId: number, dbId: string, originalTitle = `song-${songId}`): WishEntry {
  return {
    songId,
    dbId,
    song: {
      originalTitle,
      originalLanguage: "ja",
      variantLabel: null,
      baseVersionId: null,
      translations: [],
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EventWishSection — render gates", () => {
  it("locked event with no fan top-3 and no my-wishes renders nothing", () => {
    const { container } = render(
      <EventWishSection
        eventId="1"
        locale="ko"
        startTime={PAST}
        setlistItems={[]}
        top3Wishes={[]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("pre-show event renders the section even with no wishes (input affordance is the point)", () => {
    render(
      <EventWishSection
        eventId="1"
        locale="ko"
        startTime={FUTURE}
        setlistItems={[]}
        top3Wishes={[]}
      />,
    );
    expect(screen.getByText(/title/)).toBeTruthy();
    expect(screen.getByText("add")).toBeTruthy();
  });

  it("pre-show shows the title key 'title' (not 'lockedTitle')", () => {
    render(
      <EventWishSection
        eventId="1"
        locale="ko"
        startTime={FUTURE}
        setlistItems={[]}
        top3Wishes={[fanEntry(10, 5)]}
      />,
    );
    expect(screen.getByText(/^🌸 title$/)).toBeTruthy();
    expect(screen.queryByText(/^🌸 lockedTitle$/)).toBeNull();
  });

  it("locked + has data renders the title key 'lockedTitle' and hides the cap hint", () => {
    render(
      <EventWishSection
        eventId="1"
        locale="ko"
        startTime={PAST}
        setlistItems={[]}
        top3Wishes={[fanEntry(10, 5)]}
      />,
    );
    expect(screen.getByText(/^🌸 lockedTitle$/)).toBeTruthy();
    expect(screen.queryByText("cap")).toBeNull();
  });
});

describe("EventWishSection — my-list cap of 3", () => {
  it("hides + 추가 once 3 wishes are stored locally", () => {
    writeWishes("1", [
      localWish(10, "a"),
      localWish(11, "b"),
      localWish(12, "c"),
    ]);
    render(
      <EventWishSection
        eventId="1"
        locale="ko"
        startTime={FUTURE}
        setlistItems={[]}
        top3Wishes={[]}
      />,
    );
    expect(screen.queryByText("add")).toBeNull();
  });

  it("shows + 추가 with 0/1/2 wishes", () => {
    writeWishes("1", [localWish(10, "a"), localWish(11, "b")]);
    render(
      <EventWishSection
        eventId="1"
        locale="ko"
        startTime={FUTURE}
        setlistItems={[]}
        top3Wishes={[]}
      />,
    );
    expect(screen.getByText("add")).toBeTruthy();
  });
});

describe("EventWishSection — locked-state controls hidden", () => {
  beforeEach(() => {
    writeWishes("1", [localWish(10, "a", "残陽")]);
  });

  it("hides ✕ remove buttons when locked", () => {
    render(
      <EventWishSection
        eventId="1"
        locale="ko"
        startTime={PAST}
        setlistItems={[setlistItem(10)]}
        top3Wishes={[fanEntry(10, 5)]}
      />,
    );
    // No buttons with the removeAria label.
    expect(screen.queryByLabelText("removeAria")).toBeNull();
  });

  it("hides + 추가 even with <3 wishes when locked", () => {
    render(
      <EventWishSection
        eventId="1"
        locale="ko"
        startTime={PAST}
        setlistItems={[]}
        top3Wishes={[fanEntry(10, 5)]}
      />,
    );
    expect(screen.queryByText("add")).toBeNull();
  });
});

describe("EventWishSection — match-highlight in fan TOP-3", () => {
  it("locked + matched song wraps the title in the green-bg badge", () => {
    render(
      <EventWishSection
        eventId="1"
        locale="ko"
        startTime={PAST}
        // wished song 10 also appears in the actual setlist
        setlistItems={[setlistItem(10)]}
        top3Wishes={[fanEntry(10, 5, "残陽")]}
      />,
    );
    const titleSpan = screen.getByText("残陽");
    // The SongMatchBadge wraps the matched title in a span with the
    // wishlist match-bg color. Walk up to find that wrapper.
    const wrapper = titleSpan.parentElement!;
    expect(wrapper.tagName.toLowerCase()).toBe("span");
    // Inline style on the badge wrapper sets background to the
    // wishlistMatchBg token (#bbf7d0).
    expect(wrapper.style.background.toLowerCase()).toContain("rgb(187, 247, 208)");
  });

  it("pre-show suppresses the highlight even when a match would otherwise occur", () => {
    render(
      <EventWishSection
        eventId="1"
        locale="ko"
        startTime={FUTURE}
        setlistItems={[setlistItem(10)]}
        top3Wishes={[fanEntry(10, 5, "残陽")]}
      />,
    );
    const titleSpan = screen.getByText("残陽");
    // No green-bg wrapper in pre-show — the title's parent is the
    // outer flex span, not the SongMatchBadge wrapper.
    const wrapper = titleSpan.parentElement!;
    expect(wrapper.style.background ?? "").not.toContain("rgb(187, 247, 208)");
  });
});

describe("EventWishSection — search reveal + cancel toggle", () => {
  it("clicking + 추가 reveals the SongSearch input; cancel hides it again", async () => {
    render(
      <EventWishSection
        eventId="1"
        locale="ko"
        startTime={FUTURE}
        setlistItems={[]}
        top3Wishes={[]}
      />,
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByText("add"));
    // Combobox role appears (provided by SongSearch).
    expect(screen.getByRole("combobox")).toBeTruthy();
    fireEvent.click(screen.getByText("cancel"));
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

// Optimistic add + persist round-trip is covered by:
//   - wishStorage.test.ts       (read/write + shape validation)
//   - wishes-route.test.ts      (POST returns { id, songId })
//   - song-search-component.test.tsx (debounce + select fires onSelect)
// An end-to-end "click search → select → POST → localStorage" test
// is integration territory (better suited for Playwright). The wiring
// here is small enough that the three unit suites above give
// confidence without a fragile timer-juggling test.
