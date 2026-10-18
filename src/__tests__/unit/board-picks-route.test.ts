// @vitest-environment node
//
// Board pick write + "mine" route contracts (n15-03), with Prisma and
// the board resolvers mocked: the error contract (400/403/404/409/503),
// the idempotent retry, the order "control check → ballot lock →
// ballot validation", the lock boundary at the start time (UTC, ±1 s),
// the cache headers, and that no write path ever calls a revalidate
// helper. Row-level behaviour (real cap under concurrency, unique
// constraint) is proven against the dev database in
// `src/__tests__/integration/board-picks.test.ts`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const tx = {
  $executeRaw: vi.fn(),
  event: { findFirst: vi.fn() },
  boardPick: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findFirst: vi.fn() },
    song: { findFirst: vi.fn() },
    boardPick: { findMany: vi.fn() },
    $transaction: vi.fn(),
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
vi.mock("@/lib/board/loadBoardGroups", () => ({ loadBoardGroups: vi.fn() }));
vi.mock("@/lib/predict/availableSongs", () => ({
  getAvailableSongsCached: vi.fn(),
}));

import { POST } from "@/app/api/events/[id]/board/picks/route";
import { DELETE } from "@/app/api/events/[id]/board/picks/[pickId]/route";
import { GET as MINE } from "@/app/api/events/[id]/board/mine/route";
import { ANON_TOKEN_HEADER } from "@/lib/anonId";
import { prisma } from "@/lib/prisma";
import * as dataCache from "@/lib/dataCache";
import { loadBoardGroups } from "@/lib/board/loadBoardGroups";
import { getAvailableSongsCached } from "@/lib/predict/availableSongs";
import type { AvailableSong } from "@/lib/types/predict";

const eventFind = vi.mocked(prisma.event.findFirst);
const songFind = vi.mocked(prisma.song.findFirst);
const mineFind = vi.mocked(prisma.boardPick.findMany);
const txMock = vi.mocked(prisma.$transaction);
const groupsMock = vi.mocked(loadBoardGroups);
const catalogMock = vi.mocked(getAvailableSongsCached);

const START = new Date("2026-11-14T07:30:00.000Z");
const ANON = "0f5e7c1a-1111-4222-8333-444455556666";
const CREATED = new Date("2026-11-01T00:00:00.000Z");

function event(overrides: Record<string, unknown> = {}) {
  return {
    boardEnabled: true,
    boardStarterSongIds: null,
    status: "scheduled",
    startTime: START,
    eventSeries: { artist: null },
    ...overrides,
  };
}

function catalogSong(id: number): AvailableSong {
  return { songId: id, festivalGroupIds: [1] } as unknown as AvailableSong;
}

const postReq = (body: unknown, raw?: string) =>
  new Request("http://localhost/api/events/107/board/picks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
const delReq = (body: unknown) =>
  new Request("http://localhost/api/events/107/board/picks/p1", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const params = (id = "107") => ({ params: Promise.resolve({ id }) });
const delParams = (pickId = "p1", id = "107") => ({
  params: Promise.resolve({ id, pickId }),
});
const body = (o: Record<string, unknown> = {}) => ({
  groupId: "1",
  songId: "10",
  anonId: ANON,
  ...o,
});

/** Every revalidate helper the data-cache module exposes, spied. */
function revalidateSpies() {
  return [
    dataCache.revalidatePublicData,
    dataCache.revalidateEventData,
    dataCache.revalidateEventImpressions,
    dataCache.revalidateBoardControl,
    dataCache.revalidateBoardAggregate,
  ].map((f) => vi.mocked(f));
}

const order: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(START.getTime() - 24 * 60 * 60 * 1000));
  eventFind.mockResolvedValue(event() as never);
  songFind.mockResolvedValue({ id: BigInt(10) } as never);
  groupsMock.mockResolvedValue([
    { artistId: 1, slug: "hasunosora", label: "蓮ノ空", color: null },
    { artistId: 2, slug: "aqours", label: "Aqours", color: null },
  ]);
  catalogMock.mockResolvedValue([catalogSong(10), catalogSong(11)]);
  txMock.mockImplementation((async (fn: (t: typeof tx) => unknown) => {
    order.push("tx");
    return fn(tx);
  }) as never);
  tx.$executeRaw.mockImplementation(async () => {
    order.push("lock");
    return 1;
  });
  tx.event.findFirst.mockImplementation(async () => {
    order.push("control");
    return event();
  });
  tx.boardPick.findUnique.mockImplementation(async () => {
    order.push("existing");
    return null;
  });
  tx.boardPick.count.mockImplementation(async () => {
    order.push("count");
    return 0;
  });
  tx.boardPick.create.mockResolvedValue({ id: "new-id", createdAt: CREATED });
  tx.boardPick.findFirst.mockResolvedValue({ id: "p1", anonId: ANON });
  tx.boardPick.delete.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /board/picks — malformed input → 400", () => {
  it.each([
    ["non-numeric event id", "abc", body(), "invalid_event_id"],
    ["zero event id", "0", body(), "invalid_event_id"],
    ["missing anonId", "107", body({ anonId: undefined }), "invalid_anon_id"],
    ["empty anonId", "107", body({ anonId: "" }), "invalid_anon_id"],
    ["anonId with spaces", "107", body({ anonId: "a b" }), "invalid_anon_id"],
    ["numeric groupId", "107", body({ groupId: 1 }), "invalid_group"],
    ["numeric songId", "107", body({ songId: 10 }), "invalid_song"],
    ["negative songId", "107", body({ songId: "-1" }), "invalid_song"],
  ])("%s", async (_name, id, b, code) => {
    const res = await POST(postReq(b), params(id));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: code });
    expect(txMock).not.toHaveBeenCalled();
  });

  it("invalid JSON / JSON null", async () => {
    for (const raw of ["{", "null", "[]"]) {
      const res = await POST(postReq(null, raw), params());
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_body" });
    }
  });

  it("group not on this event's board", async () => {
    const res = await POST(postReq(body({ groupId: "99" })), params());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_group" });
    expect(txMock).not.toHaveBeenCalled();
  });

  it("song outside the chosen group's catalog", async () => {
    songFind.mockResolvedValue({ id: BigInt(77) } as never);
    const res = await POST(postReq(body({ songId: "77" })), params());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "song_outside_group" });
    expect(txMock).not.toHaveBeenCalled();
  });
});

describe("POST /board/picks — control", () => {
  it("missing event → 404", async () => {
    eventFind.mockResolvedValue(null);
    const res = await POST(postReq(body()), params());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("missing / soft-deleted song → 404", async () => {
    songFind.mockResolvedValue(null);
    const res = await POST(postReq(body()), params());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "song_not_found" });
  });

  it("board disabled → 403, no transaction", async () => {
    eventFind.mockResolvedValue(event({ boardEnabled: false }) as never);
    const res = await POST(postReq(body()), params());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "board_disabled" });
    expect(txMock).not.toHaveBeenCalled();
  });

  it("the control read is fresh (where clause on the live row, not a cache)", async () => {
    await POST(postReq(body()), params());
    expect(eventFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: BigInt(107), isDeleted: false },
      }),
    );
  });

  it("lock boundary: start − 1 s accepted, start and start + 1 s refused (UTC)", async () => {
    vi.setSystemTime(new Date(START.getTime() - 1000));
    expect((await POST(postReq(body()), params())).status).toBe(201);

    vi.setSystemTime(START);
    let res = await POST(postReq(body()), params());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "board_locked" });

    vi.setSystemTime(new Date(START.getTime() + 1000));
    res = await POST(postReq(body()), params());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "board_locked" });
  });

  it("stored status completed before the start time → 403 locked", async () => {
    eventFind.mockResolvedValue(event({ status: "completed" }) as never);
    const res = await POST(postReq(body()), params());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "board_locked" });
  });
});

describe("POST /board/picks — ballot", () => {
  it("new pick → 201 with string ids; lock taken before the ballot reads", async () => {
    const res = await POST(postReq(body()), params());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: "new-id",
      groupId: "1",
      songId: "10",
      createdAt: CREATED.toISOString(),
    });
    expect(order).toEqual(["tx", "lock", "control", "existing", "count"]);
    expect(tx.boardPick.create).toHaveBeenCalledWith({
      data: {
        eventId: BigInt(107),
        anonId: ANON,
        groupArtistId: BigInt(1),
        songId: BigInt(10),
      },
      select: { id: true, createdAt: true },
    });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("4th pick in a group → 409 cap_reached", async () => {
    tx.boardPick.count.mockResolvedValue(3);
    const res = await POST(postReq(body()), params());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "cap_reached" });
    expect(tx.boardPick.create).not.toHaveBeenCalled();
  });

  it("exact retry of (anon, song, group) → 200 with the same id", async () => {
    tx.boardPick.findUnique.mockResolvedValue({
      id: "old-id",
      groupArtistId: BigInt(1),
      createdAt: CREATED,
    });
    const res = await POST(postReq(body()), params());
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("old-id");
    expect(tx.boardPick.count).not.toHaveBeenCalled();
    expect(tx.boardPick.create).not.toHaveBeenCalled();
  });

  it("same (anon, song) under another group → 409 group_conflict", async () => {
    tx.boardPick.findUnique.mockResolvedValue({
      id: "old-id",
      groupArtistId: BigInt(2),
      createdAt: CREATED,
    });
    const res = await POST(postReq(body()), params());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "group_conflict" });
    expect(tx.boardPick.create).not.toHaveBeenCalled();
  });

  it("control re-checked under the lock: disabled / started while waiting → 403, nothing written", async () => {
    tx.event.findFirst.mockResolvedValueOnce(event({ boardEnabled: false }));
    let res = await POST(postReq(body()), params());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "board_disabled" });

    tx.event.findFirst.mockResolvedValueOnce(
      event({ startTime: new Date(Date.now() - 1) }),
    );
    res = await POST(postReq(body()), params());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "board_locked" });

    tx.event.findFirst.mockResolvedValueOnce(event({ boardEnabled: false }));
    res = await DELETE(delReq({ anonId: ANON }), delParams());
    expect(res.status).toBe(403);
    expect(tx.boardPick.create).not.toHaveBeenCalled();
    expect(tx.boardPick.delete).not.toHaveBeenCalled();
  });

  it("pool exhausted before the transaction → 503 busy + Retry-After", async () => {
    txMock.mockRejectedValue(
      new Error("timeout exceeded when trying to connect"),
    );
    const res = await POST(postReq(body()), params());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "busy" });
    expect(res.headers.get("Retry-After")).toBe("2");
  });
});

describe("DELETE /board/picks/[pickId]", () => {
  it("own pick → 200 { id }, under the ballot lock", async () => {
    const res = await DELETE(delReq({ anonId: ANON }), delParams());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "p1" });
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.boardPick.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "p1", eventId: BigInt(107) } }),
    );
    expect(tx.boardPick.delete).toHaveBeenCalledWith({ where: { id: "p1" } });
  });

  it("another anon's pick → 403 not_owner, nothing deleted", async () => {
    tx.boardPick.findFirst.mockResolvedValue({ id: "p1", anonId: "someone-else" });
    const res = await DELETE(delReq({ anonId: ANON }), delParams());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "not_owner" });
    expect(tx.boardPick.delete).not.toHaveBeenCalled();
  });

  it("no such pick on this event → 404 pick_not_found", async () => {
    tx.boardPick.findFirst.mockResolvedValue(null);
    const res = await DELETE(delReq({ anonId: ANON }), delParams());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "pick_not_found" });
  });

  it("does not look at the song — a soft-deleted song's pick stays removable", async () => {
    await DELETE(delReq({ anonId: ANON }), delParams());
    expect(songFind).not.toHaveBeenCalled();
  });

  it("missing anonId → 400; malformed pick id → 400", async () => {
    let res = await DELETE(delReq({}), delParams());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_anon_id" });
    res = await DELETE(delReq({ anonId: ANON }), delParams("a/b"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_pick_id" });
  });

  it("at the start time → 403 locked; disabled → 403", async () => {
    vi.setSystemTime(START);
    let res = await DELETE(delReq({ anonId: ANON }), delParams());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "board_locked" });

    vi.setSystemTime(new Date(START.getTime() - 1000));
    eventFind.mockResolvedValue(event({ boardEnabled: false }) as never);
    res = await DELETE(delReq({ anonId: ANON }), delParams());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "board_disabled" });
    expect(tx.boardPick.delete).not.toHaveBeenCalled();
  });
});

describe("GET /board/mine", () => {
  const mineReq = (qs: string, anon?: string) =>
    new Request(`http://localhost/api/events/107/board/mine${qs}`, {
      headers: anon === undefined ? {} : { [ANON_TOKEN_HEADER]: anon },
    });

  it("missing, empty or malformed header → 400, private no-store", async () => {
    for (const anon of [undefined, "", "a b", "x".repeat(65)]) {
      const res = await MINE(mineReq("?locale=ko", anon), params());
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_anon_id" });
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(mineFind).not.toHaveBeenCalled();
  });

  it("anonId in the query is refused even with a valid header", async () => {
    for (const anon of [undefined, ANON]) {
      const res = await MINE(mineReq(`?anonId=${ANON}`, anon), params());
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "anon_in_query" });
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(mineFind).not.toHaveBeenCalled();
  });

  it("missing event → 404", async () => {
    eventFind.mockResolvedValue(null);
    const res = await MINE(mineReq("", ANON), params());
    expect(res.status).toBe(404);
  });

  it("returns only the caller's rows, string ids, unavailable flag; private no-store", async () => {
    mineFind.mockResolvedValue([
      {
        id: "p1",
        groupArtistId: BigInt(1),
        songId: BigInt(10),
        createdAt: CREATED,
        song: {
          isDeleted: true,
          originalTitle: "残陽",
          originalLanguage: "ja",
          variantLabel: null,
          translations: [],
        },
      },
    ] as never);
    const res = await MINE(mineReq("?locale=ko", ANON), params());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({
      picks: [
        {
          id: "p1",
          groupId: "1",
          songId: "10",
          title: "残陽",
          available: false,
          createdAt: CREATED.toISOString(),
        },
      ],
    });
    expect(mineFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: BigInt(107), anonId: ANON },
      }),
    );
  });
});

describe("isolation", () => {
  it("no write path ever calls a revalidate helper", async () => {
    await POST(postReq(body()), params());
    tx.boardPick.findUnique.mockResolvedValue({
      id: "old-id",
      groupArtistId: BigInt(1),
      createdAt: CREATED,
    });
    await POST(postReq(body()), params());
    tx.boardPick.count.mockResolvedValue(3);
    tx.boardPick.findUnique.mockResolvedValue(null);
    await POST(postReq(body()), params());
    await DELETE(delReq({ anonId: ANON }), delParams());
    for (const spy of revalidateSpies()) expect(spy).not.toHaveBeenCalled();
  });
});
