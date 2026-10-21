import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import sharp from "sharp";
import { randomUUID } from "node:crypto";

// Shared admin image upload (redesign ticket 08) against the DEV database:
// the transaction that inserts ImageAsset and compare-and-sets the target,
// conflict rollback, known pre-commit failure, a commit whose reply is
// lost, bounded resubmission, concurrent saves, and the HTTP boundary the
// 09/10/11 routes delegate to.
//
// Storage is MemoryImageStorage (same write-once semantics as R2). Nothing
// here talks to R2 — real-transport evidence is r2-smoke.test.ts, gated.
//
// Fixtures: one series + one event (through the admin handlers, like
// image-asset-schema.test.ts), one album, and ImageAsset rows whose URLs
// start with this run's memory-storage base. afterAll clears the logo
// references (Restrict FKs) and hard-deletes all of it.

vi.mock("@/lib/admin-auth", () => ({ verifyAdminAPI: vi.fn(async () => null) }));
vi.mock("@/lib/dataCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dataCache")>()),
  cachedQuery:
    <A extends unknown[], R>(_name: string, fn: (...args: A) => Promise<R>) =>
    (...args: A) =>
      fn(...args),
  revalidateEventData: vi.fn(),
  revalidatePublicData: vi.fn(),
  revalidateEventImpressions: vi.fn(),
}));

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { revalidatePublicData } from "@/lib/dataCache";
import { POST as SERIES_POST } from "@/app/api/admin/event-series/route";
import { POST as EVENT_POST } from "@/app/api/admin/events/route";
import {
  MemoryImageStorage,
  UploadError,
  albumCoverTarget,
  conflictFor,
  eventLogoTarget,
  handleImageUpload,
  parseExpectedLogo,
  seriesLogoTarget,
  uploadAndAssign,
  writeAlbumImageUrl,
  writeLogoAssignment,
  type LogoAssignment,
  type TargetAdapter,
} from "@/lib/imageUpload";
import type { UploadDb } from "@/lib/imageUpload/service";

const TAG = `upload-itest-${Date.now()}`;
const BASE = `https://images.test.invalid/${TAG}`;
const EXTERNAL_COVER = `https://example.com/${TAG}/external.jpg`;

let seriesId: bigint;
let eventId: bigint;
let albumId: bigint;
let png: Uint8Array;
let png2: Uint8Array;

const storage = () => new MemoryImageStorage("itest", BASE);
const quietLog = vi.fn();

function jsonReq(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof UploadError) return e.code;
    throw e;
  }
  return "resolved";
}

async function assetCount(): Promise<number> {
  return prisma.imageAsset.count({ where: { publicUrl: { startsWith: BASE } } });
}

async function seriesLogo() {
  const s = await prisma.eventSeries.findUniqueOrThrow({ where: { id: seriesId } });
  return { mode: s.logoMode, assetId: s.logoAssetId };
}

async function resetSeries() {
  await prisma.eventSeries.update({ where: { id: seriesId }, data: { logoMode: "inherit", logoAssetId: null } });
}

const INHERIT = { mode: "inherit" as const, assetId: null };
const noProvenance = { sourceUrl: null, usageNote: null };

beforeAll(async () => {
  png = new Uint8Array(
    await sharp({ create: { width: 400, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toBuffer(),
  );
  png2 = new Uint8Array(
    await sharp({ create: { width: 120, height: 120, channels: 3, background: "#e50080" } }).webp().toBuffer(),
  );

  const s = await SERIES_POST(
    jsonReq("http://x/api/admin/event-series", {
      type: "standalone",
      originalName: `${TAG} series`,
      originalLanguage: "ja",
      translations: [{ locale: "ja", name: `${TAG} series` }],
    }),
  );
  expect(s.status).toBe(201);
  seriesId = BigInt((await s.json()).id);

  const e = await EVENT_POST(
    jsonReq("http://x/api/admin/events", {
      type: "concert",
      startTime: "2099-01-01T10:00:00.000Z",
      eventSeriesId: seriesId.toString(),
      originalName: `${TAG} event`,
      originalLanguage: "ja",
      translations: [{ locale: "ja", name: `${TAG} event` }],
    }),
  );
  expect(e.status).toBe(201);
  eventId = BigInt((await e.json()).id);

  const album = await prisma.album.create({
    data: { slug: TAG, type: "single", originalTitle: `${TAG} album`, imageUrl: EXTERNAL_COVER },
  });
  albumId = album.id;
});

beforeEach(async () => {
  await resetSeries();
});

afterAll(async () => {
  if (eventId) {
    await prisma.event.update({ where: { id: eventId }, data: { logoMode: "inherit", logoAssetId: null } });
    await prisma.eventTranslation.deleteMany({ where: { eventId } });
    await prisma.event.delete({ where: { id: eventId } });
  }
  if (seriesId) {
    await resetSeries();
    await prisma.eventSeriesTranslation.deleteMany({ where: { eventSeriesId: seriesId } });
    await prisma.eventSeries.delete({ where: { id: seriesId } });
  }
  if (albumId) await prisma.album.delete({ where: { id: albumId } });
  await prisma.imageAsset.deleteMany({ where: { publicUrl: { startsWith: BASE } } });
  expect(await assetCount()).toBe(0);
});

describe("successful upload", () => {
  it("stores, inserts metadata and assigns a series logo in one transaction", async () => {
    const mem = storage();
    const attemptId = randomUUID();
    const result = await uploadAndAssign(
      {
        target: seriesLogoTarget(seriesId),
        expected: INHERIT,
        attemptId,
        bytes: png,
        provenance: { sourceUrl: "https://example.com/source", usageNote: "운영 메모" },
      },
      { storage: mem, log: quietLog },
    );
    expect(result.status).toBe("created");
    expect(result.asset).toMatchObject({ mimeType: "image/png", width: 400, height: 100, byteSize: png.byteLength });
    // Trusted URL from the storage config + server-derived key.
    expect(result.asset.publicUrl).toBe(`${BASE}/itest/series-logo/${seriesId}/${attemptId}.png`);
    // Provenance is stored but not part of the result.
    expect(JSON.stringify(result)).not.toContain("운영 메모");
    const row = await prisma.imageAsset.findUniqueOrThrow({ where: { id: result.asset.id } });
    expect([row.sourceUrl, row.usageNote]).toEqual(["https://example.com/source", "운영 메모"]);
    expect(await seriesLogo()).toEqual({ mode: "custom", assetId: result.asset.id });
    // The exact uploaded bytes went to storage.
    expect(Buffer.from([...mem.objects.values()][0].bytes).equals(Buffer.from(png))).toBe(true);
  });

  it("assigns an event logo override and an album cover (managed URL replaces external)", async () => {
    const ev = await uploadAndAssign(
      { target: eventLogoTarget(eventId), expected: INHERIT, attemptId: randomUUID(), bytes: png2, provenance: noProvenance },
      { storage: storage(), log: quietLog },
    );
    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    expect([event.logoMode, event.logoAssetId]).toEqual(["custom", ev.asset.id]);

    const cover = await uploadAndAssign(
      {
        target: albumCoverTarget(albumId),
        expected: { imageUrl: EXTERNAL_COVER },
        attemptId: randomUUID(),
        bytes: png2,
        provenance: noProvenance,
      },
      { storage: storage(), log: quietLog },
    );
    const album = await prisma.album.findUniqueOrThrow({ where: { id: albumId } });
    expect(album.imageUrl).toBe(cover.asset.publicUrl);
    // Provenance lookup is an exact URL match.
    const byUrl = await prisma.imageAsset.findUnique({ where: { publicUrl: album.imageUrl! } });
    expect(byUrl?.id).toBe(cover.asset.id);
  });
});

describe("failures preserve the previous assignment", () => {
  it("invalid image: nothing stored, nothing written", async () => {
    const mem = storage();
    const before = await assetCount();
    const code = await codeOf(
      uploadAndAssign(
        {
          target: seriesLogoTarget(seriesId),
          expected: INHERIT,
          attemptId: randomUUID(),
          bytes: new TextEncoder().encode("<svg/>"),
          provenance: noProvenance,
        },
        { storage: mem, log: quietLog },
      ),
    );
    expect(code).toBe("unsupported_image_type");
    expect(mem.puts).toHaveLength(0);
    expect(await assetCount()).toBe(before);
    expect(await seriesLogo()).toEqual(INHERIT);
  });

  it("storage failure: no row, previous assignment intact", async () => {
    const mem = storage();
    mem.failWith = new UploadError("storage_failed", "down");
    const before = await assetCount();
    expect(
      await codeOf(
        uploadAndAssign(
          { target: seriesLogoTarget(seriesId), expected: INHERIT, attemptId: randomUUID(), bytes: png, provenance: noProvenance },
          { storage: mem, log: quietLog },
        ),
      ),
    ).toBe("storage_failed");
    expect(await assetCount()).toBe(before);
    expect(await seriesLogo()).toEqual(INHERIT);
  });

  it("known pre-commit DB failure: metadata rolled back, object left unassigned and logged", async () => {
    const mem = storage();
    const real = seriesLogoTarget(seriesId);
    const failing: TargetAdapter<LogoAssignment> = {
      ...real,
      assignAsset: async () => {
        throw new Error("simulated statement failure inside the transaction");
      },
    };
    const log = vi.fn();
    const before = await assetCount();
    const attemptId = randomUUID();
    expect(
      await codeOf(
        uploadAndAssign(
          { target: failing, expected: INHERIT, attemptId, bytes: png, provenance: noProvenance },
          { storage: mem, log },
        ),
      ),
    ).toBe("not_saved");
    expect(await assetCount()).toBe(before);
    expect(await seriesLogo()).toEqual(INHERIT);
    // Acknowledged outcome: stored object, no row, correlation logged.
    expect(mem.objects.size).toBe(1);
    expect(log).toHaveBeenCalledWith(
      "not-saved-unassigned-object",
      expect.objectContaining({ attemptId, objectKey: expect.stringContaining(attemptId) }),
    );
  });

  it("stale form: 409 with the current value, no storage write, no row", async () => {
    const other = await uploadAndAssign(
      { target: seriesLogoTarget(seriesId), expected: INHERIT, attemptId: randomUUID(), bytes: png2, provenance: noProvenance },
      { storage: storage(), log: quietLog },
    );
    const mem = storage();
    const before = await assetCount();
    let err: unknown;
    try {
      await uploadAndAssign(
        { target: seriesLogoTarget(seriesId), expected: INHERIT, attemptId: randomUUID(), bytes: png, provenance: noProvenance },
        { storage: mem, log: quietLog },
      );
    } catch (e) {
      err = e;
    }
    expect((err as UploadError).code).toBe("assignment_conflict");
    expect((err as UploadError).status).toBe(409);
    expect((err as UploadError).detail).toEqual({ current: { logoMode: "custom", logoAssetId: other.asset.id } });
    expect(mem.puts).toHaveLength(0);
    expect(await assetCount()).toBe(before);
    expect(await seriesLogo()).toEqual({ mode: "custom", assetId: other.asset.id });
  });
});

describe("concurrency and lost responses", () => {
  it("two saves from the same form state: exactly one wins, the loser's metadata rolls back", async () => {
    const run = () =>
      uploadAndAssign(
        { target: seriesLogoTarget(seriesId), expected: INHERIT, attemptId: randomUUID(), bytes: png, provenance: noProvenance },
        { storage: storage(), log: quietLog },
      ).then(
        (r) => ({ ok: true as const, id: r.asset.id }),
        (e: UploadError) => ({ ok: false as const, code: e.code }),
      );
    const before = await assetCount();
    const results = await Promise.all([run(), run(), run()]);
    const winners = results.filter((r) => r.ok);
    expect(winners).toHaveLength(1);
    expect(results.filter((r) => !r.ok).map((r) => (r as { code: string }).code)).toEqual([
      "assignment_conflict",
      "assignment_conflict",
    ]);
    // Only the winner's row exists; the losers' inserts were rolled back.
    expect(await assetCount()).toBe(before + 1);
    expect(await seriesLogo()).toEqual({ mode: "custom", assetId: (winners[0] as { id: string }).id });
  });

  /** $transaction whose Nth call commits for real but then throws, like
   *  a COMMIT whose reply never arrived. uploadAndAssign's calls are:
   *  #1 the early read, #2 the finalize transaction. */
  function losesReplyOfCall(n: number): UploadDb {
    let calls = 0;
    return {
      imageAsset: prisma.imageAsset,
      $transaction: (async (arg: unknown) => {
        calls += 1;
        const result = await (prisma.$transaction as (a: unknown) => Promise<unknown>)(arg);
        if (calls === n) throw new Error("Connection terminated unexpectedly");
        return result;
      }) as UploadDb["$transaction"],
    };
  }

  it("commit with a lost reply is 'unknown'; resubmitting the same attempt reconciles without a second write", async () => {
    const mem = storage();
    const attemptId = randomUUID();
    const req = { target: seriesLogoTarget(seriesId), expected: INHERIT, attemptId, bytes: png, provenance: noProvenance };
    const before = await assetCount();

    let first: unknown;
    try {
      await uploadAndAssign(req, { storage: mem, db: losesReplyOfCall(2), log: quietLog });
    } catch (e) {
      first = e;
    }
    expect((first as UploadError).code).toBe("outcome_unknown");
    expect((first as UploadError).outcome).toBe("unknown");
    // It did commit — and is not undone.
    const committed = await seriesLogo();
    expect(committed.mode).toBe("custom");

    const retry = await uploadAndAssign(req, { storage: mem, log: quietLog });
    expect(retry.status).toBe("reconciled");
    expect(retry.asset.id).toBe(committed.assetId);
    expect(await assetCount()).toBe(before + 1);
    expect(mem.objects.size).toBe(1);
  });

  it("a retry after a newer save never takes the assignment back", async () => {
    const attemptId = randomUUID();
    const req = { target: seriesLogoTarget(seriesId), expected: INHERIT, attemptId, bytes: png, provenance: noProvenance };
    await codeOf(uploadAndAssign(req, { storage: storage(), db: losesReplyOfCall(2), log: quietLog }));
    const mine = (await seriesLogo()).assetId!;

    // Another admin switches the series to typography meanwhile.
    await prisma.$transaction((tx) =>
      writeLogoAssignment(tx, "series-logo", seriesId, { mode: "custom", assetId: mine }, { mode: "typography" }),
    );

    let err: unknown;
    try {
      await uploadAndAssign(req, { storage: storage(), log: quietLog });
    } catch (e) {
      err = e;
    }
    expect((err as UploadError).code).toBe("assignment_conflict");
    expect((err as UploadError).detail).toMatchObject({ attemptCommitted: true, current: { logoMode: "typography" } });
    expect(await seriesLogo()).toEqual({ mode: "typography", assetId: null });
  });

  it("reusing an attempt id for a different file is refused", async () => {
    const attemptId = randomUUID();
    await uploadAndAssign(
      { target: seriesLogoTarget(seriesId), expected: INHERIT, attemptId, bytes: png, provenance: noProvenance },
      { storage: storage(), log: quietLog },
    );
    const committed = await seriesLogo();
    // Same key only if same format; png2 is WebP → different key, so use
    // a different PNG to collide on the key.
    const otherPng = new Uint8Array(
      await sharp({ create: { width: 64, height: 64, channels: 3, background: "#00ff00" } }).png().toBuffer(),
    );
    expect(
      await codeOf(
        uploadAndAssign(
          { target: seriesLogoTarget(seriesId), expected: committed, attemptId, bytes: otherPng, provenance: noProvenance },
          { storage: storage(), log: quietLog },
        ),
      ),
    ).toBe("attempt_conflict");
  });
});

describe("compare-and-set for the non-upload writers (09/10/11)", () => {
  it("logo mode changes: typography and unlink clear the asset; stale expected value is refused", async () => {
    const up = await uploadAndAssign(
      { target: seriesLogoTarget(seriesId), expected: INHERIT, attemptId: randomUUID(), bytes: png, provenance: noProvenance },
      { storage: storage(), log: quietLog },
    );
    const custom = { mode: "custom" as const, assetId: up.asset.id };
    expect(await prisma.$transaction((tx) => writeLogoAssignment(tx, "series-logo", seriesId, INHERIT, { mode: "typography" }))).toBe(false);
    const err = await prisma.$transaction((tx) => conflictFor(tx, seriesLogoTarget(seriesId)));
    expect(err.code).toBe("assignment_conflict");
    expect(await prisma.$transaction((tx) => writeLogoAssignment(tx, "series-logo", seriesId, custom, { mode: "inherit" }))).toBe(true);
    expect(await seriesLogo()).toEqual(INHERIT);
    // Unlink keeps the asset row (ordinary unlink retains objects/records).
    expect(await prisma.imageAsset.findUnique({ where: { id: up.asset.id } })).not.toBeNull();
  });

  it("album URL edit / unlink compare the expected imageUrl and never resurrect an old one", async () => {
    await prisma.album.update({ where: { id: albumId }, data: { imageUrl: EXTERNAL_COVER } });
    const cover = async () => (await prisma.album.findUniqueOrThrow({ where: { id: albumId } })).imageUrl;
    // A form that loaded some other cover is stale.
    expect(
      await prisma.$transaction((tx) => writeAlbumImageUrl(tx, albumId, { imageUrl: "https://example.com/other" }, null)),
    ).toBe(false);
    expect(await cover()).toBe(EXTERNAL_COVER);
    // Unlink → null (no hidden previous cover to fall back to).
    expect(await prisma.$transaction((tx) => writeAlbumImageUrl(tx, albumId, { imageUrl: EXTERNAL_COVER }, null))).toBe(
      true,
    );
    expect(await cover()).toBeNull();
    // A late save from a form that still showed the old URL cannot bring it back.
    expect(
      await prisma.$transaction((tx) =>
        writeAlbumImageUrl(tx, albumId, { imageUrl: EXTERNAL_COVER }, "https://example.com/late.jpg"),
      ),
    ).toBe(false);
    expect(await cover()).toBeNull();
  });

  it("a deleted target is 404, not 409", async () => {
    expect(await codeOf(prisma.$transaction(async (tx) => { throw await conflictFor(tx, seriesLogoTarget(BigInt("9007199254740991"))); }))).toBe(
      "target_not_found",
    );
  });
});

describe("HTTP boundary (handleImageUpload)", () => {
  function uploadReq(fields: Record<string, string | Blob>, headers: Record<string, string> = {}) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    return new NextRequest(`http://admin.test/api/admin/event-series/${seriesId}/logo`, {
      method: "POST",
      headers: { Origin: "http://admin.test", ...headers },
      body: form,
    });
  }
  const resolve = (form: FormData) => ({
    target: seriesLogoTarget(seriesId),
    expected: parseExpectedLogo(form.get("expectedMode"), form.get("expectedAssetId")),
  });

  it("201 + public-data invalidation on success; body has no provenance", async () => {
    vi.mocked(revalidatePublicData).mockClear();
    const res = await handleImageUpload(
      uploadReq({
        file: new Blob([png as BlobPart], { type: "application/octet-stream" }),
        attemptId: randomUUID(),
        expectedMode: "inherit",
        expectedAssetId: "",
        usageNote: "비공개 메모",
      }),
      resolve,
      { storage: storage(), log: quietLog },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("created");
    expect(body.asset.mimeType).toBe("image/png"); // decoded, not the Blob's claimed type
    expect(JSON.stringify(body)).not.toContain("비공개 메모");
    expect(revalidatePublicData).toHaveBeenCalledTimes(1);
  });

  it("rejects a cross-origin request before reading the body", async () => {
    const mem = storage();
    const res = await handleImageUpload(
      uploadReq(
        { file: new Blob([png as BlobPart]), attemptId: randomUUID(), expectedMode: "inherit", expectedAssetId: "" },
        { Origin: "https://evil.example" },
      ),
      resolve,
      { storage: mem, log: quietLog },
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden_origin");
    expect(mem.puts).toHaveLength(0);
  });

  it("413 on an oversized Content-Length, 400 without expected fields, 409 shape on conflict", async () => {
    const big = await handleImageUpload(
      uploadReq({ file: new Blob([png as BlobPart]), attemptId: randomUUID() }, { "Content-Length": "9000000" }),
      resolve,
      { storage: storage(), log: quietLog },
    );
    expect(big.status).toBe(413);

    const missing = await handleImageUpload(
      uploadReq({ file: new Blob([png as BlobPart]), attemptId: randomUUID() }),
      resolve,
      { storage: storage(), log: quietLog },
    );
    expect(missing.status).toBe(400);
    expect((await missing.json()).outcome).toBe("not_saved");

    await prisma.eventSeries.update({ where: { id: seriesId }, data: { logoMode: "typography" } });
    const stale = await handleImageUpload(
      uploadReq({ file: new Blob([png as BlobPart]), attemptId: randomUUID(), expectedMode: "inherit", expectedAssetId: "" }),
      resolve,
      { storage: storage(), log: quietLog },
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      error: "assignment_conflict",
      outcome: "conflict",
      current: { logoMode: "typography", logoAssetId: null },
    });
  });

  it("503 storage_not_configured when R2 env is absent (no storage injected)", async () => {
    const saved = { ...process.env };
    for (const k of Object.keys(process.env)) if (k.startsWith("R2_")) delete process.env[k];
    try {
      const res = await handleImageUpload(
        uploadReq({ file: new Blob([png as BlobPart]), attemptId: randomUUID(), expectedMode: "inherit", expectedAssetId: "" }),
        resolve,
        { log: quietLog },
      );
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe("storage_not_configured");
      expect(await seriesLogo()).toEqual(INHERIT);
    } finally {
      Object.assign(process.env, saved);
    }
  });
});
