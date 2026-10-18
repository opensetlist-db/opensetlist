// @vitest-environment node
//
// Board read route contract (n15): the control check decides the
// response shape BEFORE any aggregate work, every answer is HTTP
// `no-store`, and the read never touches a revalidate helper. The data
// cache is replaced by a pass-through so each call reaches the mocked
// sources (cache reuse itself is proven on a Preview, not here).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// No `song` model on purpose: the aggregate must take titles from the
// cached catalog, so any song query would throw here.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findFirst: vi.fn() },
    boardPick: { groupBy: vi.fn() },
    $queryRaw: vi.fn(),
  },
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
    revalidateBoardAggregate: vi.fn(),
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
const pickGroupBy = vi.mocked(prisma.boardPick.groupBy);
const participantsRaw = vi.mocked(prisma.$queryRaw);
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
  // Pin "now" a day before START so the stored-`scheduled` fixtures
  // resolve to upcoming on any wall-clock date (in real time, the
  // window START … START+12h would turn them ongoing). Tests that need
  // a boundary instant set their own time on top of this.
  vi.useFakeTimers();
  vi.setSystemTime(new Date(START.getTime() - 24 * 60 * 60 * 1000));
  groupsMock.mockResolvedValue([
    { artistId: 1, slug: "hasunosora", label: "蓮ノ空", color: "#f8b500" },
    { artistId: 2, slug: "liella", label: "Liella!", color: null },
  ]);
  catalogMock.mockResolvedValue([song(10, "残陽"), song(11, "ハナムスビ")]);
  // No fan picks unless a test says otherwise.
  pickGroupBy.mockResolvedValue([] as never);
  participantsRaw.mockResolvedValue([] as never);
});

/** One `boardPick.groupBy` row as Prisma returns it. */
function pickRow(group: number, songId: number, count: number, firstAt: string) {
  return {
    groupArtistId: BigInt(group),
    songId: BigInt(songId),
    _count: { _all: count },
    _min: { createdAt: new Date(firstAt) },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

function expectNoAggregateWork() {
  expect(groupsMock).not.toHaveBeenCalled();
  expect(catalogMock).not.toHaveBeenCalled();
  expect(pickGroupBy).not.toHaveBeenCalled();
  expect(participantsRaw).not.toHaveBeenCalled();
}

function expectNoRevalidate() {
  expect(dataCache.revalidatePublicData).not.toHaveBeenCalled();
  expect(dataCache.revalidateEventData).not.toHaveBeenCalled();
  expect(dataCache.revalidateEventImpressions).not.toHaveBeenCalled();
  expect(dataCache.revalidateBoardControl).not.toHaveBeenCalled();
  expect(dataCache.revalidateBoardAggregate).not.toHaveBeenCalled();
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

  it("fan picks → crowd TOP3 per group with counts, labels and the catalog's titles", async () => {
    findFirst.mockResolvedValue(
      control({ boardStarterSongIds: { "1": ["11"] } }) as never,
    );
    pickGroupBy.mockResolvedValue([
      pickRow(1, 11, 4, "2026-10-20T00:00:00.000Z"),
      pickRow(1, 10, 4, "2026-10-19T00:00:00.000Z"),
      // Not in the catalog any more (soft-deleted after it was picked).
      pickRow(1, 99, 2, "2026-10-18T00:00:00.000Z"),
      pickRow(1, 12, 1, "2026-10-18T00:00:00.000Z"),
      pickRow(2, 11, 1, "2026-10-21T00:00:00.000Z"),
      // A group that is no longer on this board: ignored.
      pickRow(7, 10, 9, "2026-10-21T00:00:00.000Z"),
    ] as never);
    participantsRaw.mockResolvedValue([
      { groupArtistId: BigInt(1), participants: 5 },
      { groupArtistId: BigInt(2), participants: 1 },
      { groupArtistId: BigInt(7), participants: 9 },
    ] as never);

    const body = await (await GET(req(), params())).json();
    const [g1, g2] = body.groups;
    expect(g1.expects).toEqual({
      top: [
        // 4 vs 4: the earlier first submission wins
        { songId: "10", title: "残陽", count: 4, available: true },
        { songId: "11", title: "ハナムスビ", count: 4, available: true },
        { songId: "99", title: "", count: 2, available: false },
      ],
      submissions: 11,
      participants: 5,
      label: "ok",
    });
    expect(g2.expects).toEqual({
      top: [{ songId: "11", title: "ハナムスビ", count: 1, available: true }],
      submissions: 1,
      participants: 1,
      label: "early",
    });
    // Starters still travel; the client shows them only on operator columns.
    expect(g1.starters).toEqual([{ songId: "11", title: "ハナムスビ" }]);
    // One catalog per group that has picks or starters, in the request locale.
    expect(catalogMock).toHaveBeenCalledTimes(2);
    expect(catalogMock).toHaveBeenCalledWith(BigInt(1), "ja");
    expect(catalogMock).toHaveBeenCalledWith(BigInt(2), "ja");
    // Exactly one grouped count + one distinct-participant count.
    expect(pickGroupBy).toHaveBeenCalledTimes(1);
    expect(pickGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["groupArtistId", "songId"],
        where: { eventId: BigInt(107) },
      }),
    );
    expect(participantsRaw).toHaveBeenCalledTimes(1);
    expectNoRevalidate();
  });

  it("asOf is the computation time", async () => {
    const now = new Date(START.getTime() - 60_000);
    vi.setSystemTime(now);
    findFirst.mockResolvedValue(control() as never);
    const body = await (await GET(req(), params())).json();
    expect(body.asOf).toBe(now.toISOString());
  });
});
