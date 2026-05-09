import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { colors } from "@/styles/tokens";
import { hexToRgbString } from "@/__tests__/utils/color";

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
        status="upcoming"
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
        status="upcoming"
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
        status="upcoming"
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
        status="upcoming"
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
        status="upcoming"
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
        status="upcoming"
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
        status="upcoming"
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
        status="upcoming"
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
        status="upcoming"
        setlistItems={[setlistItem(10)]}
        top3Wishes={[fanEntry(10, 5, "残陽")]}
      />,
    );
    // `<SongMatchBadge>` exposes `data-testid="song-match-badge"` so
    // tests reach the wrapper directly — any future markup tweak
    // (extra wrapping span for animation, etc.) wouldn't break this
    // assertion. The expected RGB is derived from the
    // `colors.wishlistMatchBg` token via `hexToRgbString` rather
    // than hardcoded — a future palette tweak rolls forward without
    // a silently-passing test.
    const wrapper = screen.getByTestId("song-match-badge");
    expect(wrapper.style.background.toLowerCase()).toContain(
      hexToRgbString(colors.wishlistMatchBg).toLowerCase(),
    );
  });

  it("pre-show suppresses the highlight even when a match would otherwise occur", () => {
    render(
      <EventWishSection
        eventId="1"
        locale="ko"
        startTime={FUTURE}
        status="upcoming"
        setlistItems={[setlistItem(10)]}
        top3Wishes={[fanEntry(10, 5, "残陽")]}
      />,
    );
    // `<SongMatchBadge>` returns `<>{children}</>` (no wrapper)
    // when `disabled` — the badge testid should be absent entirely.
    expect(screen.queryByTestId("song-match-badge")).toBeNull();
    // The title text itself still renders — pre-show suppresses
    // only the highlight, not the row.
    expect(screen.getByText("残陽")).toBeTruthy();
  });
});

describe("EventWishSection — search reveal + cancel toggle", () => {
  it("clicking + 추가 reveals the SongSearch input; cancel hides it again", async () => {
    render(
      <EventWishSection
        eventId="1"
        locale="ko"
        startTime={FUTURE}
        status="upcoming"
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

describe("EventWishSection — server-status lock (slow-client-clock fallback)", () => {
  it("status='ongoing' + FUTURE startTime → editor hidden (server lock overrides client wall-clock)", () => {
    // Slow-client-clock scenario: the user's device clock is set so
    // far behind that `Date.now() < startMs` (FUTURE startTime per
    // test fixture). With only the setTimeout + wall-clock layers,
    // the editor would stay open. The new third lock input —
    // server-resolved `status !== "upcoming"`, polled from
    // `/api/setlist` and threaded down via
    // `<LiveEventLayout>`'s `effectiveStatus` — flips isLocked
    // regardless of client clock. Operator confirmation: "changing
    // device time is too easy to do" at this scale, so the
    // server's clock is the only bypass-resistant signal.
    render(
      <EventWishSection
        eventId="1"
        locale="ko"
        startTime={FUTURE}
        status="ongoing"
        setlistItems={[]}
        top3Wishes={[fanEntry(10, 5, "残陽")]}
      />,
    );
    // Title flips to the locked variant — the cap label and ✕
    // remove buttons hide.
    expect(screen.getByText(/lockedTitle/)).toBeTruthy();
    // The "최대 3곡" hint shows only pre-lock; absent here.
    expect(screen.queryByText("cap")).toBeNull();
    // The `+ 추가` button shows only when `canAddMore = !isLocked
    // && myWishes.length < MAX_WISHES`. Locked → absent.
    expect(screen.queryByText("add")).toBeNull();
  });

  it("status='upcoming' + FUTURE startTime → editor visible (no lock fires)", () => {
    // Sanity: the lock OR-chain only fires when one of the three
    // inputs is true. With a future startTime, upcoming status, and
    // no setTimeout fired, all three are false → editor open.
    render(
      <EventWishSection
        eventId="1"
        locale="ko"
        startTime={FUTURE}
        status="upcoming"
        setlistItems={[]}
        top3Wishes={[]}
      />,
    );
    // Title bar reads `🌸 title` when unlocked (vs `🌸 lockedTitle`
    // when locked). Anchor both ends of the regex so a future
    // `lockedTitle` rename ending in "title" doesn't slip through —
    // the `queryByText(/lockedTitle/)` assertion below would still
    // catch the regression, but the strict-match here documents the
    // exact unlocked-state contract. CR #294 nit.
    expect(screen.getByText(/^🌸 title$/)).toBeTruthy();
    expect(screen.queryByText(/lockedTitle/)).toBeNull();
    expect(screen.getByText("cap")).toBeTruthy();
  });
});
