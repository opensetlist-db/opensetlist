// @vitest-environment node
//
// Page guard (n15): the event page's server render hands the board
// block only its seed (lock time + chips) and NEVER runs board
// aggregation — the aggregate is the client's job, after mount, so a
// slow or failing board can't slow or 500 the page. Verified through
// the page's mocked dependencies: the board read module is a spy, the
// render is executed, and the element handed to <LiveEventLayout> is
// inspected.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement, ReactNode } from "react";

// Every Prisma call the page makes outside the mocked loaders below
// (reactions, impressions, trending) answers "nothing": empty lists,
// zero counts. `event.findFirst` is the one read with a fixture.
const eventFindFirst = vi.fn();
vi.mock("@/lib/prisma", () => {
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) => {
          if (name === "event" && method === "findFirst") return eventFindFirst;
          if (method === "count") return vi.fn(async () => 0);
          if (method.startsWith("find") && method.endsWith("Many")) return vi.fn(async () => []);
          if (method === "groupBy" || method === "aggregate") return vi.fn(async () => []);
          return vi.fn(async () => null);
        },
      },
    );
  return {
    prisma: new Proxy(
      {},
      {
        get: (_t, key: string) =>
          key.startsWith("$") ? vi.fn(async () => []) : model(key),
      },
    ),
  };
});
vi.mock("@/lib/dataCache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dataCache")>();
  return {
    ...actual,
    cachedQuery: (_name: string, fn: (...args: unknown[]) => unknown) => fn,
  };
});
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => {
    const t = (key: string) => key;
    return Object.assign(t, { rich: t, raw: t, markup: t, has: () => true });
  }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  permanentRedirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("@/lib/liveSnapshot", () => ({ getLiveSnapshot: vi.fn() }));
vi.mock("@/lib/wishes/top3", () => ({ fetchEventWishlistTop3: vi.fn(async () => []) }));
vi.mock("@/lib/eventRoster", () => ({ getEventRoster: vi.fn(async () => []) }));
vi.mock("@/lib/artistHierarchy", () => ({
  getArtistHierarchyCached: vi.fn(async () => ({
    parentOf: new Map(),
    childrenOf: new Map(),
    sortOrderOf: new Map(),
    sideProjects: new Set(),
  })),
}));
vi.mock("@/lib/predict/availableSongs", () => ({
  getAvailableSongsCached: vi.fn(async () => []),
  getFestivalGroupArtistsCached: vi.fn(async () => []),
}));
vi.mock("@/lib/board/loadBoardGroups", () => ({
  loadBoardGroups: vi.fn(async () => [
    { artistId: 1, slug: "hasunosora", label: "蓮ノ空", color: "#f8b500" },
    { artistId: 2, slug: "liella", label: "Liella!", color: null },
  ]),
}));
// The aggregation entry points — must never run during SSR.
vi.mock("@/lib/board/boardRead", () => ({
  resolveBoardRead: vi.fn(),
  getBoardAggregateCached: vi.fn(),
  getBoardControlCached: vi.fn(),
}));
// Client components are never rendered here; stubs keep their (DOM)
// module graphs out of the node environment.
vi.mock("@/components/LiveEventLayout", () => ({
  LiveEventLayout: function LiveEventLayout() {
    return null;
  },
}));
vi.mock("@/components/EventBdSection", () => ({ EventBdSection: () => null }));
vi.mock("@/components/Breadcrumb", () => ({ Breadcrumb: () => null }));

import EventPage from "@/app/[locale]/events/[id]/[[...slug]]/page";
import * as boardRead from "@/lib/board/boardRead";
import { loadBoardGroups } from "@/lib/board/loadBoardGroups";
import { LiveEventLayout } from "@/components/LiveEventLayout";

const DAY = 24 * 60 * 60 * 1000;

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 107,
    slug: "fes-day1",
    eventSeriesId: null,
    artistId: null,
    organizerName: null,
    bdAlbumId: null,
    bdAlbum: null,
    type: "festival",
    status: "scheduled",
    date: null,
    startTime: new Date(Date.now() + 10 * DAY).toISOString(),
    engagementOpensAt: null,
    country: null,
    posterUrl: null,
    originalName: "Fes Day.1",
    originalShortName: null,
    originalCity: null,
    originalVenue: null,
    originalLanguage: "ja",
    createdAt: new Date().toISOString(),
    setlistRevision: 0,
    boardEnabled: true,
    boardStarterSongIds: null,
    translations: [],
    eventSeries: null,
    setlistItems: [],
    performers: [],
    ...overrides,
  };
}

function findLayoutProps(node: ReactNode): Record<string, unknown> | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findLayoutProps(child);
      if (hit) return hit;
    }
    return null;
  }
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (el.type === LiveEventLayout) return el.props as Record<string, unknown>;
  return findLayoutProps(el.props?.children);
}

async function renderPage() {
  const tree = await EventPage({
    params: Promise.resolve({ locale: "ko", id: "107", slug: ["fes-day1"] }),
  });
  const props = findLayoutProps(tree);
  if (!props) throw new Error("LiveEventLayout not found in the page tree");
  return props;
}

function expectNoAggregation() {
  expect(boardRead.resolveBoardRead).not.toHaveBeenCalled();
  expect(boardRead.getBoardAggregateCached).not.toHaveBeenCalled();
  expect(boardRead.getBoardControlCached).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("event page × fan board (server render)", () => {
  it("upcoming + enabled → seed with lock time and chips only, no aggregation", async () => {
    const row = eventRow();
    eventFindFirst.mockResolvedValue(row);
    const props = await renderPage();
    expect(props.board).toEqual({
      lockAt: new Date(row.startTime).toISOString(),
      chips: [
        { groupId: "1", slug: "hasunosora", label: "蓮ノ空", color: "#f8b500" },
        { groupId: "2", slug: "liella", label: "Liella!", color: null },
      ],
      // Copy-my-picks context: the localized name and the canonical
      // path (entityPath), never a slugified display name.
      share: { eventName: "Fes Day.1", path: "/ko/events/107/fes-day1" },
    });
    expectNoAggregation();
  });

  it("completed + enabled → seed (post-show board)", async () => {
    eventFindFirst.mockResolvedValue(
      eventRow({ status: "completed", startTime: new Date(Date.now() - 2 * DAY).toISOString() }),
    );
    const props = await renderPage();
    expect(props.board).not.toBeNull();
    expectNoAggregation();
  });

  it("disabled → no seed, groups not even resolved", async () => {
    eventFindFirst.mockResolvedValue(eventRow({ boardEnabled: false }));
    const props = await renderPage();
    expect(props.board).toBeNull();
    expect(loadBoardGroups).not.toHaveBeenCalled();
    expectNoAggregation();
  });

  it("ongoing → no seed (today's wishlist renders instead), no board work", async () => {
    eventFindFirst.mockResolvedValue(eventRow({ status: "ongoing" }));
    const props = await renderPage();
    expect(props.board).toBeNull();
    expect(loadBoardGroups).not.toHaveBeenCalled();
    expectNoAggregation();
  });

  it("an enabled board with no resolvable group → no seed", async () => {
    vi.mocked(loadBoardGroups).mockResolvedValueOnce([]);
    eventFindFirst.mockResolvedValue(eventRow());
    const props = await renderPage();
    expect(props.board).toBeNull();
  });
});
