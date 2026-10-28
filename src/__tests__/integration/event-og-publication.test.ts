import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { preparePreview } from "@/lib/eventOg/service";
import { publishPreview, lookupPublication, type CardDb } from "@/lib/eventOg/publication";
import { readCardEvents } from "@/lib/eventOg/source";
import { sha256 } from "@/lib/eventOg/render";
import { MemoryImageStorage } from "@/lib/imageUpload/memoryStorage";
import { UploadError } from "@/lib/imageUpload/errors";
import type { PutImmutableInput } from "@/lib/imageUpload/storage";
import type { CardMode } from "@/lib/eventOg/content";

const PREFIX = "og02itest-";
const NAMESPACE = "og02itest";
const ORIGIN = "https://preview.test.invalid";
let eventId: string;
let folder: string;
let manifest: Awaited<ReturnType<typeof preparePreview>>;
const root = process.cwd();
const storage = () => new MemoryImageStorage(NAMESPACE, "https://images.test.invalid/og02itest");
const originalName = "カード発行テスト Day.1";
const originalVenue = "テスト会場";

async function purge() {
  const ids = (await prisma.event.findMany({ where: { slug: { startsWith: PREFIX } }, select: { id: true } })).map((e) => e.id);
  await prisma.eventCardWriteAttempt.deleteMany({ where: { namespace: NAMESPACE } });
  await prisma.eventCardPublication.deleteMany({ where: { namespace: NAMESPACE, eventId: { in: ids } } });
  await prisma.imageAsset.deleteMany({ where: { objectKey: { startsWith: `${NAMESPACE}/event-cards/` } } });
  await prisma.eventTranslation.deleteMany({ where: { eventId: { in: ids } } });
  await prisma.event.deleteMany({ where: { id: { in: ids } } });
}
beforeAll(async () => {
  await purge();
  const row = await prisma.event.create({ data: { slug: `${PREFIX}${Date.now()}`, originalName, originalLanguage: "ja",
    type: "concert", status: "scheduled", startTime: new Date("2099-07-11T08:00:00Z"), date: new Date("2099-07-11T00:00:00Z"), originalVenue } });
  eventId = String(row.id);
  folder = await mkdtemp(path.join(tmpdir(), "og02-itest-"));
  manifest = await preparePreview({ root, events: await readCardEvents(prisma, [eventId]), output: path.join(folder, "packet") });
  await writeFile(path.join(folder, "owner.txt"), "Synthetic fixture approval only; no production authorization.");
}, 120_000);
beforeEach(async () => {
  await prisma.event.update({ where: { id: BigInt(eventId) }, data: { originalName, originalVenue, isDeleted: false, status: "scheduled", date: new Date("2099-07-11T00:00:00Z") } });
});
afterAll(async () => {
  await purge();
  expect(await prisma.event.count({ where: { slug: { startsWith: PREFIX } } })).toBe(0);
  expect(await prisma.eventCardPublication.count({ where: { namespace: NAMESPACE } })).toBe(0);
  expect(await prisma.imageAsset.count({ where: { objectKey: { startsWith: `${NAMESPACE}/event-cards/` } } })).toBe(0);
  if (folder) await rm(folder, { recursive: true, force: true });
});

async function request(mode: CardMode = "prediction", revision = randomUUID(), packet: Pick<typeof manifest, "previewId" | "files" | "renditions"> = manifest, manifestFile = path.join(folder, "packet/manifest.json")) {
  const evidenceFile = path.join(folder, "owner.txt");
  const approvalFile = path.join(folder, `${revision}-${mode}-approval.json`);
  const outputs = Object.fromEntries(packet.renditions.filter((r) => r.mode === mode).map((r) => [r.locale, packet.files.find((f) => f.file === r.file)!.sha256]));
  await writeFile(approvalFile, JSON.stringify({ kind: "owner-reviewed-event-card", eventId, mode, previewId: packet.previewId, outputs,
    evidenceFile, evidenceSha256: sha256(await readFile(evidenceFile)) }));
  return { root, eventId, mode, revision, manifestFile, approvalFile };
}
const lookup = (revision: string, mode = "prediction", locale = "ja") => lookupPublication({ eventId, revision, mode, locale }, { origin: ORIGIN });
const dbWith = (transaction: CardDb["$transaction"], publication = prisma.eventCardPublication): CardDb => ({
  event: prisma.event, eventCardPublication: publication, eventCardWriteAttempt: prisma.eventCardWriteAttempt, $transaction: transaction,
});
type Callback = (tx: Prisma.TransactionClient) => Promise<unknown>;
type TxOptions = Parameters<CardDb["$transaction"]>[1];

describe("event-card lifecycle: real dev DB and immutable memory storage", () => {
  it("publishes one complete locale group, reconciles retries and exposes only frozen public content", async () => {
    const mem = storage();
    const input = await request();
    const first = await publishPreview(input, { storage: mem, origin: ORIGIN });
    expect(first.status).toBe("created");
    expect(Object.keys(first.urls).sort()).toEqual(["en", "ja", "ko"]);
    expect(mem.objects.size).toBe(3);
    for (const locale of ["ja", "ko", "en"]) {
      const card = await lookup(input.revision, "prediction", locale);
      expect(card?.shareUrl).toBe(first.urls[locale]);
      expect(card?.content?.officialEventTitle).toBe(originalName);
      expect(card?.image).toMatchObject({ width: 1200, height: 630, mimeType: "image/png" });
      expect([...mem.objects.values()].some((o) => o.sha256 === card?.image?.sha256)).toBe(true);
      expect((await readFile(input.approvalFile, "utf8"))).toContain("evidenceFile");
      expect(JSON.stringify(card)).not.toContain("evidenceFile");
    }
    expect((await publishPreview(input, { storage: mem, origin: ORIGIN })).publicationId).toBe(first.publicationId);
    expect(await prisma.eventCardRendition.count({ where: { publicationId: input.revision } })).toBe(3);
    // Positive control for the other mode, then a mismatched tuple stays absent.
    const live = await request("live");
    await publishPreview(live, { storage: mem, origin: ORIGIN });
    expect(await lookup(live.revision, "live")).toBeTruthy();
    expect(await lookup(input.revision, "live")).toBeNull();
  });

  it("rejects stale facts while historical content and current canonical slug stay independent", async () => {
    const mem = storage(); const first = await request();
    await publishPreview(first, { storage: mem, origin: ORIGIN });
    const before = await lookup(first.revision);
    await prisma.event.update({ where: { id: BigInt(eventId) }, data: { originalName: "Changed title", originalVenue: "Changed venue", date: new Date("2099-07-12T00:00:00Z"), slug: `${PREFIX}changed-${Date.now()}` } });
    const changed = await lookup(first.revision);
    expect(changed?.content).toEqual(before?.content);
    expect(changed?.image).toEqual(before?.image);
    expect(changed?.slug).not.toBe(before?.slug);
    const stale = await request();
    await expect(publishPreview(stale, { storage: mem, origin: ORIGIN })).rejects.toMatchObject({ code: "preview_stale" });
    expect(mem.objects.size).toBe(3);
    expect(await lookup(stale.revision)).toBeNull();
    // Same committed request is a lookup, even after source changes.
    expect((await publishPreview(first, { storage: mem, origin: ORIGIN })).status).toBe("reconciled");
    await prisma.event.update({ where: { id: BigInt(eventId) }, data: { originalName, originalVenue, date: new Date("2099-07-11T00:00:00Z"), status: "completed", setlistRevision: { increment: 1 } } });
    expect((await publishPreview(await request(), { storage: mem, origin: ORIGIN })).status).toBe("created");
  });

  it("never exposes partial locales on second/third upload failure and reuses the retained objects on retry", async () => {
    const baseline = await request(); await publishPreview(baseline, { storage: storage(), origin: ORIGIN });
    expect(await lookup(baseline.revision)).toBeTruthy();
    class FailingStorage extends MemoryImageStorage {
      writes = 0;
      failAt: number | null = null;
      async putImmutable(input: PutImmutableInput) {
        if (++this.writes === this.failAt) throw new UploadError("storage_failed", "injected upload failure");
        return super.putImmutable(input);
      }
    }
    for (const failAt of [2, 3]) {
      const mem = new FailingStorage(NAMESPACE, "https://images.test.invalid/og02itest"); mem.failAt = failAt;
      const input = await request();
      await expect(publishPreview(input, { storage: mem, origin: ORIGIN })).rejects.toMatchObject({ code: "storage_failed" });
      expect(mem.objects.size).toBe(failAt - 1);
      for (const locale of ["ja", "ko", "en"]) expect(await lookup(input.revision, "prediction", locale)).toBeNull();
      expect(await lookup(baseline.revision)).toBeTruthy();
      mem.failAt = null;
      expect((await publishPreview(input, { storage: mem, origin: ORIGIN })).status).toBe("created");
      expect(mem.objects.size).toBe(3);
    }
  });

  it("requires fresh approval if source facts change while the reviewed PNGs are being uploaded", async () => {
    const baseline = await request(); await publishPreview(baseline, { storage: storage(), origin: ORIGIN });
    expect(await lookup(baseline.revision)).toBeTruthy();
    const mem = storage(); const input = await request(); let writes = 0;
    const editing = { keyPrefix: mem.keyPrefix, publicUrlFor: (key: string) => mem.publicUrlFor(key),
      async putImmutable(image: PutImmutableInput) {
        const result = await mem.putImmutable(image);
        if (++writes === 3) await prisma.event.update({ where: { id: BigInt(eventId) }, data: { originalVenue: "Edited during uploads" } });
        return result;
      } };
    await expect(publishPreview(input, { storage: editing, origin: ORIGIN })).rejects.toMatchObject({ code: "preview_stale" });
    expect(mem.objects.size).toBe(3); expect(await lookup(input.revision)).toBeNull();
  });

  it("rolls all metadata back on pre-commit failure without deleting approved unassigned objects", async () => {
    const baseline = await request(); await publishPreview(baseline, { storage: storage(), origin: ORIGIN });
    expect(await lookup(baseline.revision)).toBeTruthy();
    const tx = (async (callback: Callback, options: TxOptions) => prisma.$transaction(async (real) => callback(new Proxy(real, {
      get(target, key) {
        if (key === "eventCardPublication") return new Proxy(target.eventCardPublication, { get(delegate, method) {
          if (method === "create") return async (...args: Parameters<typeof delegate.create>) => { await delegate.create(...args); throw new Error("statement failed before callback completion"); };
          return Reflect.get(delegate, method);
        } });
        return Reflect.get(target, key);
      },
    })), options)) as CardDb["$transaction"];
    const input = await request(); const mem = storage();
    await expect(publishPreview(input, { db: dbWith(tx), storage: mem, origin: ORIGIN })).rejects.toMatchObject({ code: "not_saved" });
    expect(mem.objects.size).toBe(3);
    expect(await lookup(input.revision)).toBeNull();
    expect(await prisma.eventCardRendition.count({ where: { publicationId: input.revision } })).toBe(0);
    expect((await publishPreview(input, { storage: mem, origin: ORIGIN })).status).toBe("created");
  });

  it("reconciles a lost COMMIT reply and reports an unreadable outcome as unknown until a same-ID retry", async () => {
    let committed = false;
    const tx = (async (callback: Callback, options: TxOptions) => {
      await prisma.$transaction(callback, options); committed = true; throw new Error("lost COMMIT reply");
    }) as unknown as CardDb["$transaction"];
    const first = await request(); const mem = storage();
    expect((await publishPreview(first, { db: dbWith(tx), storage: mem, origin: ORIGIN })).status).toBe("reconciled");
    expect(await lookup(first.revision)).toBeTruthy();
    committed = false;
    const unavailable = new Proxy(prisma.eventCardPublication, { get(target, method) {
      if (method === "findUnique") return (...args: Parameters<typeof target.findUnique>) => {
        if (committed) throw new Error("reconciliation DB unavailable");
        return target.findUnique(...args);
      };
      return Reflect.get(target, method);
    } });
    const unknown = await request();
    await expect(publishPreview(unknown, { db: dbWith(tx, unavailable), storage: mem, origin: ORIGIN })).rejects.toMatchObject({ code: "outcome_unknown" });
    expect(await lookup(unknown.revision)).toBeTruthy();
    const retry = await publishPreview(unknown, { storage: mem, origin: ORIGIN });
    expect(retry.status).toBe("reconciled");
    expect(await prisma.eventCardPublication.count({ where: { id: unknown.revision } })).toBe(1);
  });

  it("makes concurrent same-ID submissions idempotent and rejects reuse for a different tuple", async () => {
    const input = await request(); const mem = storage();
    const results = await Promise.all([publishPreview(input, { storage: mem, origin: ORIGIN }), publishPreview(input, { storage: mem, origin: ORIGIN })]);
    expect(results.map((r) => r.publicationId)).toEqual([input.revision, input.revision]);
    expect(await prisma.eventCardPublication.count({ where: { id: input.revision } })).toBe(1);
    const conflict = await request("live", input.revision);
    await expect(publishPreview(conflict, { storage: mem, origin: ORIGIN })).rejects.toMatchObject({ code: "publication_conflict" });
    expect(await lookup(input.revision)).toBeTruthy();
    expect(await lookup(input.revision, "live")).toBeNull();
  });

  it("detects tampered outputs and self-rehashed template changes before publication", async () => {
    const baseline = await request(); const mem = storage(); await publishPreview(baseline, { storage: mem, origin: ORIGIN });
    expect(await lookup(baseline.revision)).toBeTruthy();
    const input = await request();
    const file = path.join(folder, `packet/${eventId}-ja-prediction.png`); const bytes = await readFile(file);
    try {
      await writeFile(file, "tampered image");
      await expect(publishPreview(input, { storage: mem, origin: ORIGIN })).rejects.toThrow(/출력 해시/);
    } finally { await writeFile(file, bytes); }
    const { previewId: _id, ...payload } = manifest;
    expect(_id).toBe(manifest.previewId);
    const forged = { ...payload, template: { ...payload.template, id: "forged-template" } };
    const packet = { ...forged, previewId: sha256(JSON.stringify(forged)) };
    const manifestFile = path.join(folder, "packet/forged.json"); await writeFile(manifestFile, JSON.stringify(packet));
    const forgedRequest = await request("prediction", randomUUID(), packet, manifestFile);
    await expect(publishPreview(forgedRequest, { storage: mem, origin: ORIGIN })).rejects.toThrow(/재현 결과/);
    expect(await lookup(forgedRequest.revision)).toBeNull();
    expect(mem.objects.size).toBe(3);
  });

  it("does not expose malformed tuples or a deleted event through published lookup", async () => {
    const input = await request(); const mem = storage(); await publishPreview(input, { storage: mem, origin: ORIGIN });
    expect(await lookup(input.revision)).toBeTruthy();
    for (const [mode, locale, revision] of [["wrong", "ja", input.revision], ["prediction", "fr", input.revision], ["prediction", "ja", "../unsafe"]]) {
      expect(await lookup(revision, mode, locale)).toBeNull();
    }
    await prisma.event.update({ where: { id: BigInt(eventId) }, data: { isDeleted: true } });
    expect(await lookup(input.revision)).toBeNull();
    await prisma.event.update({ where: { id: BigInt(eventId) }, data: { isDeleted: false } });
    expect(await lookup(input.revision)).toBeTruthy();
    for (const status of ["corrected", "suspended"] as const) {
      await prisma.eventCardAnnotation.update({ where: { publicationId: input.revision }, data: { status } });
      if (status === "corrected") expect((await lookup(input.revision))?.correction).toEqual({ replacementUrl: null });
      else expect(await lookup(input.revision)).toMatchObject({ suspended: true, content: null, image: null, correction: null });
      // A committed retry returns identity without resurrecting removed bytes.
      mem.objects.clear();
      expect((await publishPreview(input, { storage: mem, origin: ORIGIN })).status).toBe("reconciled");
      expect(mem.objects.size).toBe(0);
      await prisma.eventCardAnnotation.update({ where: { publicationId: input.revision }, data: { status: "active" } });
      expect(await lookup(input.revision)).toBeTruthy();
    }
  });
});
