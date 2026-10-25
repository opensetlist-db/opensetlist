// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const db = vi.hoisted(() => ({
  event: { findFirst: vi.fn(), update: vi.fn() },
  artist: { findMany: vi.fn(), count: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/admin-auth", () => ({ verifyAdminAPI: vi.fn() }));
vi.mock("@/lib/dataCache", () => ({ revalidateEventData: vi.fn() }));
vi.mock("@/lib/liveBroadcast", () => ({ lockEvent: vi.fn() }));

import { GET, PATCH } from "@/app/api/admin/events/[id]/collaborations/route";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { revalidateEventData } from "@/lib/dataCache";
import { lockEvent } from "@/lib/liveBroadcast";

const props = (id = "107") => ({ params: Promise.resolve({ id }) });
const request = (body: unknown) => new NextRequest("http://localhost/api/admin/events/107/collaborations", {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const getRequest = () => new NextRequest("http://localhost/api/admin/events/107/collaborations");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyAdminAPI).mockResolvedValue(null);
  db.event.findFirst.mockResolvedValue({ id: BigInt(107), collaborationArtists: [{ artistId: BigInt(41) }] });
  db.event.update.mockResolvedValue({ id: BigInt(107) });
  db.artist.count.mockImplementation(async ({ where }: { where: { id: { in: bigint[] } } }) => where.id.in.length);
  db.artist.findMany.mockResolvedValue([
    { id: BigInt(41), originalName: "AiScReam", translations: [] },
    { id: BigInt(82), originalName: "GKSS", translations: [{ name: "GKSS" }] },
  ]);
  db.$transaction.mockImplementation(async (run: (tx: typeof db) => Promise<unknown>) => run(db));
});

describe("event collaboration settings", () => {
  it("reads the explicit selection independently of member affiliations", async () => {
    const result = await GET(getRequest(), props());
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ artists: [
      { artistId: "41", label: "AiScReam", included: true },
      { artistId: "82", label: "GKSS", included: false },
    ] });
    expect(db.artist.findMany.mock.calls[0][0].where).toEqual({ isDeleted: false, isSideProject: true, parentArtistId: null });
  });

  it("requires admin auth for both methods", async () => {
    expect((await PATCH(request({ artistIds: ["41"] }), props())).status).toBe(200);
    vi.mocked(verifyAdminAPI).mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    expect((await GET(getRequest(), props())).status).toBe(401);
    expect((await PATCH(request({ artistIds: [] }), props())).status).toBe(401);
    expect(db.event.update).toHaveBeenCalledTimes(1);
  });

  it("serializes atomic replacement under the event lock, then invalidates its cache", async () => {
    expect((await PATCH(request({ artistIds: ["41"] }), props())).status).toBe(200);
    expect(lockEvent).toHaveBeenCalledWith(db, BigInt(107));
    expect(db.artist.count).toHaveBeenCalledWith({ where: {
      id: { in: [BigInt(41)] }, isDeleted: false, isSideProject: true, parentArtistId: null,
    } });
    expect(db.event.update).toHaveBeenCalledWith({
      where: { id: BigInt(107) },
      data: { collaborationArtists: { deleteMany: {}, create: [{ artistId: BigInt(41) }] } },
      select: { id: true },
    });
    expect(vi.mocked(lockEvent).mock.invocationCallOrder[0]).toBeLessThan(db.event.findFirst.mock.invocationCallOrder[0]);
    expect(db.event.update.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(revalidateEventData).mock.invocationCallOrder[0]);
    expect(revalidateEventData).toHaveBeenCalledWith(BigInt(107));
  });

  it("an empty list explicitly clears the assignment", async () => {
    expect((await PATCH(request({ artistIds: ["41"] }), props())).status).toBe(200);
    expect((await PATCH(request({ artistIds: [] }), props())).status).toBe(200);
    expect(db.event.update.mock.calls[1][0].data).toEqual({ collaborationArtists: { deleteMany: {}, create: [] } });
  });

  it.each([{}, { artistIds: null }, { artistIds: "41" }, { artistIds: [41] }, { artistIds: ["0"] },
    { artistIds: ["9223372036854775808"] }, { artistIds: ["41", "41"] }])("rejects malformed selection %j before writing", async (body) => {
    expect((await PATCH(request({ artistIds: ["41"] }), props())).status).toBe(200);
    expect((await PATCH(request(body), props())).status).toBe(400);
    expect(db.event.update).toHaveBeenCalledTimes(1);
    expect(revalidateEventData).toHaveBeenCalledTimes(1);
  });

  it("rejects deleted, non-root or non-collaboration artists without replacing existing assignments", async () => {
    expect((await PATCH(request({ artistIds: ["41"] }), props())).status).toBe(200);
    db.artist.count.mockResolvedValue(0);
    const response = await PATCH(request({ artistIds: ["82"] }), props());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_collaboration" });
    expect(db.event.update).toHaveBeenCalledTimes(1);
  });

  it("returns 404 if the locked event is missing or deleted", async () => {
    expect((await PATCH(request({ artistIds: ["41"] }), props())).status).toBe(200);
    db.event.findFirst.mockResolvedValue(null);
    expect((await PATCH(request({ artistIds: [] }), props())).status).toBe(404);
    expect(db.event.update).toHaveBeenCalledTimes(1);
    expect((await GET(getRequest(), props())).status).toBe(404);
  });

  it("returns JSON errors without invalidating on a failed transaction", async () => {
    expect((await PATCH(request({ artistIds: ["41"] }), props())).status).toBe(200);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.$transaction.mockRejectedValueOnce(new Error("transaction failed"));
    expect((await PATCH(request({ artistIds: ["41"] }), props())).status).toBe(500);
    expect(revalidateEventData).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});
