// @vitest-environment node
//
// Board read route contract (n15-02): the control check decides the
// response shape BEFORE any aggregate work, every answer is HTTP
// `no-store`, and the read never touches a revalidate helper. The data
// cache is replaced by a pass-through so each call reaches the mocked
// sources (cache reuse itself is proven on a Preview, not here).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { event: { findFirst: vi.fn() } },
}));
vi.mock("@/lib/dataCache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dataCache")>();
  return {
    ...actual,
    cachedQuery: (_name: string, fn: (...args: unknown[]) => unknown) => fn,
    revalidatePublicData: vi.fn(),
    revalidateEventData: vi.fn(),
    revalidateEventImpressions: vi.fn(),
    revalidateBoardControl: vi.fn(),
  };
});
vi.mock("@/lib/board/loadBoardGroups", () => ({
  loadBoardGroups: vi.fn(),
}));
vi.mock("@/lib/predict/availableSongs", () => ({
  getAvailableSongsCached: vi.fn(),
}));

import { GET } from "@/app/api/events/[id]/board/route";
import { prisma } from "@/lib/prisma";
import * as dataCache from "@/lib/dataCache";
import { loadBoardGroups } from "@/lib/board/loadBoardGroups";
import { getAvailableSongsCached } from "@/lib/predict/availableSongs";
import type { AvailableSong } from "@/lib/types/predict";

const findFirst = vi.mocked(prisma.event.findFirst);
const groupsMock = vi.mocked(loadBoardGroups);
const catalogMock = vi.mocked(getAvailableSongsCached);

const START = new Date("2026-11-14T07:30:00.000Z");
const params = (id = "107") => ({ params: Promise.resolve({ id }) });
const req = (qs = "?locale=ja") =>
  new Request(`http://localhost/api/events/107/board${qs}`);

function control(overrides: Record<string, unknown> = {}) {
  return {
    boardEnabled: true,
    boardStarterSongIds: null,
    status: "scheduled",
    startTime: START,
    eventSeries: { artist: null },
    ...overrides,
  };
}

function song(id: number, title: string): AvailableSong {
  return {
    songId: id,
    originalTitle: title,
    originalLanguage: "ja",
    variantLabel: null,
    baseVersionId: null,
    translations: [],
    unit: {
      artistId: 1,
      slug: "g",
      label: "G",
      color: "#000",
      isSubUnit: false,
      isMainUnit: false,
    },
    isMultiArtist: false,
    creditedArtistIds: [1],
    festivalGroupIds: [],
  } as AvailableSong;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  groupsMock.mockResolvedValue([
    { artistId: 1, slug: "hasunosora", label: "蓮ノ空", color: "#f8b500" },
    { artistId: 2, slug: "liella", label: "Liella!", color: null },
  ]);
  catalogMock.mockResolvedValue([song(10, "残陽"), song(11, "ハナムスビ")]);
});

function expectNoAggregateWork() {
  expect(groupsMock).not.toHaveBeenCalled();
  expect(catalogMock).not.toHaveBeenCalled();
}

function expectNoRevalidate() {
  expect(dataCache.revalidatePublicData).not.toHaveBeenCalled();
  expect(dataCache.revalidateEventData).not.toHaveBeenCalled();
  expect(dataCache.revalidateEventImpressions).not.toHaveBeenCalled();
  expect(dataCache.revalidateBoardControl).not.toHaveBeenCalled();
}

describe("GET /api/events/[id]/board", () => {
  it("400 on a non-numeric id, without a DB read", async () => {
    const res = await GET(req(), params("abc"));
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("404 when the event doesn't exist (or is soft-deleted)", async () => {
    findFirst.mockResolvedValue(null);
    const res = await GET(req(), params());
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("disabled → { enabled: false } with no aggregate work", async () => {
    findFirst.mockResolvedValue(control({ boardEnabled: false }) as never);
    const res = await GET(req(), params());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ enabled: false });
    expectNoAggregateWork();
    expectNoRevalidate();
  });

  it("ongoing → locked stub after the control read only", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START); // the instant the show starts
    findFirst.mockResolvedValue(control() as never);
    const res = await GET(req(), params());
    expect(await res.json()).toEqual({
      enabled: true,
      status: "ongoing",
      locked: true,
      lockAt: START.toISOString(),
    });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(findFirst).toHaveBeenCalledTimes(1);
    expectNoAggregateWork();
  });

  it("stored status ongoing → stub even before startTime", async () => {
    findFirst.mockResolvedValue(control({ status: "ongoing" }) as never);
    const body = await (await GET(req(), params())).json();
    expect(body).toMatchObject({ status: "ongoing", locked: true });
    expectNoAggregateWork();
  });

  it("cancelled → locked stub, no aggregate", async () => {
    findFirst.mockResolvedValue(control({ status: "cancelled" }) as never);
    const body = await (await GET(req(), params())).json();
    expect(body).toMatchObject({ enabled: true, status: "cancelled", locked: true });
    expectNoAggregateWork();
  });

  it("upcoming with starters → per-group views, starters labelled operator", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(START.getTime() - 1000)); // 1 s before start
    findFirst.mockResolvedValue(
      control({ boardStarterSongIds: { "1": ["11", "10", "999"] } }) as never,
    );
    const res = await GET(req(), params());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({
      enabled: true,
      status: "upcoming",
      locked: false,
      lockAt: START.toISOString(),
    });
    expect(typeof body.asOf).toBe("string");
    expect(new Date(body.asOf).toISOString()).toBe(body.asOf);
    expect(body.groups).toEqual([
      {
        groupId: "1",
        slug: "hasunosora",
        name: "蓮ノ空",
        color: "#f8b500",
        expects: { top: [], submissions: 0, participants: 0, label: "operator" },
        // stored order kept; "999" fell out of the catalog → dropped
        starters: [
          { songId: "11", title: "ハナムスビ" },
          { songId: "10", title: "残陽" },
        ],
      },
      {
        groupId: "2",
        slug: "liella",
        name: "Liella!",
        color: null,
        expects: { top: [], submissions: 0, participants: 0, label: "operator" },
        starters: [],
      },
    ]);
    // Only the group that HAS starters loads a catalog.
    expect(catalogMock).toHaveBeenCalledTimes(1);
    expect(catalogMock).toHaveBeenCalledWith(BigInt(1), "ja");
    expectNoRevalidate();
  });

  it("passes the series artist to the group loader on a single-artist event", async () => {
    findFirst.mockResolvedValue(
      control({ eventSeries: { artist: { id: BigInt(42), isDeleted: false } } }) as never,
    );
    await GET(req(), params());
    expect(groupsMock).toHaveBeenCalledWith(
      expect.objectContaining({ primaryArtistId: BigInt(42), locale: "ja" }),
    );
  });

  it("a soft-deleted series artist falls back to the festival branch", async () => {
    findFirst.mockResolvedValue(
      control({ eventSeries: { artist: { id: BigInt(42), isDeleted: true } } }) as never,
    );
    await GET(req(), params());
    expect(groupsMock).toHaveBeenCalledWith(
      expect.objectContaining({ primaryArtistId: null }),
    );
  });

  it("unknown locale clamps to the default (ja) instead of minting a key", async () => {
    findFirst.mockResolvedValue(control() as never);
    await GET(req("?locale=xx"), params());
    expect(groupsMock).toHaveBeenCalledWith(expect.objectContaining({ locale: "ja" }));
  });

  it("completed → aggregate shape with locked: true", async () => {
    findFirst.mockResolvedValue(control({ status: "completed" }) as never);
    const body = await (await GET(req(), params())).json();
    expect(body).toMatchObject({ enabled: true, status: "completed", locked: true });
    expect(body.groups).toHaveLength(2);
  });

  it("response carries nothing personal", async () => {
    findFirst.mockResolvedValue(control() as never);
    const text = await (await GET(req(), params())).text();
    expect(text).not.toMatch(/anon/i);
  });
});
