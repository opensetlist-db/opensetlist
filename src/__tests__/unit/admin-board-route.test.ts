// @vitest-environment node
//
// Admin board settings endpoint (n15-02), mocked contract. The key
// property: a board-settings save is a plain single-row update — it
// never enters the live writer transaction and never calls a cache
// invalidation helper (the admin event PUT does both, which would
// expire the live snapshot entries).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/admin-auth", () => ({ verifyAdminAPI: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { event: { findFirst: vi.fn(), update: vi.fn() } },
}));
vi.mock("@/lib/dataCache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dataCache")>();
  return {
    ...actual,
    revalidatePublicData: vi.fn(),
    revalidateEventData: vi.fn(),
    revalidateEventImpressions: vi.fn(),
    revalidateBoardControl: vi.fn(),
  };
});
vi.mock("@/lib/liveWriterTx", () => ({
  liveWriterTransaction: vi.fn(),
  withAdminLiveWriterBusy: vi.fn(),
}));
vi.mock("@/lib/liveBroadcast", () => ({
  bumpSetlistRevisionAndBroadcast: vi.fn(),
  lockEvent: vi.fn(),
}));
vi.mock("@/lib/board/loadBoardGroups", () => ({ loadBoardGroups: vi.fn() }));
vi.mock("@/lib/predict/availableSongs", () => ({
  getAvailableSongsCached: vi.fn(),
}));

import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { GET, PATCH } from "@/app/api/admin/events/[id]/board/route";
import { GET as SEARCH } from "@/app/api/admin/events/[id]/board/songs/route";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import * as dataCache from "@/lib/dataCache";
import * as liveWriterTx from "@/lib/liveWriterTx";
import * as liveBroadcast from "@/lib/liveBroadcast";
import { loadBoardGroups } from "@/lib/board/loadBoardGroups";
import { getAvailableSongsCached } from "@/lib/predict/availableSongs";
import type { AvailableSong } from "@/lib/types/predict";

const auth = vi.mocked(verifyAdminAPI);
const findFirst = vi.mocked(prisma.event.findFirst);
const update = vi.mocked(prisma.event.update);
const groupsMock = vi.mocked(loadBoardGroups);
const catalogMock = vi.mocked(getAvailableSongsCached);

const params = (id = "107") => ({ params: Promise.resolve({ id }) });
const patch = (body: unknown) =>
  new Request("http://localhost/api/admin/events/107/board", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

function song(id: number, title: string, translations: AvailableSong["translations"] = []) {
  return {
    songId: id,
    originalTitle: title,
    originalLanguage: "ja",
    variantLabel: null,
    baseVersionId: null,
    translations,
  } as unknown as AvailableSong;
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue(null);
  findFirst.mockResolvedValue({
    id: BigInt(107),
    boardEnabled: false,
    boardStarterSongIds: { "1": ["10", "77"] },
    eventSeries: { artist: null },
  } as never);
  update.mockImplementation((async (args: { data: Record<string, unknown> }) => ({
    boardEnabled: args.data.boardEnabled ?? false,
    // Absent key = column untouched → the stored value comes back.
    boardStarterSongIds: !("boardStarterSongIds" in args.data)
      ? { "1": ["10", "77"] }
      : args.data.boardStarterSongIds === Prisma.DbNull
        ? null
        : args.data.boardStarterSongIds,
  })) as never);
  groupsMock.mockResolvedValue([
    { artistId: 1, slug: "hasunosora", label: "하스노소라", color: "#f8b500" },
    { artistId: 2, slug: "liella", label: "리에라!", color: null },
  ]);
  catalogMock.mockImplementation(async (rootId: bigint) =>
    rootId === BigInt(1)
      ? [song(10, "残陽", [{ locale: "ko", title: "잔양", variantLabel: null }]), song(11, "ハナムスビ")]
      : [song(20, "始まりは君の空")],
  );
});

function expectLivePathUntouched() {
  expect(dataCache.revalidatePublicData).not.toHaveBeenCalled();
  expect(dataCache.revalidateEventData).not.toHaveBeenCalled();
  expect(dataCache.revalidateEventImpressions).not.toHaveBeenCalled();
  expect(liveWriterTx.liveWriterTransaction).not.toHaveBeenCalled();
  expect(liveWriterTx.withAdminLiveWriterBusy).not.toHaveBeenCalled();
  expect(liveBroadcast.bumpSetlistRevisionAndBroadcast).not.toHaveBeenCalled();
}

describe("PATCH /api/admin/events/[id]/board", () => {
  it("returns the auth response untouched when not admin", async () => {
    const denied = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    auth.mockResolvedValue(denied);
    const res = await PATCH(patch({ boardEnabled: true }), params());
    expect(res.status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it("expires ONLY the board-control entry, after the update", async () => {
    await PATCH(patch({ boardEnabled: false }), params());
    expect(dataCache.revalidateBoardControl).toHaveBeenCalledTimes(1);
    expect(dataCache.revalidateBoardControl).toHaveBeenCalledWith(BigInt(107));
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(dataCache.revalidateBoardControl).mock.invocationCallOrder[0],
    );
    expectLivePathUntouched();
  });

  it("the control tag is distinct from the event / aggregate tags", () => {
    const control = dataCache.eventBoardControlTag(107);
    expect(control).not.toBe(dataCache.eventTag(107));
    expect(control).not.toBe(dataCache.eventBoardTag(107));
  });

  it("flips the flag with a plain update — no live writer, no event/global invalidation", async () => {
    const res = await PATCH(patch({ boardEnabled: true }), params());
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith({
      where: { id: BigInt(107) },
      data: { boardEnabled: true },
      select: { boardEnabled: true, boardStarterSongIds: true },
    });
    expect(await res.json()).toEqual({
      boardEnabled: true,
      starterSongIds: { "1": ["10", "77"] },
    });
    expectLivePathUntouched();
  });

  it("saves starters per group after catalog validation", async () => {
    const res = await PATCH(
      patch({ boardEnabled: true, starterSongIds: { "1": ["11", "10"], "2": [] } }),
      params(),
    );
    expect(res.status).toBe(200);
    expect(update.mock.calls[0][0]).toMatchObject({
      data: { boardEnabled: true, boardStarterSongIds: { "1": ["11", "10"] } },
    });
    // Only groups present in the map load a catalog.
    expect(catalogMock).toHaveBeenCalledTimes(1);
    expect(catalogMock).toHaveBeenCalledWith(BigInt(1), "ko");
    expectLivePathUntouched();
  });

  it("all-empty starters clear the column (DbNull), not an empty object", async () => {
    await PATCH(patch({ starterSongIds: { "1": [] } }), params());
    expect(update.mock.calls[0][0]).toMatchObject({
      data: { boardStarterSongIds: Prisma.DbNull },
    });
  });

  it.each([
    [{}, "empty_patch"],
    [{ boardEnabled: "yes" }, "invalid_flag"],
    [{ starterSongIds: { "9": ["10"] } }, "starter.unknownGroup"],
    [{ starterSongIds: { "1": ["10", "11", "12", "13"] } }, "starter.tooMany"],
    [{ starterSongIds: { "1": ["10", "10"] } }, "starter.duplicate"],
    // A song of group 2 offered under group 1 is outside group 1's catalog.
    [{ starterSongIds: { "1": ["20"] } }, "starter.outsideCatalog"],
    // Not in any catalog (variant, soft-deleted, or another IP).
    [{ starterSongIds: { "2": ["999"] } }, "starter.outsideCatalog"],
  ])("400 %j → %s, nothing written", async (body, code) => {
    const res = await PATCH(patch(body), params());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe(code);
    expect(typeof json.error).toBe("string");
    expect(update).not.toHaveBeenCalled();
    expect(dataCache.revalidateBoardControl).not.toHaveBeenCalled();
  });

  it("404 for a missing event", async () => {
    findFirst.mockResolvedValue(null);
    const res = await PATCH(patch({ boardEnabled: true }), params());
    expect(res.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });

  it("400 for a bad event id", async () => {
    const res = await PATCH(patch({ boardEnabled: true }), params("x"));
    expect(res.status).toBe(400);
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/events/[id]/board", () => {
  it("lists every board group with its stored starters, flagging stale ids", async () => {
    const res = await GET(new Request("http://localhost") as unknown as NextRequest, params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      boardEnabled: false,
      groups: [
        {
          groupId: "1",
          label: "하스노소라",
          color: "#f8b500",
          starters: [
            { songId: "10", title: "残陽", inCatalog: true },
            { songId: "77", title: "#77", inCatalog: false },
          ],
        },
        { groupId: "2", label: "리에라!", color: null, starters: [] },
      ],
    });
    expectLivePathUntouched();
  });
});

describe("GET /api/admin/events/[id]/board/songs (group-scoped search)", () => {
  const search = (qs: string) =>
    SEARCH(
      new Request(`http://localhost/api/admin/events/107/board/songs?${qs}`) as unknown as NextRequest,
      params(),
    );

  it("matches the original title and translations within the group's catalog", async () => {
    const res = await search("groupId=1&q=잔양");
    expect(await res.json()).toEqual({ songs: [{ songId: "10", title: "残陽" }] });
  });

  it("empty query lists the catalog", async () => {
    const json = await (await search("groupId=1&q=")).json();
    expect(json.songs.map((s: { songId: string }) => s.songId)).toEqual(["10", "11"]);
  });

  it("400 for a group that isn't on this event's board", async () => {
    const res = await search("groupId=9&q=a");
    expect(res.status).toBe(400);
    expect(catalogMock).not.toHaveBeenCalled();
  });
});
