// @vitest-environment node
//
// Per-group wish write contract on board-enabled events (n15), with
// Prisma and the cached loaders mocked: the wish routes switch to the
// board pick contract (strict anon id + group, advisory lock, cap 3 per
// (event, anon, group), lock at the start time, 400/403/404/409/200)
// when `Event.boardEnabled` is on, keep legacy rows removable without
// ever adopting them, and leave every other event on the old contract.
// The real lock / unique constraint are exercised against the dev DB in
// `src/__tests__/integration/board-wishes.test.ts`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const tx = {
  $executeRaw: vi.fn(),
  event: { findFirst: vi.fn() },
  songWish: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findFirst: vi.fn() },
    song: { findFirst: vi.fn() },
    songWish: {
      create: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
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

import { POST } from "@/app/api/events/[id]/wishes/route";
import { DELETE } from "@/app/api/events/[id]/wishes/[wishId]/route";
import { prisma } from "@/lib/prisma";
import * as dataCache from "@/lib/dataCache";
import { loadBoardGroups } from "@/lib/board/loadBoardGroups";
import { getAvailableSongsCached } from "@/lib/predict/availableSongs";
import type { AvailableSong } from "@/lib/types/predict";

const eventFind = vi.mocked(prisma.event.findFirst);
const songFind = vi.mocked(prisma.song.findFirst);
const plainWish = vi.mocked(prisma.songWish);
const txMock = vi.mocked(prisma.$transaction);
const groupsMock = vi.mocked(loadBoardGroups);
const catalogMock = vi.mocked(getAvailableSongsCached);

const START = new Date("2026-11-14T07:30:00.000Z");
const ANON = "0f5e7c1a-1111-4222-8333-444455556666";
const CREATED = new Date("2026-11-01T00:00:00.000Z");

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: BigInt(107),
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
  new Request("http://localhost/api/events/107/wishes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
const delReq = (body?: unknown) =>
  new Request("http://localhost/api/events/107/wishes/w1", {
    method: "DELETE",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
const params = (id = "107") => ({ params: Promise.resolve({ id }) });
const delParams = (wishId = "w1", id = "107") => ({
  params: Promise.resolve({ id, wishId }),
});
const body = (o: Record<string, unknown> = {}) => ({
  groupId: "1",
  songId: "10",
  anonId: ANON,
  ...o,
});

function expectNoSharedRevalidate() {
  for (const f of [
    dataCache.revalidatePublicData,
    dataCache.revalidateEventData,
    dataCache.revalidateEventImpressions,
    dataCache.revalidateBoardControl,
  ]) {
    expect(vi.mocked(f)).not.toHaveBeenCalled();
  }
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
  tx.songWish.findUnique.mockImplementation(async () => {
    order.push("existing");
    return null;
  });
  tx.songWish.count.mockImplementation(async () => {
    order.push("count");
    return 0;
  });
  tx.songWish.create.mockResolvedValue({ id: "new-id", createdAt: CREATED });
  tx.songWish.deleteMany.mockResolvedValue({ count: 1 });
  tx.songWish.findFirst.mockResolvedValue({ id: "w1" });
  plainWish.deleteMany.mockResolvedValue({ count: 1 } as never);
  plainWish.findFirst.mockResolvedValue({ id: "w1" } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /wishes on a board event — malformed input → 400", () => {
  it.each([
    // The pre-board client's body: no anon, no group, numeric song id.
    ["old client body", { songId: 10 }, "invalid_anon_id"],
    ["missing anonId", body({ anonId: undefined }), "invalid_anon_id"],
    ["empty anonId", body({ anonId: "" }), "invalid_anon_id"],
    ["missing groupId", body({ groupId: undefined }), "invalid_group"],
    ["numeric groupId", body({ groupId: 1 }), "invalid_group"],
    ["numeric songId", body({ songId: 10 }), "invalid_song"],
  ])("%s", async (_name, b, code) => {
    const res = await POST(postReq(b) as never, params());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: code });
    expect(txMock).not.toHaveBeenCalled();
    expect(plainWish.create).not.toHaveBeenCalled();
  });

  it("JSON null / array → invalid_body", async () => {
    for (const raw of ["null", "[]"]) {
      const res = await POST(postReq(null, raw) as never, params());
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_body" });
    }
  });

  it("group not on this board; song outside the group's catalog", async () => {
    let res = await POST(postReq(body({ groupId: "99" })) as never, params());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_group" });
    songFind.mockResolvedValue({ id: BigInt(77) } as never);
    res = await POST(postReq(body({ songId: "77" })) as never, params());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "song_outside_group" });
    expect(txMock).not.toHaveBeenCalled();
  });
});

describe("POST /wishes on a board event — control", () => {
  it("missing / soft-deleted song → 404", async () => {
    songFind.mockResolvedValue(null);
    const res = await POST(postReq(body()) as never, params());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "song_not_found" });
  });

  it("lock boundary: start − 1 s accepted, start and start + 1 s refused (UTC)", async () => {
    vi.setSystemTime(new Date(START.getTime() - 1000));
    expect((await POST(postReq(body()) as never, params())).status).toBe(201);
    for (const t of [START.getTime(), START.getTime() + 1000]) {
      vi.setSystemTime(new Date(t));
      const res = await POST(postReq(body()) as never, params());
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "board_locked" });
    }
  });

  it("flag turned off under the lock → 403 board_disabled, nothing written", async () => {
    tx.event.findFirst.mockResolvedValueOnce(event({ boardEnabled: false }));
    const res = await POST(postReq(body()) as never, params());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "board_disabled" });
    expect(tx.songWish.create).not.toHaveBeenCalled();
  });
});

describe("POST /wishes on a board event — ballot", () => {
  it("new wish → 201, stored with anon + chosen group; lock before the ballot reads", async () => {
    const res = await POST(postReq(body()) as never, params());
    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      id: "new-id",
      groupId: "1",
      songId: "10",
      createdAt: CREATED.toISOString(),
    });
    expect(order).toEqual(["tx", "lock", "control", "existing", "count"]);
    expect(tx.songWish.create).toHaveBeenCalledWith({
      data: {
        eventId: BigInt(107),
        anonId: ANON,
        groupArtistId: BigInt(1),
        songId: BigInt(10),
      },
      select: { id: true, createdAt: true },
    });
    // The board path never writes through the legacy create.
    expect(plainWish.create).not.toHaveBeenCalled();
    expectNoSharedRevalidate();
    expect(dataCache.revalidateBoardAggregate).toHaveBeenCalledExactlyOnceWith(BigInt(107));
  });

  it("the cap counts only THIS anon's rows in THIS group", async () => {
    await POST(postReq(body()) as never, params());
    expect(tx.songWish.count).toHaveBeenCalledWith({
      where: { eventId: BigInt(107), anonId: ANON, groupArtistId: BigInt(1) },
    });
  });

  it("4th wish in a group → 409 cap_reached", async () => {
    tx.songWish.count.mockResolvedValue(3);
    const res = await POST(postReq(body()) as never, params());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "cap_reached" });
    expect(tx.songWish.create).not.toHaveBeenCalled();
  });

  it("exact retry → 200 with the same id", async () => {
    tx.songWish.findUnique.mockResolvedValue({
      id: "old-id",
      groupArtistId: BigInt(1),
      createdAt: CREATED,
    });
    const res = await POST(postReq(body()) as never, params());
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("old-id");
    expect(tx.songWish.create).not.toHaveBeenCalled();
  });

  it("same (anon, song) under another group → 409 group_conflict", async () => {
    tx.songWish.findUnique.mockResolvedValue({
      id: "old-id",
      groupArtistId: BigInt(2),
      createdAt: CREATED,
    });
    const res = await POST(postReq(body()) as never, params());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "group_conflict" });
  });

  it("pool exhausted before the transaction → 503 busy", async () => {
    txMock.mockRejectedValue(new Error("timeout exceeded when trying to connect"));
    const res = await POST(postReq(body()) as never, params());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "busy" });
  });
});

describe("DELETE /wishes/[wishId] on a board event", () => {
  // The delete is ONE conditional deleteMany (owner = this anon, or no
  // owner); a 0 count is then explained by a lookup: gone → 404, still
  // there → someone else's → 403.
  const ownerOrLegacy = (anon: string | null) => ({
    where: {
      id: "w1",
      eventId: BigInt(107),
      OR: anon === null ? [{ anonId: null }] : [{ anonId: null }, { anonId: anon }],
    },
  });

  it("own wish → 200 { id }, one conditional delete under the ballot lock", async () => {
    const res = await DELETE(delReq({ anonId: ANON }), delParams());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "w1" });
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.songWish.deleteMany).toHaveBeenCalledWith(ownerOrLegacy(ANON));
    expect(tx.songWish.findFirst).not.toHaveBeenCalled();
    expectNoSharedRevalidate();
    expect(dataCache.revalidateBoardAggregate).toHaveBeenCalledExactlyOnceWith(BigInt(107));
  });

  it("another anon's wish → nothing deleted, 403 not_owner", async () => {
    tx.songWish.deleteMany.mockResolvedValue({ count: 0 });
    const res = await DELETE(delReq({ anonId: ANON }), delParams());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "not_owner" });
  });

  it("a ballot wish can't be removed without its anon id", async () => {
    plainWish.deleteMany.mockResolvedValue({ count: 0 } as never);
    plainWish.findFirst.mockResolvedValue({ id: "w1" } as never);
    const res = await DELETE(delReq(), delParams());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "not_owner" });
    // Only ownerless rows can match an anonymous delete.
    expect(plainWish.deleteMany).toHaveBeenCalledWith(ownerOrLegacy(null));
  });

  it("a LEGACY wish stays removable with an anon id — deleted as-is, never claimed", async () => {
    const res = await DELETE(delReq({ anonId: ANON }), delParams());
    expect(res.status).toBe(200);
    // The ownerless branch of the condition is what matches a legacy row.
    expect(tx.songWish.deleteMany).toHaveBeenCalledWith(ownerOrLegacy(ANON));
    // Nothing writes the caller's anon id onto the row.
    expect(tx.songWish.create).not.toHaveBeenCalled();
    expect(plainWish.create).not.toHaveBeenCalled();
  });

  it("a LEGACY wish stays removable by an old client's plain DELETE (no body)", async () => {
    const res = await DELETE(delReq(), delParams());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "w1" });
    expect(plainWish.deleteMany).toHaveBeenCalledWith(ownerOrLegacy(null));
    // No anon → no ballot to serialize on.
    expect(txMock).not.toHaveBeenCalled();
  });

  it("two concurrent anonymous deletes of one legacy row: the loser gets 404, not 500", async () => {
    plainWish.deleteMany
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 0 } as never);
    plainWish.findFirst.mockResolvedValue(null as never);
    const [a, b] = await Promise.all([
      DELETE(delReq(), delParams()),
      DELETE(delReq(), delParams()),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 404]);
  });

  it("gone → 404 wish_not_found", async () => {
    tx.songWish.deleteMany.mockResolvedValue({ count: 0 });
    tx.songWish.findFirst.mockResolvedValue(null);
    const res = await DELETE(delReq({ anonId: ANON }), delParams());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "wish_not_found" });
  });

  it("malformed anon id / wish id / body → 400", async () => {
    let res = await DELETE(delReq({ anonId: "a b" }), delParams());
    expect(await res.json()).toEqual({ error: "invalid_anon_id" });
    res = await DELETE(delReq({ anonId: ANON }), delParams("a/b"));
    expect(await res.json()).toEqual({ error: "invalid_wish_id" });
    res = await DELETE(
      new Request("http://localhost/api/events/107/wishes/w1", {
        method: "DELETE",
        body: "{",
      }),
      delParams(),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
  });

  it("at the start time → 403 board_locked (legacy rows included)", async () => {
    vi.setSystemTime(START);
    for (const b of [{ anonId: ANON }, undefined]) {
      const res = await DELETE(delReq(b), delParams());
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "board_locked" });
    }
    expect(tx.songWish.deleteMany).not.toHaveBeenCalled();
    expect(plainWish.deleteMany).not.toHaveBeenCalled();
  });
});

describe("events WITHOUT the board flag keep the old wish contract", () => {
  beforeEach(() => {
    eventFind.mockResolvedValue(event({ boardEnabled: false }) as never);
    plainWish.create.mockResolvedValue({ id: "wish-uuid-1", songId: BigInt(42) } as never);
    plainWish.deleteMany.mockResolvedValue({ count: 1 } as never);
  });

  it("POST { songId: 42 } → 200 { id, songId } — no anon, no group, no lock", async () => {
    const res = await POST(postReq({ songId: 42 }) as never, params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "wish-uuid-1", songId: 42 });
    expect(plainWish.create).toHaveBeenCalledWith({
      data: { eventId: BigInt(107), songId: BigInt(42) },
      select: { id: true, songId: true },
    });
    expect(txMock).not.toHaveBeenCalled();
  });

  it("POST with the board body shape is answered the old way (string songId → 400)", async () => {
    const res = await POST(postReq(body()) as never, params());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid songId" });
  });

  it("POST after start → the old 403 body", async () => {
    vi.setSystemTime(START);
    const res = await POST(postReq({ songId: 42 }) as never, params());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Wishlist is locked: event has started",
    });
  });

  it("DELETE → idempotent 200 { ok: true } via deleteMany, body ignored", async () => {
    const res = await DELETE(delReq({ anonId: "whatever" }), delParams());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(plainWish.deleteMany).toHaveBeenCalledWith({
      where: { id: "w1", eventId: BigInt(107) },
    });
    expect(txMock).not.toHaveBeenCalled();
  });

  it("missing event → the old 404 body", async () => {
    eventFind.mockResolvedValue(null);
    const res = await POST(postReq({ songId: 42 }) as never, params());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Event not found" });
  });
});
