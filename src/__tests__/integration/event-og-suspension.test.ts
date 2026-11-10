import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { prisma } from "@/lib/prisma";
import { preparePreview } from "@/lib/eventOg/service";
import { publishPreview } from "@/lib/eventOg/publication";
import { lookupPublication, listPublications } from "@/lib/eventOg/reader";
import { suspendPublication, type SuspensionDb, type SuspensionInput } from "@/lib/eventOg/suspension";
import { correctPublication } from "@/lib/eventOg/correction";
import { readCardEvents } from "@/lib/eventOg/source";
import { sha256 } from "@/lib/eventOg/render";
import { MemoryImageStorage } from "@/lib/imageUpload/memoryStorage";
import { MemoryCardOrigin } from "@/test/eventOgDelivery";
import type { CardMode } from "@/lib/eventOg/content";
import type { ImageStorage, PutImmutableInput } from "@/lib/imageUpload/storage";

const PREFIX = "og04itest-", NAMESPACE = "og04itest", ORIGIN = "https://preview.test.invalid";
const A = randomUUID(), B = randomUUID(), LIVE = randomUUID(), OTHER = randomUUID();
const storage = new MemoryImageStorage(NAMESPACE); let resource: MemoryCardOrigin;
let eventId: string, otherId: string, folder: string;
let packet: Awaited<ReturnType<typeof preparePreview>>;
let baseline: Map<string, (typeof storage.objects extends Map<string, infer V> ? V : never)>;
async function purge() {
  const ids = (await prisma.event.findMany({ where: { slug: { startsWith: PREFIX } }, select: { id: true } })).map((e) => e.id);
  await prisma.eventCardSuspensionAttempt.deleteMany({ where: { suspension: { publication: { eventId: { in: ids } } } } });
  await prisma.eventCardSuspension.deleteMany({ where: { publication: { eventId: { in: ids } } } });
  await prisma.eventCardCorrection.deleteMany({ where: { publication: { eventId: { in: ids } } } });
  await prisma.eventCardWriteAttempt.deleteMany({ where: { namespace: NAMESPACE } });
  await prisma.eventCardPublication.deleteMany({ where: { eventId: { in: ids } } });
  await prisma.imageAsset.deleteMany({ where: { objectKey: { startsWith: `${NAMESPACE}/event-cards/` } } });
  await prisma.event.deleteMany({ where: { id: { in: ids } } });
}
async function publication(revision: string, mode: CardMode = "prediction", id = eventId) {
  const evidenceFile = path.join(folder, "approval.txt"), approvalFile = path.join(folder, `${revision}.json`);
  const outputs = Object.fromEntries(packet.renditions.filter((r) => r.eventId === id && r.mode === mode).map((r) => [r.locale, packet.files.find((f) => f.file === r.file)!.sha256]));
  await writeFile(approvalFile, JSON.stringify({ kind: "owner-reviewed-event-card", eventId: id, mode, previewId: packet.previewId, outputs,
    evidenceFile, evidenceSha256: sha256(await readFile(evidenceFile)) }));
  return { root: process.cwd(), eventId: id, mode, revision, manifestFile: path.join(folder, "packet/manifest.json"), approvalFile };
}
beforeAll(async () => {
  await purge(); folder = await mkdtemp(path.join(tmpdir(), "og04-integration-"));
  const make = (suffix: string) => prisma.event.create({ data: { slug: `${PREFIX}${suffix}`, originalName: `Suspension QA ${suffix}`, originalLanguage: "en", type: "concert",
    date: new Date("2099-07-11T00:00:00Z"), startTime: new Date("2099-07-11T08:00:00Z"), originalVenue: "QA original venue" } });
  eventId = String((await make("main")).id); otherId = String((await make("other")).id);
  packet = await preparePreview({ root: process.cwd(), output: path.join(folder, "packet"), events: await readCardEvents(prisma, [eventId, otherId]) });
  await writeFile(path.join(folder, "approval.txt"), "Synthetic dev-only suspension verification approval.");
  for (const [id, mode, event] of [[A, "prediction", eventId], [B, "prediction", eventId], [LIVE, "live", eventId], [OTHER, "prediction", otherId]] as const) {
    await publishPreview(await publication(id, mode, event), { storage, origin: ORIGIN });
  }
  baseline = new Map(storage.objects);
}, 240_000);
beforeEach(async () => {
  await prisma.eventCardSuspensionAttempt.deleteMany({ where: { suspension: { publication: { eventId: BigInt(eventId) } } } });
  await prisma.eventCardSuspension.deleteMany({ where: { publication: { eventId: BigInt(eventId) } } });
  await prisma.eventCardCorrection.deleteMany({ where: { publication: { eventId: BigInt(eventId) } } });
  await prisma.eventCardAnnotation.updateMany({ where: { publicationId: { in: [A, B, LIVE] } }, data: { status: "active", replacementId: null, privateReason: null, version: 0 } });
  await prisma.event.update({ where: { id: BigInt(eventId) }, data: { isDeleted: false, status: "scheduled" } });
  storage.objects.clear(); for (const [key, value] of baseline) storage.objects.set(key, value);
  resource = new MemoryCardOrigin(storage); await resource.warm([...storage.objects.keys()].map((key) => resource.base + "/" + key));
});
afterAll(async () => {
  await purge(); expect(await prisma.event.count({ where: { slug: { startsWith: PREFIX } } })).toBe(0);
  expect(await prisma.eventCardWriteAttempt.count({ where: { namespace: NAMESPACE } })).toBe(0);
  expect(await prisma.imageAsset.count({ where: { objectKey: { startsWith: `${NAMESPACE}/event-cards/` } } })).toBe(0);
  if (folder) await rm(folder, { recursive: true, force: true });
});
const input = (revision = A, expectedVersion = 0): SuspensionInput => ({ eventId, mode: "prediction", revision, expectedVersion,
  operationId: randomUUID(), reason: "Operator-only serious-card-issue reason" });
const lookup = (revision = A, locale = "ja") => lookupPublication({ eventId, mode: "prediction", revision, locale }, { origin: ORIGIN });
const suspend = (request: SuspensionInput, db?: SuspensionDb) => suspendPublication(request, { origin: ORIGIN, delivery: resource.delivery(), db });
const snapshot = (id = A) => prisma.eventCardPublication.findUnique({ where: { id }, include: { renditions: { orderBy: { locale: "asc" }, include: { asset: true } } } });
type Callback = (tx: Prisma.TransactionClient) => Promise<unknown>;
type Options = Parameters<SuspensionDb["$transaction"]>[1];
const dbWith = (tx: SuspensionDb["$transaction"]): SuspensionDb => ({ $transaction: tx,
  eventCardSuspensionAttempt: prisma.eventCardSuspensionAttempt, eventCardWriteAttempt: prisma.eventCardWriteAttempt });

describe("explicit public suspension through actual dev DB, PNGs and independent origin/cache resources", () => {
  it("neutralizes all locales, stops only the three owned images, retains private history and never re-PUTs a suspended publication", async () => {
    const correctionId = randomUUID();
    await correctPublication({ eventId, mode: "prediction", revision: A, replacementId: B, expectedVersion: 0,
      operationId: correctionId, reason: "Private correction retained before suspension" }, { origin: ORIGIN });
    const before = await lookup(); expect(before?.suspended).toBe(false); expect(before?.image?.url).toBeTruthy();
    expect(before?.correction?.replacementUrl).toBe((await lookup(B))?.shareUrl);
    const frozen = await snapshot(); const other = await snapshot(OTHER), live = await snapshot(LIVE), newer = await snapshot(B);
    for (const saved of [frozen, other, live, newer]) expect(saved?.renditions).toHaveLength(3);
    expect(resource.edge.size).toBe(36); const request = input(A, 1); const result = await suspend(request);
    expect(result.status).toBe("suspended"); expect(result.report.public.every((r) => r.blocked)).toBe(true);
    const operator = await listPublications(eventId); expect(JSON.stringify(operator)).toContain(request.reason);
    for (const locale of ["ja", "ko", "en"]) {
      const publicCard = await lookup(A, locale);
      expect(publicCard).toMatchObject({ suspended: true, content: null, image: null, correction: null });
      expect(JSON.stringify(publicCard)).not.toContain(before?.image?.url);
      expect(JSON.stringify(publicCard)).not.toContain(request.reason);
    }
    expect(await snapshot()).toEqual(frozen); expect(await snapshot(OTHER)).toEqual(other);
    expect(await snapshot(LIVE)).toEqual(live); expect(await snapshot(B)).toEqual(newer);
    expect(storage.objects.size).toBe(9); expect((await lookup(B))?.suspended).toBe(false);
    const saved = await prisma.eventCardSuspension.findUnique({ where: { id: request.operationId } });
    expect(saved).toMatchObject({ publicationId: A, previousStatus: "corrected", previousReplacementId: B, fromVersion: 1, toVersion: 2, privateReason: request.reason });
    expect(await prisma.eventCardCorrection.findUnique({ where: { id: correctionId } })).toMatchObject({ privateReason: "Private correction retained before suspension" });
    expect(saved?.createdAt).toBeInstanceOf(Date); expect((await suspend(request)).status).toBe("suspended");
    expect(await prisma.eventCardSuspension.count({ where: { publicationId: A } })).toBe(1);
    const puts = storage.puts.length; expect(puts).toBeGreaterThan(0);
    expect((await publishPreview(await publication(A), { storage, origin: ORIGIN })).status).toBe("reconciled");
    expect(storage.puts.length).toBe(puts); expect(storage.objects.size).toBe(9);
    await prisma.event.update({ where: { id: BigInt(eventId) }, data: { status: "completed" } });
    expect((await lookup())?.suspended).toBe(true); expect((await lookup(B))?.suspended).toBe(false);
  });
  it("applies the safe notice immediately, reports origin/cache partial failures and appends successful retry evidence", async () => {
    const before = await lookup(); const key = `${NAMESPACE}/event-cards/${eventId}/prediction/${A}/ja.png`;
    expect(storage.objects.has(key)).toBe(true); resource.deniedKeys.add(key); resource.purgeFails = true;
    const request = input(); const first = await suspend(request);
    expect(first.status).toBe("partial"); expect(first.safeNoticeApplied).toBe(true);
    expect(first.report.origins.filter((r) => r.status === "failed")).toHaveLength(1);
    expect(first.report.cache.status).toBe("failed"); expect(first.report.public.some((r) => r.status === 200)).toBe(true);
    expect((await lookup())?.image).toBeNull(); expect(before?.image).toBeTruthy();
    resource.deniedKeys.clear(); resource.purgeFails = false; expect((await suspend(request)).status).toBe("suspended");
    const attempts = await prisma.eventCardSuspensionAttempt.findMany({ where: { suspensionId: request.operationId }, orderBy: { startedAt: "asc" } });
    expect(attempts).toHaveLength(2); expect(attempts[0].report).toMatchObject({ complete: false }); expect(attempts[1].report).toMatchObject({ complete: true });
    expect(storage.objects.has(key)).toBe(false);
  });
  it("refuses false completion when a late PUT recreates a key after verification and settles before the final writer check", async () => {
    const writer = await prisma.eventCardWriteAttempt.create({ data: { publicationId: A, eventId: BigInt(eventId), namespace: NAMESPACE } });
    const key = `${NAMESPACE}/event-cards/${eventId}/prediction/${A}/ja.png`;
    const original = storage.objects.get(key)!; expect(original).toBeTruthy();
    const request = input();
    const first = await suspendPublication(request, { origin: ORIGIN, delivery: { async revoke(target) {
      const report = await resource.delivery().revoke(target);
      expect(report.public.every((r) => r.blocked)).toBe(true);
      await storage.putImmutable({ key, bytes: original.bytes, sha256: original.sha256, contentType: original.contentType });
      await prisma.eventCardWriteAttempt.update({ where: { id: writer.id }, data: { settledAt: new Date() } });
      return report;
    } } });
    expect(first.status).toBe("partial"); expect(first.report.unsettledWriters).toContain(writer.id);
    expect(first.report.public.every((r) => r.blocked)).toBe(true);
    expect(first.report.writersAtEnd).toEqual([]); expect(storage.objects.has(key)).toBe(true);
    expect((await suspend(request)).status).toBe("suspended");
    expect(storage.objects.has(key)).toBe(false);
  });
  it("rejects missing/mismatched targets, stale competing decisions and corrections of a suspended source/target", async () => {
    expect((await lookup())?.suspended).toBe(false);
    for (const request of [input(randomUUID()), { ...input(), eventId: otherId }, { ...input(), mode: "live" as const }]) {
      await expect(suspend(request)).rejects.toMatchObject({ code: "invalid_publication" });
    }
    const first = input(); const second = input(); const outcomes = await Promise.allSettled([suspend(first), suspend(second)]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1); expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(1);
    const winner = outcomes[0].status === "fulfilled" ? first : second;
    await expect(suspend({ ...winner, reason: "changed private request" })).rejects.toMatchObject({ code: "suspension_conflict" });
    await expect(suspend(input(A, 1))).rejects.toMatchObject({ code: "suspension_conflict" });
    const correction = (revision: string, replacementId: string) => correctPublication({ eventId, mode: "prediction", revision, replacementId,
      expectedVersion: 0, operationId: randomUUID(), reason: "private correction" }, { origin: ORIGIN });
    await expect(correction(A, B)).rejects.toMatchObject({ code: "invalid_correction" });
    await expect(correction(B, A)).rejects.toMatchObject({ code: "invalid_correction" });
    expect((await lookup())?.suspended).toBe(true); expect((await lookup(B))?.suspended).toBe(false);
  });
  it("keeps an uncertain failed PUT fenced even after a successful same-revision publication retry", async () => {
    const revision = randomUUID(); const request = await publication(revision); let writes = 0;
    const failing: ImageStorage = { keyPrefix: NAMESPACE, publicUrlFor: (key) => storage.publicUrlFor(key),
      async putImmutable(image) { const result = await storage.putImmutable(image); if (++writes === 2) throw new Error("lost PUT reply"); return result; } };
    await expect(publishPreview(request, { storage: failing, origin: ORIGIN })).rejects.toMatchObject({ code: "not_saved" });
    expect(await lookup(revision)).toBeNull();
    expect([...storage.objects.keys()].filter((key) => key.includes(revision))).toHaveLength(2);
    expect((await publishPreview(request, { storage, origin: ORIGIN })).status).toBe("created");
    expect((await lookup(revision))?.image).toBeTruthy();
    const uncertain = await prisma.eventCardWriteAttempt.findMany({ where: { publicationId: revision, settledAt: null } });
    expect(uncertain).toHaveLength(1); const stop = input(revision);
    for (let retry = 0; retry < 2; retry++) {
      const result = await suspend(stop); expect(result.status).toBe("partial");
      expect(result.report.unsettledWriters).toEqual([uncertain[0].id]);
      expect(result.report.public.every((r) => r.blocked)).toBe(true);
      expect((await lookup(revision))?.image).toBeNull();
    }
    expect([...storage.objects.keys()].filter((key) => key.includes(revision))).toHaveLength(0);
    expect(storage.objects.size).toBe(12);
  }, 180_000);
  it("serializes correction/suspension, preserves the earlier correction decision and can stop a deleted event's owned images", async () => {
    const correction = { eventId, mode: "prediction" as const, revision: A, replacementId: B, expectedVersion: 0, operationId: randomUUID(), reason: "original private correction" };
    const initial = input(); const outcomes = await Promise.allSettled([correctPublication(correction, { origin: ORIGIN }), suspend(initial)]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(1);
    if (!(await lookup())?.suspended) {
      expect((await lookup())?.correction).toBeTruthy();
      const result = await suspend(input(A, 1)); expect(result.status).toBe("suspended");
      expect(await prisma.eventCardCorrection.findUnique({ where: { id: correction.operationId } })).toMatchObject({ privateReason: correction.reason });
    }
    expect((await lookup())?.suspended).toBe(true);
    expect((await lookup())?.correction).toBeNull();
    expect((await lookup(B))?.suspended).toBe(false);
    await prisma.event.update({ where: { id: BigInt(eventId) }, data: { isDeleted: true } });
    expect(await lookup(B)).toBeNull();
    expect((await suspend(input(B))).status).toBe("suspended");
    await prisma.event.update({ where: { id: BigInt(eventId) }, data: { isDeleted: false } });
    expect((await lookup(B))?.suspended).toBe(true);
  });
  it("rolls back failed decisions and never deletes origin bytes before an uncertain COMMIT has been reconciled", async () => {
    const failed = (async (callback: Callback, options: Options) => prisma.$transaction(async (tx) => callback(new Proxy(tx, { get(target, key) {
      if (key === "eventCardSuspension") return new Proxy(target.eventCardSuspension, { get(delegate, method) {
        if (method === "create") return async (...args: Parameters<typeof delegate.create>) => { await delegate.create(...args); throw new Error("precommit failure"); };
        return Reflect.get(delegate, method);
      } }); return Reflect.get(target, key);
    } })), options)) as SuspensionDb["$transaction"];
    const before = await lookup(); expect(before?.image).toBeTruthy(); const request = input();
    await expect(suspend(request, dbWith(failed))).rejects.toMatchObject({ code: "not_saved" });
    expect(await lookup()).toEqual(before); expect(storage.objects.size).toBe(12);
    let committed = false;
    const unknown = (async (callback: Callback, options: Options) => {
      if (committed) throw new Error("reconciliation unavailable");
      await prisma.$transaction(callback, options); committed = true; throw new Error("lost COMMIT reply");
    }) as unknown as SuspensionDb["$transaction"];
    await expect(suspend(request, dbWith(unknown))).rejects.toMatchObject({ code: "outcome_unknown" });
    expect((await lookup())?.suspended).toBe(true); expect(storage.objects.size).toBe(12);
    expect((await suspend(request)).status).toBe("suspended"); expect(storage.objects.size).toBe(9);
    expect(await prisma.eventCardSuspension.count({ where: { publicationId: A } })).toBe(1);
  });
  it("preserves unfinished delivery history when its result reply is lost and safely verifies the same operation again", async () => {
    const db: SuspensionDb = { $transaction: prisma.$transaction.bind(prisma), eventCardWriteAttempt: prisma.eventCardWriteAttempt,
      eventCardSuspensionAttempt: new Proxy(prisma.eventCardSuspensionAttempt, { get(target, key) {
        if (key === "updateMany") return async () => { throw new Error("lost attempt persistence connection"); };
        return Reflect.get(target, key);
      } }) };
    const request = input(); expect(storage.objects.size).toBe(12);
    await expect(suspend(request, db)).rejects.toMatchObject({ code: "outcome_unknown" });
    expect((await lookup())?.suspended).toBe(true); expect(storage.objects.size).toBe(9);
    expect((await suspend(request)).status).toBe("suspended");
    const attempts = await prisma.eventCardSuspensionAttempt.findMany({ where: { suspensionId: request.operationId }, orderBy: { startedAt: "asc" } });
    expect(attempts).toHaveLength(2); expect(attempts[0].completedAt).toBeNull(); expect(attempts[1].report).toMatchObject({ complete: true });
  });
  it("fences a late duplicate publisher so suspension cannot be followed by a retry that recreates the old keys", async () => {
    // An operator CLI has its own process/pool. Both shared app connections
    // are occupied by the two publishers; do not mistake pool acquisition
    // failure for a test of the database's advisory-lock wait.
    const operatorPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
    const operator = new PrismaClient({ adapter: new PrismaPg(operatorPool) });
    const revision = randomUUID(); const request = await publication(revision);
    let release!: () => void; let reached!: () => void; let writes = 0;
    const hold = new Promise<void>((resolve) => { release = resolve; }); const barrier = new Promise<void>((resolve) => { reached = resolve; });
    const gated: ImageStorage = { keyPrefix: NAMESPACE, publicUrlFor: (key) => storage.publicUrlFor(key),
      async putImmutable(image: PutImmutableInput) { if (++writes === 3) { reached(); await hold; } return storage.putImmutable(image); } };
    const first = publishPreview(request, { storage: gated, origin: ORIGIN });
    await barrier;
    const second = publishPreview(request, { storage: gated, origin: ORIGIN });
    const deadline = Date.now() + 30000;
    try {
      while (await prisma.eventCardWriteAttempt.count({ where: { publicationId: revision } }) < 2) {
        if (Date.now() > deadline) throw new Error("Duplicate publisher did not reach durable writer fence");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const suspension = input(revision);
      const stopped = suspendPublication(suspension, { db: operator, origin: ORIGIN, delivery: resource.delivery() });
      void stopped.catch(() => {}); // Attach immediately while the lock is held.
      // Real lock wait longer than the former30s decision timeout.
      await new Promise((resolve) => setTimeout(resolve, 31000)); release();
      const published = await Promise.all([first, second]);
      expect(published.map((p) => p.status).sort()).toEqual(["created", "reconciled"]);
      await stopped; expect((await suspend(suspension)).status).toBe("suspended");
      expect(writes).toBe(3); expect((await lookup(revision))?.suspended).toBe(true);
      expect([...storage.objects.keys()].filter((key) => key.includes(revision))).toHaveLength(0);
      expect(storage.objects.size).toBe(12);
    } finally { release(); await Promise.allSettled([first, second]); await operator.$disconnect(); await operatorPool.end(); }
  }, 180_000);
});
