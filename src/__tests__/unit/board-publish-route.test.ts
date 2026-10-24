// @vitest-environment node
//
// Board publish route contract (n15), Prisma and the board
// resolvers mocked: the 400/403/404/409/200 contract checked on the
// whole set BEFORE the transaction opens, the diff the locked section
// runs (retained rows untouched, stale rows deleted, new rows
// inserted), and that the write expires only the board aggregate.
// Row-level atomicity (a failure mid-publish leaves the previous set)
// is proven against the dev database in
// `src/__tests__/integration/board-picks.test.ts`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const tx = {
  $executeRaw: vi.fn(),
  event: { findFirst: vi.fn() },
  boardPick: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    createManyAndReturn: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findFirst: vi.fn() },
    song: { findMany: vi.fn() },
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

import { PUT } from "@/app/api/events/[id]/board/picks/route";
import { prisma } from "@/lib/prisma";
import * as dataCache from "@/lib/dataCache";
import { loadBoardGroups } from "@/lib/board/loadBoardGroups";
import { getAvailableSongsCached } from "@/lib/predict/availableSongs";
import type { AvailableSong } from "@/lib/types/predict";

const eventFind = vi.mocked(prisma.event.findFirst);
const songFindMany = vi.mocked(prisma.song.findMany);
const txMock = vi.mocked(prisma.$transaction);
const groupsMock = vi.mocked(loadBoardGroups);
const catalogMock = vi.mocked(getAvailableSongsCached);

const START = new Date("2026-11-14T07:30:00.000Z");
const ANON = "0f5e7c1a-1111-4222-8333-444455556666";
const OLD = new Date("2026-11-01T00:00:00.000Z");
const NEW = new Date("2026-11-10T00:00:00.000Z");

function event(overrides: Record<string, unknown> = {}) {
  return {
    boardEnabled: true,
    status: "scheduled",
    startTime: START,
    eventSeries: { artist: null },
    ...overrides,
  };
}

const catalog = (...ids: number[]) =>
  ids.map((id) => ({ songId: id }) as unknown as AvailableSong);

const req = (body: unknown, raw?: string) =>
  new Request("http://localhost/api/events/107/board/picks", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
const params = (id = "107") => ({ params: Promise.resolve({ id }) });
const p = (groupId: string, songId: string) => ({ groupId, songId });
const publish = (picks: unknown, id = "107") =>
  PUT(req({ anonId: ANON, picks }), params(id));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(START.getTime() - 24 * 60 * 60 * 1000));
  eventFind.mockResolvedValue(event() as never);
  // Every requested song exists unless a test says otherwise.
  songFindMany.mockImplementation((async (args: {
    where: { id: { in: bigint[] } };
  }) => args.where.id.in.map((id) => ({ id }))) as never);
  groupsMock.mockResolvedValue([
    { artistId: 1, slug: "hasunosora", label: "蓮ノ空", color: null },
    { artistId: 2, slug: "aqours", label: "Aqours", color: null },
  ]);
  // Group 1 owns songs 10–14, group 2 owns 20–21; 30 is a crossover.
  catalogMock.mockImplementation((async (groupId: bigint) =>
    groupId === BigInt(1)
      ? catalog(10, 11, 12, 13, 14, 30)
      : catalog(20, 21, 30)) as never);
  txMock.mockImplementation((async (fn: (t: typeof tx) => unknown) => fn(tx)) as never);
  tx.$executeRaw.mockResolvedValue(1);
  tx.event.findFirst.mockResolvedValue(event());
  tx.boardPick.findMany.mockResolvedValue([]);
  tx.boardPick.deleteMany.mockResolvedValue({ count: 0 });
  tx.boardPick.createManyAndReturn.mockImplementation(
    async (args: { data: Array<{ groupArtistId: bigint; songId: bigint }> }) =>
      args.data.map((d, i) => ({
        id: `new-${i}`,
        groupArtistId: d.groupArtistId,
        songId: d.songId,
        createdAt: NEW,
      })),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PUT /board/picks — replace", () => {
  it("keeps same-song-same-group rows (id + timestamp), deletes the rest, inserts the new", async () => {
    tx.boardPick.findMany.mockResolvedValue([
      { id: "keep", groupArtistId: BigInt(1), songId: BigInt(10), createdAt: OLD },
      { id: "drop", groupArtistId: BigInt(1), songId: BigInt(11), createdAt: OLD },
      // A crossover moving from group 1 to group 2 is a new vote.
      { id: "moved", groupArtistId: BigInt(1), songId: BigInt(30), createdAt: OLD },
    ]);
    const res = await publish([p("1", "10"), p("1", "12"), p("2", "30")]);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(tx.boardPick.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["drop", "moved"] } },
    });
    const inserted = tx.boardPick.createManyAndReturn.mock.calls[0][0].data;
    expect(inserted.map((d: { songId: bigint }) => d.songId)).toEqual([
      BigInt(12),
      BigInt(30),
    ]);
    expect(await res.json()).toEqual({
      picks: [
        { id: "keep", groupId: "1", songId: "10", createdAt: OLD.toISOString() },
        { id: "new-0", groupId: "1", songId: "12", createdAt: NEW.toISOString() },
        { id: "new-1", groupId: "2", songId: "30", createdAt: NEW.toISOString() },
      ],
    });
  });

  it("deletes before it inserts (the unique (event, anon, song) never sees both rows)", async () => {
    const order: string[] = [];
    tx.boardPick.findMany.mockResolvedValue([
      { id: "moved", groupArtistId: BigInt(1), songId: BigInt(30), createdAt: OLD },
    ]);
    tx.boardPick.deleteMany.mockImplementation(async () => {
      order.push("delete");
      return { count: 1 };
    });
    const create = tx.boardPick.createManyAndReturn.getMockImplementation()!;
    tx.boardPick.createManyAndReturn.mockImplementation(async (args) => {
      order.push("insert");
      return create(args);
    });
    expect((await publish([p("2", "30")])).status).toBe(200);
    expect(order).toEqual(["delete", "insert"]);
  });

  it("an empty array clears the ballot", async () => {
    tx.boardPick.findMany.mockResolvedValue([
      { id: "a", groupArtistId: BigInt(1), songId: BigInt(10), createdAt: OLD },
    ]);
    const res = await publish([]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ picks: [] });
    expect(tx.boardPick.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["a"] } } });
    expect(tx.boardPick.createManyAndReturn).not.toHaveBeenCalled();
  });

  it("republishing the same set writes nothing", async () => {
    tx.boardPick.findMany.mockResolvedValue([
      { id: "a", groupArtistId: BigInt(1), songId: BigInt(10), createdAt: OLD },
    ]);
    expect((await publish([p("1", "10")])).status).toBe(200);
    expect(tx.boardPick.deleteMany).not.toHaveBeenCalled();
    expect(tx.boardPick.createManyAndReturn).not.toHaveBeenCalled();
  });

  it("expires only the board aggregate", async () => {
    await publish([p("1", "10")]);
    expect(dataCache.revalidateBoardAggregate).toHaveBeenCalledExactlyOnceWith(BigInt(107));
    for (const spy of [
      dataCache.revalidatePublicData,
      dataCache.revalidateEventData,
      dataCache.revalidateEventImpressions,
      dataCache.revalidateBoardControl,
    ]) {
      expect(vi.mocked(spy)).not.toHaveBeenCalled();
    }
  });
});

describe("PUT /board/picks — refused before anything is written", () => {
  it.each([
    ["picks missing", { anonId: ANON }, "invalid_body"],
    ["picks not an array", { anonId: ANON, picks: {} }, "invalid_body"],
    ["too many items", { anonId: ANON, picks: Array(65).fill(p("1", "10")) }, "invalid_body"],
    ["item not an object", { anonId: ANON, picks: ["10"] }, "invalid_body"],
    ["numeric groupId", { anonId: ANON, picks: [{ groupId: 1, songId: "10" }] }, "invalid_group"],
    ["bad songId", { anonId: ANON, picks: [p("1", "-3")] }, "invalid_song"],
    ["missing anonId", { picks: [] }, "invalid_anon_id"],
    ["one song twice", { anonId: ANON, picks: [p("1", "30"), p("2", "30")] }, "duplicate_song"],
  ])("400 — %s", async (_name, body, code) => {
    const res = await PUT(req(body), params());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: code });
    expect(txMock).not.toHaveBeenCalled();
  });

  it("400 — invalid JSON / non-numeric event id", async () => {
    expect((await PUT(req(null, "{"), params())).status).toBe(400);
    const res = await publish([], "abc");
    expect(await res.json()).toEqual({ error: "invalid_event_id" });
  });

  it("400 — a group not on this board", async () => {
    const res = await publish([p("99", "10")]);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_group" });
    expect(txMock).not.toHaveBeenCalled();
  });

  it("400 — a song outside its chosen group's catalog", async () => {
    const res = await publish([p("1", "10"), p("2", "11")]);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "song_outside_group" });
    expect(txMock).not.toHaveBeenCalled();
  });

  it("404 — a missing or soft-deleted song", async () => {
    songFindMany.mockResolvedValue([{ id: BigInt(10) }] as never);
    const res = await publish([p("1", "10"), p("1", "11")]);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "song_not_found" });
    expect(txMock).not.toHaveBeenCalled();
  });

  it("404 — missing event", async () => {
    eventFind.mockResolvedValue(null);
    const res = await publish([]);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("403 — disabled board", async () => {
    eventFind.mockResolvedValue(event({ boardEnabled: false }) as never);
    const res = await publish([p("1", "10")]);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "board_disabled" });
    expect(txMock).not.toHaveBeenCalled();
  });

  it("403 — locked: open 1 s before the start, refused at it (UTC instants)", async () => {
    vi.setSystemTime(new Date(START.getTime() - 1000));
    expect((await publish([p("1", "10")])).status).toBe(200);
    vi.setSystemTime(START);
    const res = await publish([p("1", "10")]);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "board_locked" });
  });

  it("409 — more than 3 picks for one group", async () => {
    const res = await publish([p("1", "10"), p("1", "11"), p("1", "12"), p("1", "13")]);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "cap_reached" });
    expect(txMock).not.toHaveBeenCalled();
  });

  it("400 beats 409: a fourth pick under a group not on the board is invalid_group", async () => {
    const res = await publish([p("99", "10"), p("99", "11"), p("99", "12"), p("99", "13")]);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_group" });
  });

  it("403 — the board locks while the publish waits for the ballot lock: nothing is written", async () => {
    tx.event.findFirst.mockResolvedValue(event({ boardEnabled: false }));
    const res = await publish([p("1", "10")]);
    expect(res.status).toBe(403);
    expect(tx.boardPick.deleteMany).not.toHaveBeenCalled();
    expect(tx.boardPick.createManyAndReturn).not.toHaveBeenCalled();
  });
});
