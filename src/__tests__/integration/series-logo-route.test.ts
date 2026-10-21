import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import sharp from "sharp";
import { randomUUID } from "node:crypto";

// Series logo card endpoints against the DEV database, through the real
// route handlers: auth-first + same-origin, upload → custom, mode change /
// unlink through the compare-and-set, 409 / pre-commit failure / lost
// commit reply, attempt evidence for reconciliation, retained asset rows,
// the main PUT never touching the logo, and the resolver result a
// descendant series and event get afterwards (07 contract).
//
// Storage is MemoryImageStorage (write-once like R2) — no R2 traffic.
//
// Fixtures (this run's TAG only): parent series P, child series C under P,
// one event E under C, ImageAsset rows with publicUrl under BASE. No
// existing record is written. afterAll clears the logo references
// (Restrict FKs) and hard-deletes everything, then asserts nothing is left.

// Hoisted: the storage mock below runs when the route modules are
// imported, before this file's top-level statements.
const r2 = vi.hoisted(() => ({ configured: true, tag: `series-logo-itest-${Date.now()}` }));
const TAG = r2.tag;
const BASE = `https://images.test.invalid/${TAG}`;
const PREFIX = "itest";

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
vi.mock("@/lib/imageUpload/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/imageUpload/storage")>();
  const { MemoryImageStorage } = await import("@/lib/imageUpload/memoryStorage");
  const storage = new MemoryImageStorage("itest", `https://images.test.invalid/${r2.tag}`);
  return {
    ...actual,
    getImageStorage: () => storage,
    readR2Config: () =>
      r2.configured
        ? {
            accountId: "0".repeat(32),
            accessKeyId: "x",
            secretAccessKey: "x",
            bucket: "itest-bucket",
            publicBaseUrl: "https://images.test.invalid",
            keyPrefix: "itest",
          }
        : null,
  };
});

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { revalidatePublicData } from "@/lib/dataCache";
import { POST as SERIES_POST } from "@/app/api/admin/event-series/route";
import { PUT as SERIES_PUT } from "@/app/api/admin/event-series/[id]/route";
import { GET, POST, PATCH } from "@/app/api/admin/event-series/[id]/logo/route";
import { POST as EVENT_POST } from "@/app/api/admin/events/route";
import { fetchLogoSeriesGraphRows } from "@/lib/logoSeriesGraph";
import { LOGO_EVENT_SELECT, buildLogoSeriesGraph, resolveEventLogo } from "@/lib/logoResolution";
import type { AdminSeriesLogoState } from "@/lib/adminLogo";

const ORIGIN = "http://localhost";
let parentId: bigint;
let childId: bigint;
let eventId: bigint;
let png: Uint8Array;
let webp: Uint8Array;

const props = (id: bigint) => ({ params: Promise.resolve({ id: id.toString() }) });

function jsonReq(url: string, method: string, body: unknown, origin: string | null = ORIGIN) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (origin) headers.Origin = origin;
  return new NextRequest(`${ORIGIN}${url}`, { method, headers, body: JSON.stringify(body) });
}

function uploadReq(
  id: bigint,
  fields: { file: Uint8Array; attemptId: string; expectedMode: string; expectedAssetId: string; sourceUrl?: string; usageNote?: string },
  origin: string | null = ORIGIN,
) {
  const form = new FormData();
  form.set("file", new Blob([fields.file as BlobPart], { type: "image/png" }), "logo.png");
  form.set("attemptId", fields.attemptId);
  form.set("expectedMode", fields.expectedMode);
  form.set("expectedAssetId", fields.expectedAssetId);
  if (fields.sourceUrl !== undefined) form.set("sourceUrl", fields.sourceUrl);
  if (fields.usageNote !== undefined) form.set("usageNote", fields.usageNote);
  const headers: Record<string, string> = {};
  if (origin) headers.Origin = origin;
  return new NextRequest(`${ORIGIN}/api/admin/event-series/${id}/logo`, { method: "POST", headers, body: form });
}

async function getState(id: bigint, query = ""): Promise<{ status: number; body: AdminSeriesLogoState }> {
  const res = await GET(new NextRequest(`${ORIGIN}/api/admin/event-series/${id}/logo${query}`), props(id));
  return { status: res.status, body: await res.json() };
}

async function upload(id: bigint, expected: { mode: string; assetId: string | null }, file = png, extra = {}) {
  const attemptId = randomUUID();
  const res = await POST(
    uploadReq(id, { file, attemptId, expectedMode: expected.mode, expectedAssetId: expected.assetId ?? "", ...extra }),
    props(id),
  );
  return { res, attemptId, body: await res.json() };
}

const patch = (id: bigint, expected: unknown, next: unknown, origin: string | null = ORIGIN) =>
  PATCH(jsonReq(`/api/admin/event-series/${id}/logo`, "PATCH", { expected, next }, origin), props(id));

async function logoOf(id: bigint) {
  const s = await prisma.eventSeries.findUniqueOrThrow({ where: { id }, select: { logoMode: true, logoAssetId: true } });
  return { mode: s.logoMode, assetId: s.logoAssetId };
}

const assetCount = () => prisma.imageAsset.count({ where: { publicUrl: { startsWith: BASE } } });

async function eventLogo() {
  const e = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: LOGO_EVENT_SELECT });
  return resolveEventLogo(e, buildLogoSeriesGraph(await fetchLogoSeriesGraphRows()));
}

const INHERIT = { mode: "inherit", assetId: null };

async function createSeries(name: string, parent: bigint | null) {
  const res = await SERIES_POST(
    jsonReq("/api/admin/event-series", "POST", {
      type: "concert_tour",
      parentSeriesId: parent?.toString() ?? null,
      originalName: name,
      originalLanguage: "ja",
      translations: [{ locale: "ko", name: `${name} ko` }],
    }),
  );
  expect(res.status).toBe(201);
  return BigInt((await res.json()).id);
}

beforeAll(async () => {
  png = new Uint8Array(
    await sharp({ create: { width: 400, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toBuffer(),
  );
  webp = new Uint8Array(
    await sharp({ create: { width: 120, height: 120, channels: 3, background: "#e50080" } }).webp().toBuffer(),
  );
  parentId = await createSeries(`${TAG} parent`, null);
  childId = await createSeries(`${TAG} child`, parentId);
  const e = await EVENT_POST(
    jsonReq("/api/admin/events", "POST", {
      type: "concert",
      startTime: "2099-01-01T10:00:00.000Z",
      eventSeriesId: childId.toString(),
      originalName: `${TAG} event`,
      originalLanguage: "ja",
      translations: [{ locale: "ja", name: `${TAG} event` }],
    }),
  );
  expect(e.status).toBe(201);
  eventId = BigInt((await e.json()).id);
});

beforeEach(async () => {
  r2.configured = true;
  vi.mocked(revalidatePublicData).mockClear();
  await prisma.eventSeries.updateMany({
    where: { id: { in: [parentId, childId] } },
    data: { logoMode: "inherit", logoAssetId: null },
  });
});

afterAll(async () => {
  const series = [parentId, childId].filter(Boolean);
  if (series.length) {
    await prisma.eventSeries.updateMany({ where: { id: { in: series } }, data: { logoMode: "inherit", logoAssetId: null } });
  }
  if (eventId) {
    await prisma.eventTranslation.deleteMany({ where: { eventId } });
    await prisma.event.delete({ where: { id: eventId } });
  }
  for (const id of [childId, parentId].filter(Boolean)) {
    await prisma.eventSeriesTranslation.deleteMany({ where: { eventSeriesId: id } });
    await prisma.eventSeries.delete({ where: { id } });
  }
  await prisma.imageAsset.deleteMany({ where: { publicUrl: { startsWith: BASE } } });
  expect(await assetCount()).toBe(0);
  expect(await prisma.eventSeries.count({ where: { originalName: { startsWith: TAG } } })).toBe(0);
});

describe("GET state", () => {
  it("404 for a missing series, 400 for a bad id", async () => {
    expect((await getState(BigInt("9000000000000000000"))).status).toBe(404);
    const bad = await GET(new NextRequest(`${ORIGIN}/api/admin/event-series/abc/logo`), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(bad.status).toBe(400);
  });

  it("defaults: inherit everywhere → typography by exhaustion, no-store", async () => {
    const res = await GET(new NextRequest(`${ORIGIN}/api/admin/event-series/${childId}/logo`), props(childId));
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as AdminSeriesLogoState;
    expect(body.assignment).toEqual(INHERIT);
    expect(body.applied).toEqual({ imageUrl: null, reason: "exhausted", source: null });
    expect(body.previews.typography.reason).toBe("typography-mode");
    expect(body.previews.typography.source?.isSelf).toBe(true);
    expect(body.attempt).toBeNull();
  });
});

describe("upload → custom, inheritance, provenance", () => {
  it("parent upload is inherited by the child series and its event; provenance is admin-only", async () => {
    const before = await assetCount();
    const { res, body } = await upload(parentId, INHERIT, png, {
      sourceUrl: "https://example.com/official",
      usageNote: `${TAG} note`,
    });
    expect(res.status).toBe(201);
    expect(revalidatePublicData).toHaveBeenCalled();
    expect(body.asset.publicUrl.startsWith(`${BASE}/${PREFIX}/series-logo/${parentId}/`)).toBe(true);
    expect(body.asset).not.toHaveProperty("sourceUrl");
    expect(await assetCount()).toBe(before + 1);

    const parent = (await getState(parentId)).body;
    expect(parent.assignment).toEqual({ mode: "custom", assetId: body.asset.id });
    expect(parent.asset?.sourceUrl).toBe("https://example.com/official");
    expect(parent.asset?.usageNote).toBe(`${TAG} note`);
    expect(parent.applied.source?.isSelf).toBe(true);

    const child = (await getState(childId)).body;
    expect(child.applied.reason).toBe("custom");
    expect(child.applied.imageUrl).toBe(body.asset.publicUrl);
    expect(child.applied.source).toMatchObject({ id: parentId.toString(), isSelf: false, name: `${TAG} parent ko` });
    // Draft typography on the child would stop inheritance at the child.
    expect(child.previews.typography).toMatchObject({ imageUrl: null, reason: "typography-mode" });

    const logo = await eventLogo();
    expect(logo.image?.url).toBe(body.asset.publicUrl);
    expect(JSON.stringify(logo)).not.toContain(`${TAG} note`);
  });

  it("child typography beats the inherited parent logo; child custom beats parent typography", async () => {
    const up = await upload(parentId, INHERIT);
    expect((await patch(childId, INHERIT, { mode: "typography" })).status).toBe(200);
    expect((await eventLogo()).image).toBeNull();
    expect((await getState(childId)).body.applied).toMatchObject({ reason: "typography-mode", source: { isSelf: true } });

    expect((await patch(parentId, { mode: "custom", assetId: up.body.asset.id }, { mode: "typography" })).status).toBe(200);
    const childUp = await upload(childId, { mode: "typography", assetId: null }, webp);
    expect(childUp.res.status).toBe(201);
    expect((await eventLogo()).image?.url).toBe(childUp.body.asset.publicUrl);
  });

  it("stale expected pair → 409 with current, nothing inserted", async () => {
    const first = await upload(parentId, INHERIT);
    const before = await assetCount();
    const stale = await upload(parentId, INHERIT, webp);
    expect(stale.res.status).toBe(409);
    expect(stale.body).toMatchObject({ outcome: "conflict", current: { logoMode: "custom", logoAssetId: first.body.asset.id } });
    expect(await assetCount()).toBe(before);
  });

  it("resubmitting the same attempt reconciles (one row), never writes twice", async () => {
    const attemptId = randomUUID();
    const fields = { file: png, attemptId, expectedMode: "inherit", expectedAssetId: "" };
    const a = await POST(uploadReq(parentId, fields), props(parentId));
    expect(a.status).toBe(201);
    const before = await assetCount();
    const b = await POST(uploadReq(parentId, fields), props(parentId));
    expect(b.status).toBe(200);
    expect((await b.json()).status).toBe("reconciled");
    expect(await assetCount()).toBe(before);
  });

  it("cross-origin upload → 403, nothing stored", async () => {
    const before = await assetCount();
    const res = await POST(
      uploadReq(parentId, { file: png, attemptId: randomUUID(), expectedMode: "inherit", expectedAssetId: "" }, "https://evil.example"),
      props(parentId),
    );
    expect(res.status).toBe(403);
    expect(await assetCount()).toBe(before);
    expect(await logoOf(parentId)).toEqual(INHERIT);
  });
});

describe("PATCH mode change / unlink", () => {
  it("unlink (custom → inherit) keeps the asset row; the event falls back", async () => {
    const up = await upload(parentId, INHERIT);
    const before = await assetCount();
    // Positive control for the invalidation below: the upload itself
    // invalidated; clear it so only the PATCH can satisfy the assertion.
    expect(revalidatePublicData).toHaveBeenCalled();
    vi.mocked(revalidatePublicData).mockClear();
    const res = await patch(parentId, { mode: "custom", assetId: up.body.asset.id }, { mode: "inherit" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "saved", assignment: INHERIT });
    expect(revalidatePublicData).toHaveBeenCalledTimes(1);
    expect(await logoOf(parentId)).toEqual(INHERIT);
    expect(await assetCount()).toBe(before);
    expect(await prisma.imageAsset.count({ where: { id: up.body.asset.id } })).toBe(1);
    expect((await eventLogo()).image).toBeNull();
  });

  it("stale expected pair → 409 with the current value; nothing changes", async () => {
    const up = await upload(parentId, INHERIT);
    const res = await patch(parentId, INHERIT, { mode: "typography" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      outcome: "conflict",
      current: { logoMode: "custom", logoAssetId: up.body.asset.id },
    });
    expect(await logoOf(parentId)).toEqual({ mode: "custom", assetId: up.body.asset.id });
  });

  it("inherit/null vs typography/null are different expected values", async () => {
    expect((await patch(parentId, INHERIT, { mode: "typography" })).status).toBe(200);
    expect((await patch(parentId, INHERIT, { mode: "inherit" })).status).toBe(409);
  });

  it("rejects custom without a file, a missing expected field, and cross-origin requests", async () => {
    expect((await patch(parentId, INHERIT, { mode: "custom", assetId: randomUUID() })).status).toBe(400);
    expect((await patch(parentId, { mode: "inherit" }, { mode: "typography" })).status).toBe(400);
    const xo = await patch(parentId, INHERIT, { mode: "typography" }, "https://evil.example");
    expect(xo.status).toBe(403);
    expect(await logoOf(parentId)).toEqual(INHERIT);
  });

  it("404 for a soft-deleted series", async () => {
    const gone = await createSeries(`${TAG} gone`, null);
    await prisma.eventSeries.update({ where: { id: gone }, data: { isDeleted: true, deletedAt: new Date() } });
    try {
      expect((await patch(gone, INHERIT, { mode: "typography" })).status).toBe(404);
      expect((await getState(gone)).status).toBe(404);
    } finally {
      await prisma.eventSeriesTranslation.deleteMany({ where: { eventSeriesId: gone } });
      await prisma.eventSeries.delete({ where: { id: gone } });
    }
  });

  it("failure before the callback finished → not_saved; after it → outcome_unknown", async () => {
    const real = prisma.$transaction.bind(prisma);
    const spy = vi.spyOn(prisma, "$transaction");
    try {
      spy.mockImplementationOnce((async () => {
        throw new Error("connection reset before commit");
      }) as never);
      const pre = await patch(parentId, INHERIT, { mode: "typography" });
      expect(pre.status).toBe(500);
      expect(await pre.json()).toMatchObject({ outcome: "not_saved" });
      expect(await logoOf(parentId)).toEqual(INHERIT);

      // Commit really happens, then the reply is lost.
      spy.mockImplementationOnce((async (fn: never) => {
        await real(fn);
        throw new Error("reply lost after commit");
      }) as never);
      const lost = await patch(parentId, INHERIT, { mode: "typography" });
      expect(lost.status).toBe(503);
      expect(await lost.json()).toMatchObject({ outcome: "unknown" });
    } finally {
      spy.mockRestore();
    }
    // The lost reply skipped the route's invalidation; the reconcile read
    // must expire the public cache itself.
    expect(revalidatePublicData).not.toHaveBeenCalled();
    // The form reconciles by reading: current == next → reflected.
    expect((await getState(parentId, "?reconcile=1")).body.assignment).toEqual({ mode: "typography", assetId: null });
    expect(revalidatePublicData).toHaveBeenCalledTimes(1);
    // A plain read does not invalidate.
    await getState(parentId);
    expect(revalidatePublicData).toHaveBeenCalledTimes(1);
  });
});

describe("attempt evidence for a lost upload reply", () => {
  it("committed+held, then superseded; not-observed for an unknown attempt; unavailable without storage config", async () => {
    const up = await upload(parentId, INHERIT);
    let s = (await getState(parentId, `?reconcile=1&attemptId=${up.attemptId}`)).body;
    expect(s.attempt).toEqual({ state: "committed", assetId: up.body.asset.id, held: true });

    // Someone unlinks: the slot is back to the original expected value, but
    // the attempt WAS saved — the evidence must still say committed.
    await patch(parentId, { mode: "custom", assetId: up.body.asset.id }, { mode: "inherit" });
    s = (await getState(parentId, `?attemptId=${up.attemptId}`)).body;
    expect(s.attempt).toEqual({ state: "committed", assetId: up.body.asset.id, held: false });
    expect(s.assignment).toEqual(INHERIT);

    s = (await getState(parentId, `?attemptId=${randomUUID()}`)).body;
    expect(s.attempt).toEqual({ state: "not-observed" });

    r2.configured = false;
    s = (await getState(parentId, `?attemptId=${up.attemptId}`)).body;
    expect(s.attempt).toEqual({ state: "unavailable" });

    expect((await getState(parentId, "?attemptId=not-a-uuid")).status).toBe(400);
  });
});

describe("unrelated edits and the live path", () => {
  it("the main series PUT never clears or changes the logo assignment", async () => {
    const up = await upload(childId, INHERIT);
    const res = await SERIES_PUT(
      jsonReq(`/api/admin/event-series/${childId}`, "PUT", {
        type: "concert_tour",
        parentSeriesId: parentId.toString(),
        originalName: `${TAG} child`,
        originalShortName: "renamed",
        originalLanguage: "ja",
        translations: [{ locale: "ko", name: `${TAG} child ko` }],
      }),
      props(childId),
    );
    expect(res.status).toBe(200);
    expect(await logoOf(childId)).toEqual({ mode: "custom", assetId: up.body.asset.id });
  });

  it("logo writes do not bump the event's setlistRevision", async () => {
    const before = (await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { setlistRevision: true } }))
      .setlistRevision;
    const up = await upload(parentId, INHERIT);
    await patch(parentId, { mode: "custom", assetId: up.body.asset.id }, { mode: "typography" });
    const after = (await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { setlistRevision: true } }))
      .setlistRevision;
    expect(after).toBe(before);
  });
});
