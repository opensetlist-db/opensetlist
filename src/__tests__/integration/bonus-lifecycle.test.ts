import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/admin-auth", () => ({ verifyAdminAPI: vi.fn(async () => null) }));
vi.mock("@/lib/dataCache", () => ({ revalidatePublicData: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { GET, POST } from "@/app/api/admin/album-bonuses/[id]/lifecycle/route";
import { PATCH as patchBonus } from "@/app/api/admin/album-bonuses/[id]/route";
import { PATCH as patchListing } from "@/app/api/admin/album-listings/[id]/route";

const tag = `bonus-lifecycle-itest-${randomUUID()}`;
let albumId: bigint;
let listingId: string;
let bonusId: string;
const extraListings: string[] = [];
const extraBonuses: string[] = [];

function request(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/admin/album-bonuses/${bonusId}/lifecycle`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
const params = () => ({ params: Promise.resolve({ id: bonusId }) });
const payload = (operationId: string) => ({
  listingId, expectedRevision: 0, expectedListingRevision: 0, operationId, action: "end",
  evidenceUrl: "https://example.com/evidence", summary: tag, observedAt: new Date().toISOString(),
});

beforeAll(async () => {
  const album = await prisma.album.create({ data: { slug: tag, type: "live_album", originalTitle: tag } });
  albumId = album.id;
  const listing = await prisma.albumStoreListing.create({ data: {
    albumId, originalStoreName: tag, status: "active", productUrl: "https://example.com/product",
  } });
  listingId = listing.id;
  const bonus = await prisma.albumStoreBonus.create({ data: { listingId, originalBonusType: tag } });
  bonusId = bonus.id;
});

afterAll(async () => {
  if (extraBonuses.length) await prisma.albumStoreBonus.deleteMany({ where: { id: { in: extraBonuses } } });
  if (extraListings.length) await prisma.albumStoreListing.deleteMany({ where: { id: { in: extraListings } } });
  if (bonusId) await prisma.albumStoreBonusLifecycleOperation.deleteMany({ where: { bonusId } });
  if (bonusId) await prisma.albumStoreBonus.delete({ where: { id: bonusId } });
  if (listingId) await prisma.albumStoreListing.delete({ where: { id: listingId } });
  if (albumId) await prisma.album.delete({ where: { id: albumId } });
});

describe("bonus lifecycle against PostgreSQL", () => {
  it("rejects stale observations after a generic option or bonus edit and blocks period bypass", async () => {
    const listing = await prisma.albumStoreListing.create({ data: {
      albumId, originalStoreName: `${tag}-edit`, status: "active", productUrl: "https://example.com/product",
    } });
    extraListings.push(listing.id);
    const bonus = await prisma.albumStoreBonus.create({ data: { listingId: listing.id, originalBonusType: tag } });
    extraBonuses.push(bonus.id);
    const context = { params: Promise.resolve({ id: bonus.id }) };
    const make = (path: string, body: unknown) => new NextRequest(`http://localhost${path}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const missingRevision = await patchBonus(make("/bonus", { originalBonusType: tag }), context);
    expect(missingRevision.status).toBe(400);
    const edited = await patchBonus(make("/bonus", { originalBonusType: `${tag}-edited`, expectedRevision: 0 }), context);
    expect(edited.status).toBe(200);
    expect((await edited.json()).revision).toBe(1);
    const stale = { ...payload(randomUUID()), listingId: listing.id };
    expect((await POST(request(stale), context)).status).toBe(409);

    const listingEdit = await patchListing(make("/listing", { originalStoreName: `${tag}-edited-store`, status: "active" }),
      { params: Promise.resolve({ id: listing.id }) });
    expect(listingEdit.status).toBe(200);
    expect((await listingEdit.json()).revision).toBe(1);
    expect((await POST(request({ ...stale, operationId: randomUUID(), expectedRevision: 1 }), context)).status).toBe(409);

    await prisma.albumStoreBonus.update({ where: { id: bonus.id }, data: { endsAt: new Date("2020-01-01T00:00:00Z") } });
    const bypass = await patchBonus(make("/bonus", { originalBonusType: tag, expectedRevision: 1,
      startsAt: null, endsAt: "2099-01-01T00:00:00Z" }), context);
    expect(bypass.status).toBe(409);
    expect((await prisma.albumStoreBonus.findUniqueOrThrow({ where: { id: bonus.id } })).revision).toBe(1);
    await prisma.albumStoreBonus.update({ where: { id: bonus.id }, data: { endedAt: new Date(), endsAt: null } });
    expect((await patchBonus(make("/bonus", { originalBonusType: tag, expectedRevision: 1,
      startsAt: null, endsAt: "2099-01-01T00:00:00Z" }), context)).status).toBe(409);
  });

  it("rolls back the bonus and history when the transaction fails before commit", async () => {
    const transaction = prisma.$transaction.bind(prisma);
    const spy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(((callback: (tx: unknown) => Promise<unknown>, options: unknown) =>
      transaction(async (tx) => {
        await callback(tx);
        throw new Error("injected failure before commit");
      }, options as never)) as never);
    try {
      const response = await POST(request(payload(randomUUID())), params());
      expect(response.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    const bonus = await prisma.albumStoreBonus.findUniqueOrThrow({ where: { id: bonusId } });
    expect(bonus.endedAt).toBeNull();
    expect(bonus.revision).toBe(0);
    expect(await prisma.albumStoreBonusLifecycleOperation.count({ where: { bonusId } })).toBe(0);
  });

  it("serializes competing revisions and recovers a lost response by operation identity", async () => {
    const first = payload(randomUUID());
    const second = payload(randomUUID());
    const responses = await Promise.all([POST(request(first), params()), POST(request(second), params())]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = responses[0].status === 200 ? first : second;
    const replay = await POST(request(winner), params());
    expect(replay.status).toBe(200);
    expect((await replay.json()).status).toBe("already_applied");
    const mismatch = await POST(request({ ...winner, summary: `${tag}-different` }), params());
    expect(mismatch.status).toBe(409);
    expect((await mismatch.json()).code).toBe("operation_mismatch");

    const read = await GET(new NextRequest(`http://localhost/api/admin/album-bonuses/${bonusId}/lifecycle?listingId=${listingId}&operationId=${winner.operationId}`), params());
    expect(read.status).toBe(200);
    const result = await read.json();
    expect(result.state.revision).toBe(1);
    expect(result.state.endedAt).toBeTruthy();
    expect(result.operation.operationId).toBe(winner.operationId);
    expect(result.history).toHaveLength(1);
    expect(await prisma.albumStoreBonusLifecycleOperation.count({ where: { bonusId } })).toBe(1);

    const restore = { ...payload(randomUUID()), action: "restore", expectedRevision: 1,
      expectedListingRevision: result.state.listingRevision, startsAt: null, endsAt: null };
    const duplicate = await Promise.all([POST(request(restore), params()), POST(request(restore), params())]);
    expect(duplicate.map((r) => r.status)).toEqual([200, 200]);
    const statuses = await Promise.all(duplicate.map(async (r) => (await r.json()).status));
    expect(statuses.sort()).toEqual(["already_applied", "applied"]);
    expect(await prisma.albumStoreBonusLifecycleOperation.count({ where: { bonusId } })).toBe(2);
    expect((await prisma.albumStoreBonus.findUniqueOrThrow({ where: { id: bonusId } })).endedAt).toBeNull();
  });
});
