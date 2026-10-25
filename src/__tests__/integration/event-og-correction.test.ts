import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { preparePreview } from "@/lib/eventOg/service";
import { publishPreview } from "@/lib/eventOg/publication";
import { lookupPublication, listPublications } from "@/lib/eventOg/reader";
import { correctPublication, type CorrectionInput, type CorrectionDb } from "@/lib/eventOg/correction";
import { readCardEvents } from "@/lib/eventOg/source";
import { sha256 } from "@/lib/eventOg/render";
import { MemoryImageStorage } from "@/lib/imageUpload/memoryStorage";
import type { CardMode } from "@/lib/eventOg/content";

const PREFIX = "og03itest-"; const ORIGIN = "https://preview.test.invalid";
const storage = new MemoryImageStorage("og03itest", "https://images.test.invalid/og03itest");
const A = randomUUID(), B = randomUUID(), C = randomUUID(), LIVE = randomUUID(), OTHER = randomUUID();
let eventId: string; let otherId: string; let folder: string;
async function purge() {
  const ids = (await prisma.event.findMany({ where: { slug: { startsWith: PREFIX } }, select: { id: true } })).map((e) => e.id);
  await prisma.eventCardCorrection.deleteMany({ where: { publication: { eventId: { in: ids } } } });
  await prisma.eventCardPublication.deleteMany({ where: { eventId: { in: ids } } });
  await prisma.imageAsset.deleteMany({ where: { objectKey: { startsWith: "og03itest/event-cards/" } } });
  await prisma.event.deleteMany({ where: { id: { in: ids } } });
}
beforeAll(async () => {
  await purge(); folder = await mkdtemp(path.join(tmpdir(), "og03-integration-"));
  const make = (suffix: string) => prisma.event.create({ data: { slug: `${PREFIX}${suffix}`, originalName: `Correction QA ${suffix}`, originalLanguage: "en", type: "concert",
    startTime: new Date("2099-07-11T08:00:00Z"), date: new Date("2099-07-11T00:00:00Z"), originalVenue: "Original venue" } });
  eventId = String((await make("main")).id); otherId = String((await make("other")).id);
  const old = await preparePreview({ root: process.cwd(), output: path.join(folder, "old"), events: await readCardEvents(prisma, [eventId, otherId]) });
  const evidenceFile = path.join(folder, "approval.txt"); await writeFile(evidenceFile, "Synthetic dev-only correction verification approval.");
  async function publish(id: string, mode: CardMode, revision: string, packet: typeof old, directory: string) {
    const approvalFile = path.join(folder, `${revision}.json`);
    const outputs = Object.fromEntries(packet.renditions.filter((r) => r.eventId === id && r.mode === mode).map((r) => [r.locale, packet.files.find((f) => f.file === r.file)!.sha256]));
    await writeFile(approvalFile, JSON.stringify({ kind: "owner-reviewed-event-card", eventId: id, mode, previewId: packet.previewId, outputs,
      evidenceFile, evidenceSha256: sha256(await readFile(evidenceFile)) }));
    await publishPreview({ root: process.cwd(), eventId: id, mode, revision, manifestFile: path.join(folder, directory, "manifest.json"), approvalFile }, { storage, origin: ORIGIN });
  }
  await publish(eventId, "prediction", A, old, "old"); await publish(otherId, "prediction", OTHER, old, "old");
  await prisma.event.update({ where: { id: BigInt(eventId) }, data: { originalVenue: "Corrected venue" } });
  const fresh = await preparePreview({ root: process.cwd(), output: path.join(folder, "new"), events: await readCardEvents(prisma, [eventId]) });
  for (const revision of [B, C]) await publish(eventId, "prediction", revision, fresh, "new");
  await publish(eventId, "live", LIVE, fresh, "new");
}, 240_000);
beforeEach(async () => {
  await prisma.eventCardCorrection.deleteMany({ where: { publication: { eventId: BigInt(eventId) } } });
  await prisma.eventCardAnnotation.updateMany({ where: { publicationId: { in: [A, B, C, LIVE] } }, data: { status: "active", replacementId: null, privateReason: null, version: 0 } });
  await prisma.event.update({ where: { id: BigInt(eventId) }, data: { isDeleted: false, status: "scheduled" } });
});
afterAll(async () => {
  await purge();
  expect(await prisma.event.count({ where: { slug: { startsWith: PREFIX } } })).toBe(0);
  expect(await prisma.imageAsset.count({ where: { objectKey: { startsWith: "og03itest/event-cards/" } } })).toBe(0);
  if (folder) await rm(folder, { recursive: true, force: true });
});
const input = (revision = A, replacementId = B, expectedVersion = 0): CorrectionInput => ({ eventId, mode: "prediction", revision, replacementId,
  expectedVersion, operationId: randomUUID(), reason: "Operator-only venue correction" });
const lookup = (revision: string, locale = "ja") => lookupPublication({ eventId, mode: "prediction", revision, locale }, { origin: ORIGIN });
const correct = (request: CorrectionInput, db?: CorrectionDb) => correctPublication(request, { origin: ORIGIN, db });
type Callback = (tx: Prisma.TransactionClient) => Promise<unknown>;
type Options = Parameters<CorrectionDb["$transaction"]>[1];

describe("event-card correction through real dev DB and real PNG publications", () => {
  it("retains old bytes/metadata, exposes same-locale latest links and keeps private audit data operator-only", async () => {
    const before = await lookup(A); const newer = await lookup(B);
    const originalLocales = new Map(await Promise.all(["ja", "ko", "en"].map(async (locale) => [locale, await lookup(A, locale)] as const)));
    expect(before?.correction).toBeNull(); expect(newer?.image.sha256).not.toBe(before?.image.sha256);
    const bytes = [...storage.objects.entries()].map(([key, value]) => [key, value.sha256]);
    const request = input(); const result = await correct(request);
    expect(result.status).toBe("corrected"); expect(result.version).toBe(1);
    for (const locale of ["ja", "ko", "en"]) {
      const old = await lookup(A, locale); const fresh = await lookup(B, locale);
      expect(old?.correction?.replacementUrl).toBe(fresh?.shareUrl);
      expect(old?.image).toEqual(originalLocales.get(locale)?.image);
      expect(old?.content).toEqual(originalLocales.get(locale)?.content);
      expect(JSON.stringify(await listPublications(eventId))).toContain(request.reason);
      expect(JSON.stringify(old)).not.toContain(request.reason);
    }
    expect((await lookup(A))?.content).toEqual(before?.content);
    expect((await lookup(A))?.image).toEqual(before?.image);
    expect([...storage.objects.entries()].map(([key, value]) => [key, value.sha256])).toEqual(bytes);
    const history = await prisma.eventCardCorrection.findUnique({ where: { id: request.operationId } });
    expect(history).toMatchObject({ fromVersion: 0, toVersion: 1, publicationId: A, replacementId: B, privateReason: request.reason });
    expect(history?.createdAt).toBeInstanceOf(Date);
    expect((await correct(request)).status).toBe("reconciled");
    expect(await prisma.eventCardCorrection.count({ where: { publicationId: A } })).toBe(1);
    await prisma.event.update({ where: { id: BigInt(eventId) }, data: { status: "completed" } });
    expect((await lookup(A))?.correction?.replacementUrl).toBe(newer?.shareUrl);
    expect((await lookupPublication({ eventId, mode: "live", revision: LIVE, locale: "ja" }, { origin: ORIGIN }))?.correction).toBeNull();
  });

  it("rejects unpublished/cross-event/cross-mode/self/cyclic targets without changing the existing decision", async () => {
    await correct(input()); const before = await lookup(A);
    for (const target of [randomUUID(), OTHER, LIVE]) await expect(correct(input(B, target))).rejects.toMatchObject({ code: "invalid_correction" });
    await expect(correct(input(B, B))).rejects.toMatchObject({ code: "invalid_publication" });
    await expect(correct(input(B, A))).rejects.toMatchObject({ code: "invalid_correction" });
    expect(await lookup(C)).toBeTruthy();
    await prisma.eventCardRendition.update({ where: { publicationId_locale: { publicationId: C, locale: "ja" } }, data: { locale: "fr" } });
    try { await expect(correct(input(B, C))).rejects.toMatchObject({ code: "invalid_correction" }); }
    finally { await prisma.eventCardRendition.update({ where: { publicationId_locale: { publicationId: C, locale: "fr" } }, data: { locale: "ja" } }); }
    await prisma.event.update({ where: { id: BigInt(eventId) }, data: { isDeleted: true } });
    try { await expect(correct(input(B, C))).rejects.toMatchObject({ code: "invalid_correction" }); }
    finally { await prisma.event.update({ where: { id: BigInt(eventId) }, data: { isDeleted: false } }); }
    expect(await lookup(A)).toEqual(before); expect((await lookup(B))?.correction).toBeNull();
    expect(await prisma.eventCardCorrection.count({ where: { publicationId: { in: [A, B] } } })).toBe(1);
  });

  it("follows correction chains and never re-applies a superseded operation or exposes a suspended target", async () => {
    const first = input(); await correct(first); await correct(input(B, C));
    expect((await lookup(A))?.correction?.replacementUrl).toBe((await lookup(C))?.shareUrl);
    const second = input(A, C, 1); await correct(second);
    await expect(correct(first)).rejects.toMatchObject({ code: "correction_conflict" });
    await expect(correct({ ...second, reason: "different request" })).rejects.toMatchObject({ code: "correction_conflict" });
    const history = await prisma.eventCardCorrection.findMany({ where: { publicationId: A }, orderBy: { toVersion: "asc" } });
    expect(history.map((r) => [r.fromVersion, r.toVersion, r.replacementId])).toEqual([[0, 1, B], [1, 2, C]]);
    await prisma.eventCardAnnotation.update({ where: { publicationId: C }, data: { status: "suspended", version: { increment: 1 } } });
    expect((await lookup(A))?.correction).toEqual({ replacementUrl: null });
    await expect(correct(input(B, C, 1))).rejects.toMatchObject({ code: "invalid_correction" });
    await prisma.eventCardAnnotation.update({ where: { publicationId: A }, data: { status: "suspended", version: { increment: 1 } } });
    expect(await lookup(A)).toBeNull();
    await expect(correct(input(A, B, 3))).rejects.toMatchObject({ code: "invalid_correction" });
  });

  it("serializes inverse-edge races so exactly one correction wins without a cycle", async () => {
    expect((await lookup(A))?.correction).toBeNull(); expect((await lookup(B))?.correction).toBeNull();
    const results = await Promise.allSettled([correct(input(A, B)), correct(input(B, A))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const old = await lookup(A); const newer = await lookup(B);
    expect([old?.correction, newer?.correction].filter(Boolean)).toHaveLength(1);
    expect(await prisma.eventCardCorrection.count({ where: { publicationId: { in: [A, B] } } })).toBe(1);
  });

  it("reconciles duplicate concurrent operations and rejects competing stale versions", async () => {
    const request = input(); const duplicates = await Promise.all([correct(request), correct(request)]);
    expect(duplicates.map((r) => r.operationId)).toEqual([request.operationId, request.operationId]);
    expect(await prisma.eventCardCorrection.count({ where: { publicationId: A } })).toBe(1);
    await expect(correct(input(A, C))).rejects.toMatchObject({ code: "correction_conflict" });
    const decisions = await Promise.allSettled([correct(input(A, B, 1)), correct(input(A, C, 1))]);
    expect(decisions.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(decisions.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("rolls annotation/history back together on a pre-commit failure and safely retries", async () => {
    const tx = (async (callback: Callback, options: Options) => prisma.$transaction(async (real) => callback(new Proxy(real, {
      get(target, key) {
        if (key === "eventCardCorrection") return new Proxy(target.eventCardCorrection, { get(delegate, method) {
          if (method === "create") return async (...args: Parameters<typeof delegate.create>) => { await delegate.create(...args); throw new Error("injected precommit failure"); };
          return Reflect.get(delegate, method);
        } });
        return Reflect.get(target, key);
      },
    })), options)) as CorrectionDb["$transaction"];
    const request = input(); const before = await lookup(A); expect(before).toBeTruthy();
    await expect(correct(request, { $transaction: tx })).rejects.toMatchObject({ code: "not_saved" });
    expect(await lookup(A)).toEqual(before);
    expect(await prisma.eventCardCorrection.count({ where: { publicationId: A } })).toBe(0);
    expect((await correct(request)).status).toBe("corrected");
  });

  it("reconciles lost COMMIT replies and reports unknown outcomes until the same operation can be read", async () => {
    let committed = false;
    const lost = (async (callback: Callback, options: Options) => {
      const result = await prisma.$transaction(callback, options);
      if (!committed) { committed = true; throw new Error("lost COMMIT reply"); } return result;
    }) as unknown as CorrectionDb["$transaction"];
    const first = input(); expect((await correct(first, { $transaction: lost })).status).toBe("reconciled");
    expect((await lookup(A))?.correction).toBeTruthy();
    const unknown = input(A, C, 1); committed = false;
    const unavailable = (async (callback: Callback, options: Options) => {
      if (committed) throw new Error("reconciliation DB unavailable");
      await prisma.$transaction(callback, options); committed = true; throw new Error("lost COMMIT reply");
    }) as unknown as CorrectionDb["$transaction"];
    await expect(correct(unknown, { $transaction: unavailable })).rejects.toMatchObject({ code: "outcome_unknown" });
    expect((await lookup(A))?.correction?.replacementUrl).toBe((await lookup(C))?.shareUrl);
    expect((await correct(unknown)).status).toBe("reconciled");
    expect(await prisma.eventCardCorrection.count({ where: { id: unknown.operationId } })).toBe(1);
  });
});
