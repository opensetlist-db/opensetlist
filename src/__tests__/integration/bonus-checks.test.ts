import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/admin-auth", () => ({ verifyAdminAPI: vi.fn(async () => null) }));
vi.mock("@/lib/dataCache", () => ({ revalidatePublicData: vi.fn(() => true) }));

import { prisma } from "@/lib/prisma";
import { GET, POST } from "@/app/api/admin/album-bonuses/[id]/lifecycle/route";
import { DELETE as deleteBonus } from "@/app/api/admin/album-bonuses/[id]/route";
import { GET as getLinks, POST as postLink } from "@/app/api/admin/album-bonuses/link-checks/route";
import { DELETE as deleteListing } from "@/app/api/admin/album-listings/[id]/route";
import { getBonusCheckQueue } from "@/lib/bonusChecks";
import { projectPurchaseOptions } from "@/lib/purchaseAvailability";

const tag = `bonus-check-itest-${randomUUID()}`;
let albumId: bigint;
let listingId: string;
let bonusId: string;
const params = () => ({ params: Promise.resolve({ id: bonusId }) });
const request = (url: string, body?: unknown) => new NextRequest(url, body === undefined ? undefined : {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const lifecycleUrl = () => `http://localhost/api/admin/album-bonuses/${bonusId}/lifecycle`;
const read = async () => (await GET(request(`${lifecycleUrl()}?listingId=${listingId}`), params())).json();
const queue = async () => getBonusCheckQueue(albumId);
const contains = (rows: { id: string }[]) => rows.some((row) => row.id === bonusId);
const publicOptions = async (now = new Date()) => projectPurchaseOptions(
  await prisma.albumStoreListing.findMany({ where: { albumId }, include: { bonuses: true } }), now,
);
const observe = async (action: string, extras: Record<string, unknown> = {}) => {
  const state = (await read()).state;
  const body = { listingId, expectedRevision: state.revision, expectedListingRevision: state.listingRevision,
    operationId: randomUUID(), action, evidenceUrl: "https://example.com/evidence", summary: tag,
    observedAt: new Date().toISOString(), ...extras };
  return { body, response: await POST(request(lifecycleUrl(), body), params()) };
};

beforeAll(async () => {
  const album = await prisma.album.create({ data: { slug: tag, type: "live_album", originalTitle: tag } });
  albumId = album.id;
  const listing = await prisma.albumStoreListing.create({ data: {
    albumId, originalStoreName: tag, status: "active", productUrl: "https://example.com/product", includesPerformanceVideo: true, isBonusOption: true,
  } });
  listingId = listing.id;
  const bonus = await prisma.albumStoreBonus.create({ data: { listingId, originalBonusType: tag } });
  bonusId = bonus.id;
});

afterAll(async () => {
  if (bonusId) await prisma.albumStoreBonusLifecycleOperation.deleteMany({ where: { bonusId } });
  if (albumId) await prisma.album.delete({ where: { id: albumId } });
});

describe("bonus checks against PostgreSQL", () => {
  it("records observations without ending a benefit and preserves successful verification on failure", async () => {
    expect(contains((await queue()).current)).toBe(true);
    const maintained = await observe("maintained");
    expect(maintained.response.status).toBe(200);
    const verified = await read();
    expect(verified.lastVerifiedAt).toBeTruthy();
    expect(verified.history).toHaveLength(0);
    const replay = await Promise.all([POST(request(lifecycleUrl(), maintained.body), params()), POST(request(lifecycleUrl(), maintained.body), params())]);
    expect(await Promise.all(replay.map(async (r) => (await r.json()).status))).toEqual(["already_applied", "already_applied"]);
    const recovered = await GET(request(`${lifecycleUrl()}?listingId=${listingId}&operationId=${maintained.body.operationId}`), params());
    expect((await recovered.json()).operation.operationId).toBe(maintained.body.operationId);
    expect((await observe("maintained", { expectedRevision: maintained.body.expectedRevision })).response.status).toBe(409);
    expect((await POST(request(lifecycleUrl(), { ...maintained.body, summary: "changed" }), params())).status).toBe(409);
    expect((await observe("review_needed")).response.status).toBe(200);
    expect(contains((await queue()).review)).toBe(true);
    expect((await observe("access_failed")).response.status).toBe(200);
    const failed = await read();
    expect(failed.latestObservation.action).toBe("access_failed");
    expect(failed.lastVerifiedAt).toBe(verified.lastVerifiedAt);
    expect(failed.history).toHaveLength(0);
    expect((await publicOptions()).bonusCount).toBe(1);
    expect((await observe("maintained", { listingId: randomUUID() })).response.status).toBe(404);
    expect((await observe("maintained", { expectedRevision: -1 })).response.status).toBe(400);
  });

  it("moves ended benefits out of checks, restores them, and respects an exact deadline", async () => {
    expect((await observe("maintained")).response.status).toBe(200);
    expect(contains((await queue()).current)).toBe(true);
    expect((await publicOptions()).bonusCount).toBe(1);
    expect((await observe("end")).response.status).toBe(200);
    expect(contains((await queue()).ended)).toBe(true);
    expect(contains((await queue()).current)).toBe(false);
    expect((await publicOptions()).bonusCount).toBe(0);
    expect((await observe("restore", { startsAt: null, endsAt: null })).response.status).toBe(200);
    expect(contains((await queue()).current)).toBe(true);
    expect((await publicOptions()).bonusCount).toBe(1);
    expect((await read()).history).toHaveLength(2);
    expect((await deleteBonus(request(lifecycleUrl()), params())).status).toBe(409);
    expect((await deleteListing(request(lifecycleUrl()), { params: Promise.resolve({ id: listingId }) })).status).toBe(409);
    expect((await read()).history).toHaveLength(2);
    const deadline = new Date("2099-01-01T00:00:00.000Z");
    await prisma.albumStoreBonus.update({ where: { id: bonusId }, data: { endsAt: deadline } });
    expect((await publicOptions(new Date(deadline.getTime() - 1))).bonusCount).toBe(1);
    expect((await publicOptions(deadline)).bonusCount).toBe(0);
    await prisma.albumStoreBonus.update({ where: { id: bonusId }, data: { endsAt: new Date(Date.now() - 1000) } });
    expect(contains((await queue()).ended)).toBe(true);
    expect(contains((await queue()).current)).toBe(false);
  });

  it("permits one failed retry and never publishes a placeholder link", async () => {
    const url = "http://localhost/api/admin/album-bonuses/link-checks";
    const storeKey = tag;
    const linkRead = async () => (await getLinks(request(`${url}?albumId=${albumId}&storeKey=${storeKey}`))).json();
    const base = { albumId: albumId.toString(), storeKey, storeName: tag,
      evidenceUrl: "https://example.com/evidence", summary: tag, productUrl: null };
    const initial = { ...base, phase: "initial", expectedRevision: 0, operationId: randomUUID(),
      observedAt: new Date(Date.now() - 30000).toISOString() };
    expect((await linkRead()).status).toBe("untried");
    const duplicate = await Promise.all([postLink(request(url, initial)), postLink(request(url, initial))]);
    expect((await Promise.all(duplicate.map(async (r) => (await r.json()).status))).sort()).toEqual(["already_applied", "applied"]);
    const recovered = await getLinks(request(`${url}?albumId=${albumId}&storeKey=${storeKey}&operationId=${initial.operationId}`));
    expect((await recovered.json()).operation.operationId).toBe(initial.operationId);
    let state = await linkRead();
    expect(state.status).toBe("retry_due");
    const retry = { ...base, phase: "retry", expectedRevision: state.revision, operationId: randomUUID(),
      observedAt: new Date(Date.now() - 20000).toISOString() };
    expect((await postLink(request(url, { ...retry, storeName: "다른 판매점" }))).status).toBe(400);
    expect((await postLink(request(url, retry))).status).toBe(200);
    state = await linkRead();
    expect(state.status).toBe("review_needed");
    expect(state.attempts).toHaveLength(2);
    expect((await postLink(request(url, { ...retry, operationId: randomUUID(), expectedRevision: state.revision }))).status).toBe(409);
    expect((await postLink(request(url, { ...initial, operationId: randomUUID() }))).status).toBe(409);
    const resolve = { ...base, phase: "resolve", expectedRevision: state.revision, operationId: randomUUID(),
      observedAt: new Date(Date.now() - 10000).toISOString(), productUrl: "https://example.com/" };
    expect((await postLink(request(url, resolve))).status).toBe(400);
    expect((await postLink(request(url, { ...resolve, productUrl: "https://example.com/products/list.php?mode=search" }))).status).toBe(400);
    expect((await postLink(request(url, { ...resolve, productUrl: "https://example.com/product" }))).status).toBe(200);
    expect((await linkRead()).status).toBe("found");
    const listings = await prisma.albumStoreListing.findMany({ where: { albumId } });
    expect(listings).toHaveLength(1);
    expect(listings[0].productUrl).toBe("https://example.com/product");
  });

  it.each([false, true])("excludes and restores link review without changing attempts (retry used: %s)", async (retryUsed) => {
    await prisma.albumStoreBonus.update({ where: { id: bonusId }, data: { endsAt: null } });
    const url = "http://localhost/api/admin/album-bonuses/link-checks";
    const storeName = `${tag}-${retryUsed}`;
    const target = `albumId=${albumId}&storeKey=${storeName}`;
    const linkRead = async (operationId?: string) => (await getLinks(request(
      `${url}?${target}${operationId ? `&operationId=${operationId}` : ""}`,
    ))).json();
    const base = { albumId: albumId.toString(), storeKey: storeName, storeName,
      evidenceUrl: "https://example.com/evidence", summary: tag, productUrl: null };
    const initial = { ...base, phase: "initial", expectedRevision: 0, operationId: randomUUID(),
      observedAt: new Date(Date.now() - 50000).toISOString() };
    expect((await postLink(request(url, initial))).status).toBe(200);
    if (retryUsed) {
      expect((await postLink(request(url, { ...base, phase: "retry", expectedRevision: 1,
        operationId: randomUUID(), observedAt: new Date(Date.now() - 40000).toISOString() }))).status).toBe(200);
    }
    const before = await linkRead();
    const publicBefore = await publicOptions();
    expect(publicBefore.bonusCount).toBe(1);
    expect(before.status).toBe(retryUsed ? "review_needed" : "retry_due");
    expect(before.attempts).toHaveLength(retryUsed ? 2 : 1);
    expect(before.attempts[0].operationId).toBe(initial.operationId);
    const exclude = { ...base, phase: "exclude", expectedRevision: before.revision, operationId: randomUUID(),
      evidenceType: "ended", observedAt: new Date(Date.now() - 30000).toISOString() };
    expect((await postLink(request(url, { ...exclude, evidenceType: "access_failed" }))).status).toBe(400);
    const results = await Promise.all([postLink(request(url, exclude)), postLink(request(url, exclude))]);
    expect((await Promise.all(results.map(async (response) => (await response.json()).status))).sort())
      .toEqual(["already_applied", "applied"]);
    const excluded = await linkRead(exclude.operationId);
    expect(excluded.status).toBe("excluded");
    expect(excluded.operation.operationId).toBe(exclude.operationId);
    expect(excluded.attempts).toEqual(before.attempts);
    expect(excluded.reviewHistory).toHaveLength(1);
    expect(excluded.revision).toBe(before.revision + 1);
    expect(await publicOptions()).toEqual(publicBefore);
    for (const phase of ["retry", "resolve"]) {
      expect((await postLink(request(url, { ...base, phase, expectedRevision: excluded.revision,
        productUrl: phase === "resolve" ? "https://example.com/product" : null,
        operationId: randomUUID(), observedAt: new Date(Date.now() - 25000).toISOString() }))).status).toBe(409);
    }
    expect((await postLink(request(url, { ...exclude, summary: "changed" }))).status).toBe(409);
    expect((await postLink(request(url, { ...exclude, operationId: randomUUID() }))).status).toBe(409);
    expect((await postLink(request(url, initial)).then((response) => response.json())).status).toBe("already_applied");
    const reinclude = { ...base, phase: "reinclude", expectedRevision: excluded.revision, operationId: randomUUID(),
      evidenceType: "active", observedAt: new Date(Date.now() - 20000).toISOString() };
    expect((await postLink(request(url, { ...reinclude, evidenceType: "access_failed" }))).status).toBe(400);
    const olderObservation = new Date(Date.parse(exclude.observedAt) - 1).toISOString();
    expect((await postLink(request(url, { ...reinclude, observedAt: olderObservation }))).status).toBe(409);
    const reusedId = await postLink(request(url, { ...reinclude, operationId: exclude.operationId }));
    expect(reusedId.status).toBe(409);
    expect(await reusedId.json()).toMatchObject({ code: "operation_mismatch" });
    expect((await postLink(request(url, reinclude))).status).toBe(200);
    expect((await postLink(request(url, reinclude)).then((response) => response.json())).status).toBe("already_applied");
    const restored = await linkRead(reinclude.operationId);
    expect(restored.status).toBe(before.status);
    expect(restored.operation.operationId).toBe(reinclude.operationId);
    expect(restored.attempts).toEqual(before.attempts);
    expect(restored.reviewHistory).toHaveLength(2);
    expect(restored.revision).toBe(before.revision + 2);
    expect(await publicOptions()).toEqual(publicBefore);
    const retry = { ...base, phase: "retry", expectedRevision: restored.revision, operationId: randomUUID(),
      observedAt: new Date(Date.now() - 10000).toISOString() };
    expect((await postLink(request(url, retry))).status).toBe(retryUsed ? 409 : 200);
    expect((await linkRead()).status).toBe("review_needed");
  });

  it("keeps the existing delete path for bonuses with observation receipts only", async () => {
    const isolatedListing = await prisma.albumStoreListing.create({ data: {
      albumId, originalStoreName: tag + "-deletable", status: "active", productUrl: "https://example.com/product",
      includesPerformanceVideo: true, isBonusOption: true,
    } });
    const isolatedBonus = await prisma.albumStoreBonus.create({
      data: { listingId: isolatedListing.id, originalBonusType: tag },
    });
    try {
      const isolatedParams = { params: Promise.resolve({ id: isolatedBonus.id }) };
      const observation = {
        listingId: isolatedListing.id, expectedRevision: 0, expectedListingRevision: 0, operationId: randomUUID(),
        action: "maintained", evidenceUrl: "https://example.com/evidence", summary: tag, observedAt: new Date().toISOString(),
      };
      expect((await POST(request(lifecycleUrl(), observation), isolatedParams)).status).toBe(200);
      expect((await deleteBonus(request(lifecycleUrl()), isolatedParams)).status).toBe(200);
      expect(await prisma.albumStoreBonus.findUnique({ where: { id: isolatedBonus.id } })).toBeNull();
    } finally {
      await prisma.albumStoreBonusLifecycleOperation.deleteMany({ where: { bonusId: isolatedBonus.id } });
      await prisma.albumStoreListing.delete({ where: { id: isolatedListing.id } });
    }
  });
});
