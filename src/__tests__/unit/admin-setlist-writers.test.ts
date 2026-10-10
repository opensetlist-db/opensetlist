import { describe, it, expect, vi, beforeEach } from "vitest";

// n14 writer contract for the admin setlist routes, with the database
// mocked: every save is ONE interactive transaction ordered
//   lockEvent → reads → writes → bumpSetlistRevisionAndBroadcast
// and the event cache is expired only after the transaction resolved.
// The real SQL (row lock, revision increment, realtime.messages row) is
// exercised against the dev DB in
// src/__tests__/integration/n14-live-path.test.ts.

const log = vi.hoisted(() => [] as string[]);

vi.mock("@/lib/admin-auth", () => ({ verifyAdminAPI: vi.fn(async () => null) }));

vi.mock("@/lib/dataCache", () => ({
  revalidateEventData: vi.fn(() => log.push("revalidate")),
}));

vi.mock("@/lib/liveBroadcast", () => ({
  lockEvent: vi.fn(async () => {
    log.push("lock");
    return true;
  }),
  bumpSetlistRevisionAndBroadcast: vi.fn(async () => {
    log.push("bump");
    return BigInt(12);
  }),
  revToNumber: (rev: bigint) => Number(rev),
}));

vi.mock("@/lib/prisma", () => {
  const rec =
    (name: string, value: unknown = {}) =>
    vi.fn(async () => {
      log.push(name);
      return typeof value === "function" ? (value as () => unknown)() : value;
    });
  const client = {
    setlistItem: {
      findMany: rec("findMany", []),
      findUnique: rec("findUnique", { eventId: BigInt(5) }),
      create: rec("create", { id: BigInt(900), eventId: BigInt(5) }),
      update: rec("update", { id: BigInt(900), eventId: BigInt(5) }),
    },
    setlistItemSong: { deleteMany: rec("deleteSongs") },
    setlistItemMember: { deleteMany: rec("deleteMembers") },
    setlistItemArtist: { deleteMany: rec("deleteArtists") },
    eventPerformer: { findMany: rec("eventPerformers", []) },
    $transaction: vi.fn(),
  };
  client.$transaction.mockImplementation(
    async (cb: (tx: typeof client) => Promise<unknown>) => {
      log.push("begin");
      const out = await cb(client);
      log.push("commit");
      return out;
    },
  );
  return { prisma: client };
});

import { POST as CREATE } from "@/app/api/admin/setlist-items/route";
import { PUT, DELETE } from "@/app/api/admin/setlist-items/[id]/route";
import { POST as INSERT_AFTER } from "@/app/api/admin/setlist-items/insert-after/route";
import { POST as SWAP } from "@/app/api/admin/setlist-items/swap/route";
import { prisma } from "@/lib/prisma";
import { bumpSetlistRevisionAndBroadcast } from "@/lib/liveBroadcast";
import { jsonRequest } from "../helpers/requestFactory";
import type { NextRequest } from "next/server";

const req = (url: string, body: unknown, method = "POST") =>
  jsonRequest(url, body, method) as unknown as NextRequest;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

// One-shot override that still records the call in `log` (a plain
// `mockResolvedValueOnce` would replace the logging implementation).
function logged(value: unknown) {
  return (async () => {
    log.push("findMany");
    return value;
  }) as never;
}
function onceFindMany(value: unknown) {
  vi.mocked(prisma.setlistItem.findMany).mockImplementationOnce(logged(value));
}

beforeEach(() => {
  log.length = 0;
  vi.clearAllMocks();
});

describe("admin setlist writers — transaction shape (n14)", () => {
  it("POST: lock → encore read → create → bump → commit → revalidate; rev in body", async () => {
    const res = await CREATE(
      req("http://x/api/admin/setlist-items", { eventId: 5, position: 1 }),
    );
    expect(res.status).toBe(201);
    expect(log).toEqual([
      "begin",
      "lock",
      "findMany",
      "create",
      "bump",
      "commit",
      "revalidate",
    ]);
    expect((await res.json()).rev).toBe(12);
  });

  it("POST: encore violation → 400, nothing written, no bump, no revalidate", async () => {
    onceFindMany([
      { position: 1, isEncore: true },
    ] as never);
    const res = await CREATE(
      req("http://x/api/admin/setlist-items", {
        eventId: 5,
        position: 2,
        isEncore: false,
      }),
    );
    expect(res.status).toBe(400);
    expect(prisma.setlistItem.create).not.toHaveBeenCalled();
    expect(bumpSetlistRevisionAndBroadcast).not.toHaveBeenCalled();
    expect(log).not.toContain("revalidate");
  });

  it("PUT: item → event resolved first, then one tx with the link rewrite and one bump", async () => {
    const res = await PUT(
      req("http://x/api/admin/setlist-items/900", { position: 1 }, "PUT"),
      params("900"),
    );
    expect(res.status).toBe(200);
    expect(log).toEqual([
      "findUnique",
      "begin",
      "lock",
      "findMany",
      "deleteSongs",
      "deleteMembers",
      "deleteArtists",
      "update",
      "bump",
      "commit",
      "revalidate",
    ]);
  });

  it("PUT on a missing item → 404 without opening a transaction", async () => {
    vi.mocked(prisma.setlistItem.findUnique).mockResolvedValueOnce(null);
    const res = await PUT(
      req("http://x/api/admin/setlist-items/1", { position: 1 }, "PUT"),
      params("1"),
    );
    expect(res.status).toBe(404);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("DELETE: soft-delete + bump in one tx", async () => {
    const res = await DELETE(
      req("http://x/api/admin/setlist-items/900", {}, "DELETE"),
      params("900"),
    );
    expect(res.status).toBe(200);
    expect(log).toEqual([
      "findUnique",
      "begin",
      "lock",
      "update",
      "bump",
      "commit",
      "revalidate",
    ]);
    expect(await res.json()).toEqual({ success: true, rev: 12 });
  });

  it("insert-after shifting k rows still bumps exactly once", async () => {
    onceFindMany([
      { id: BigInt(3), position: 3 },
      { id: BigInt(2), position: 2 },
    ] as never);
    const res = await INSERT_AFTER(
      req("http://x/api/admin/setlist-items/insert-after", {
        eventId: 5,
        afterPosition: 1,
      }),
    );
    expect(res.status).toBe(200);
    expect(log).toEqual([
      "begin",
      "lock",
      "findMany",
      "update",
      "update",
      "eventPerformers",
      "create",
      "bump",
      "commit",
      "revalidate",
    ]);
    expect(bumpSetlistRevisionAndBroadcast).toHaveBeenCalledTimes(1);
  });

  it("swap reads positions inside the transaction, after the lock", async () => {
    vi.mocked(prisma.setlistItem.findMany)
      // pre-tx membership read (eventId only)
      .mockImplementationOnce(
        logged([
          { id: BigInt(1), eventId: BigInt(5) },
          { id: BigInt(2), eventId: BigInt(5) },
        ]),
      )
      // in-tx position read
      .mockImplementationOnce(
        logged([
          { id: BigInt(1), position: 4 },
          { id: BigInt(2), position: 7 },
        ]),
      );
    const res = await SWAP(
      req("http://x/api/admin/setlist-items/swap", { itemIdA: 1, itemIdB: 2 }),
    );
    expect(res.status).toBe(200);
    expect(log).toEqual([
      "findMany",
      "begin",
      "lock",
      "findMany",
      "update",
      "update",
      "update",
      "bump",
      "commit",
      "revalidate",
    ]);
    const updates = vi.mocked(prisma.setlistItem.update).mock.calls.map(
      (c) => (c[0] as { where: { id: bigint }; data: { position: number } }),
    );
    expect(updates.map((u) => [u.where.id, u.data.position])).toEqual([
      [BigInt(1), -1],
      [BigInt(2), 4],
      [BigInt(1), 7],
    ]);
  });

  it("swap across events → 400 before any transaction", async () => {
    onceFindMany([
      { id: BigInt(1), eventId: BigInt(5) },
      { id: BigInt(2), eventId: BigInt(6) },
    ] as never);
    const res = await SWAP(
      req("http://x/api/admin/setlist-items/swap", { itemIdA: 1, itemIdB: 2 }),
    );
    expect(res.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
