import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import sharp from "sharp";
import { randomUUID } from "node:crypto";

// Event logo override endpoints against the DEV database, through the real
// route handlers: upload → event custom, override over the series logo and
// over an ancestor typography stop, unlink back to inheritance, the admin
// preview agreeing with the public resolver, 409 / pre-commit failure /
// lost commit reply, concurrent writers (PATCH vs PATCH, upload vs mode
// change), attempt evidence, retained asset rows, posterUrl and the main
// event PUT never touching the logo, and setlistRevision untouched.
//
// Storage is MemoryImageStorage (write-once like R2) — no R2 traffic.
//
// Fixtures (this run's TAG only): parent series P, child series C under P,
// event E under C (with a poster URL), ImageAsset rows with publicUrl
// under BASE. No existing record is written. afterAll clears the logo
// references (Restrict FKs) and hard-deletes everything, then asserts
// nothing is left.

// Hoisted: the storage mock below runs when the route modules are
// imported, before this file's top-level statements.
const r2 = vi.hoisted(() => ({ configured: true, tag: `event-logo-itest-${Date.now()}` }));
const TAG = r2.tag;
const BASE = `https://images.test.invalid/${TAG}`;
const PREFIX = "itest";
const POSTER = `https://posters.test.invalid/${TAG}/poster.jpg`;

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
import { POST as SERIES_LOGO_POST, PATCH as SERIES_LOGO_PATCH } from "@/app/api/admin/event-series/[id]/logo/route";
import { POST as EVENT_POST } from "@/app/api/admin/events/route";
import { PUT as EVENT_PUT } from "@/app/api/admin/events/[id]/route";
import { GET, POST, PATCH } from "@/app/api/admin/events/[id]/logo/route";
import { fetchLogoSeriesGraphRows } from "@/lib/logoSeriesGraph";
import { LOGO_EVENT_SELECT, buildLogoSeriesGraph, resolveEventLogo } from "@/lib/logoResolution";
import type { AdminEventLogoState } from "@/lib/adminEventLogo";

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
  path: string,
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
  return new NextRequest(`${ORIGIN}${path}`, { method: "POST", headers, body: form });
}

async function getState(id: bigint, query = ""): Promise<{ status: number; body: AdminEventLogoState }> {
  const res = await GET(new NextRequest(`${ORIGIN}/api/admin/events/${id}/logo${query}`), props(id));
  return { status: res.status, body: await res.json() };
}

type Expected = { mode: string; assetId: string | null };

async function upload(expected: Expected, file = png, extra = {}) {
  const attemptId = randomUUID();
  const res = await POST(
    uploadReq(`/api/admin/events/${eventId}/logo`, {
      file,
      attemptId,
      expectedMode: expected.mode,
      expectedAssetId: expected.assetId ?? "",
      ...extra,
    }),
    props(eventId),
  );
  return { res, attemptId, body: await res.json() };
}

async function uploadSeries(id: bigint, expected: Expected, file = png) {
  const res = await SERIES_LOGO_POST(
    uploadReq(`/api/admin/event-series/${id}/logo`, {
      file,
      attemptId: randomUUID(),
      expectedMode: expected.mode,
      expectedAssetId: expected.assetId ?? "",
    }),
    props(id),
  );
  expect(res.status).toBe(201);
  return (await res.json()).asset as { id: string; publicUrl: string };
}

const patch = (expected: unknown, next: unknown, origin: string | null = ORIGIN, id = eventId) =>
  PATCH(jsonReq(`/api/admin/events/${id}/logo`, "PATCH", { expected, next }, origin), props(id));

const patchSeries = (id: bigint, expected: unknown, next: unknown) =>
  SERIES_LOGO_PATCH(jsonReq(`/api/admin/event-series/${id}/logo`, "PATCH", { expected, next }), props(id));

async function logoOf() {
  const e = await prisma.event.findUniqueOrThrow({
    where: { id: eventId },
    select: { logoMode: true, logoAssetId: true, posterUrl: true },
  });
  return { mode: e.logoMode, assetId: e.logoAssetId, posterUrl: e.posterUrl };
}

const assetCount = () => prisma.imageAsset.count({ where: { publicUrl: { startsWith: BASE } } });

/** What a public page renders for the event (07 resolver, fresh graph). */
async function publicLogo() {
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

const eventBody = (extra: Record<string, unknown> = {}) => ({
  type: "concert",
  startTime: "2099-01-01T10:00:00.000Z",
  eventSeriesId: childId.toString(),
  posterUrl: POSTER,
  originalName: `${TAG} event`,
  originalLanguage: "ja",
  translations: [{ locale: "ja", name: `${TAG} event` }],
  ...extra,
});

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
  const e = await EVENT_POST(jsonReq("/api/admin/events", "POST", eventBody()));
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
  await prisma.event.update({ where: { id: eventId }, data: { logoMode: "inherit", logoAssetId: null } });
});

afterAll(async () => {
  if (eventId) {
    await prisma.event.update({ where: { id: eventId }, data: { logoMode: "inherit", logoAssetId: null } });
    await prisma.eventTranslation.deleteMany({ where: { eventId } });
    await prisma.event.delete({ where: { id: eventId } });
  }
  const series = [parentId, childId].filter(Boolean);
  if (series.length) {
    await prisma.eventSeries.updateMany({ where: { id: { in: series } }, data: { logoMode: "inherit", logoAssetId: null } });
  }
  for (const id of [childId, parentId].filter(Boolean)) {
    await prisma.eventSeriesTranslation.deleteMany({ where: { eventSeriesId: id } });
    await prisma.eventSeries.delete({ where: { id } });
  }
  await prisma.imageAsset.deleteMany({ where: { publicUrl: { startsWith: BASE } } });
  expect(await assetCount()).toBe(0);
  expect(await prisma.eventSeries.count({ where: { originalName: { startsWith: TAG } } })).toBe(0);
  expect(await prisma.event.count({ where: { originalName: { startsWith: TAG } } })).toBe(0);
});

describe("GET state", () => {
  it("404 for a missing event, 400 for a bad id", async () => {
    expect((await getState(BigInt("9000000000000000000"))).status).toBe(404);
    const bad = await GET(new NextRequest(`${ORIGIN}/api/admin/events/abc/logo`), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(bad.status).toBe(400);
  });

  it("defaults: inherit everywhere → typography by exhaustion, no-store, event-self typography preview", async () => {
    const res = await GET(new NextRequest(`${ORIGIN}/api/admin/events/${eventId}/logo`), props(eventId));
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as AdminEventLogoState;
    expect(body.eventId).toBe(eventId.toString());
    expect(body.assignment).toEqual(INHERIT);
    expect(body.applied).toEqual({ imageUrl: null, reason: "exhausted", source: null });
    expect(body.previews.typography).toMatchObject({ imageUrl: null, reason: "typography-mode", source: { isSelf: true } });
    expect(body.attempt).toBeNull();
  });
});

describe("override, inheritance and the public resolver", () => {
  it("inherits the parent series logo; the admin preview names it and matches the public result", async () => {
    const parentLogo = await uploadSeries(parentId, INHERIT);
    const s = (await getState(eventId)).body;
    expect(s.applied).toMatchObject({
      reason: "custom",
      imageUrl: parentLogo.publicUrl,
      source: { id: parentId.toString(), isSelf: false, name: `${TAG} parent ko` },
    });
    expect(s.previews.inherit).toEqual(s.applied);
    expect((await publicLogo()).image?.url).toBe(parentLogo.publicUrl);
  });

  it("event upload overrides the series logo; provenance stays admin-only; poster untouched", async () => {
    const parentLogo = await uploadSeries(parentId, INHERIT);
    const before = await assetCount();
    const { res, body } = await upload(INHERIT, webp, {
      sourceUrl: "https://example.com/official",
      usageNote: `${TAG} note`,
    });
    expect(res.status).toBe(201);
    expect(revalidatePublicData).toHaveBeenCalled();
    expect(body.asset.publicUrl.startsWith(`${BASE}/${PREFIX}/event-logo/${eventId}/`)).toBe(true);
    expect(body.asset).not.toHaveProperty("sourceUrl");
    expect(await assetCount()).toBe(before + 1);

    const s = (await getState(eventId)).body;
    expect(s.assignment).toEqual({ mode: "custom", assetId: body.asset.id });
    expect(s.asset?.sourceUrl).toBe("https://example.com/official");
    expect(s.asset?.usageNote).toBe(`${TAG} note`);
    expect(s.applied).toMatchObject({ reason: "custom", imageUrl: body.asset.publicUrl, source: { isSelf: true } });
    // The inherit draft would go back to the series logo.
    expect(s.previews.inherit).toMatchObject({ imageUrl: parentLogo.publicUrl, source: { id: parentId.toString() } });

    const logo = await publicLogo();
    expect(logo.image?.url).toBe(body.asset.publicUrl);
    expect(JSON.stringify(logo)).not.toContain(`${TAG} note`);
    expect((await logoOf()).posterUrl).toBe(POSTER);
  });

  it("event custom wins over an ancestor typography stop", async () => {
    expect((await patchSeries(parentId, INHERIT, { mode: "typography" })).status).toBe(200);
    expect((await publicLogo()).image).toBeNull();
    const { res, body } = await upload(INHERIT);
    expect(res.status).toBe(201);
    expect((await publicLogo()).image?.url).toBe(body.asset.publicUrl);
    expect((await getState(eventId)).body.previews.inherit).toMatchObject({
      imageUrl: null,
      reason: "typography-mode",
      source: { id: parentId.toString() },
    });
  });

  it("event typography stops inheritance of the series logo", async () => {
    await uploadSeries(childId, INHERIT);
    expect((await patch(INHERIT, { mode: "typography" })).status).toBe(200);
    expect((await publicLogo()).image).toBeNull();
    expect((await getState(eventId)).body.applied).toMatchObject({ reason: "typography-mode", source: { isSelf: true } });
  });

  it("unlink (custom → inherit) restores the series logo and keeps the asset row and poster", async () => {
    const seriesLogo = await uploadSeries(childId, INHERIT);
    const own = await upload(INHERIT, webp);
    const before = await assetCount();
    // Positive control: the upload invalidated; clear so only the PATCH counts.
    expect(revalidatePublicData).toHaveBeenCalled();
    vi.mocked(revalidatePublicData).mockClear();
    const res = await patch({ mode: "custom", assetId: own.body.asset.id }, { mode: "inherit" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "saved", assignment: INHERIT });
    expect(revalidatePublicData).toHaveBeenCalledTimes(1);
    expect(await logoOf()).toEqual({ ...INHERIT, posterUrl: POSTER });
    expect(await assetCount()).toBe(before);
    expect(await prisma.imageAsset.count({ where: { id: own.body.asset.id } })).toBe(1);
    expect((await publicLogo()).image?.url).toBe(seriesLogo.publicUrl);
  });

  it("replacing the override keeps the previous asset row", async () => {
    const first = await upload(INHERIT);
    const second = await upload({ mode: "custom", assetId: first.body.asset.id }, webp);
    expect(second.res.status).toBe(201);
    expect(await prisma.imageAsset.count({ where: { id: first.body.asset.id } })).toBe(1);
    expect((await logoOf()).assetId).toBe(second.body.asset.id);
  });
});

describe("compare-and-set, races, failures", () => {
  it("stale upload → 409 with current, nothing inserted", async () => {
    const first = await upload(INHERIT);
    const before = await assetCount();
    const stale = await upload(INHERIT, webp);
    expect(stale.res.status).toBe(409);
    expect(stale.body).toMatchObject({ outcome: "conflict", current: { logoMode: "custom", logoAssetId: first.body.asset.id } });
    expect(await assetCount()).toBe(before);
  });

  it("stale PATCH → 409 with the current value; nothing changes", async () => {
    const up = await upload(INHERIT);
    const res = await patch(INHERIT, { mode: "typography" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ outcome: "conflict", current: { logoMode: "custom", logoAssetId: up.body.asset.id } });
    expect((await logoOf()).assetId).toBe(up.body.asset.id);
  });

  it("concurrent mode changes from the same expected value: exactly one wins", async () => {
    // Three admins send the same real change (typography → inherit) from
    // the same loaded value. Mixed-writer races are the next two tests.
    expect((await patch(INHERIT, { mode: "typography" })).status).toBe(200);
    const typo = { mode: "typography", assetId: null };
    const results = await Promise.all([
      patch(typo, { mode: "inherit" }),
      patch(typo, { mode: "inherit" }),
      patch(typo, { mode: "inherit" }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    // The first commit moves the value to inherit; the others then compare
    // against a moved row → 409. (No-op duplicates cannot both succeed.)
    expect(statuses).toEqual([200, 409, 409]);
    expect(await logoOf()).toEqual({ ...INHERIT, posterUrl: POSTER });
  });

  it("upload vs mode change from the same baseline: one wins, the loser leaves no assignment", async () => {
    const before = await assetCount();
    const [up, mode] = await Promise.all([upload(INHERIT), patch(INHERIT, { mode: "typography" })]);
    const statuses = [up.res.status, mode.status].sort();
    expect(statuses[0] === 200 || statuses[0] === 201).toBe(true);
    expect(statuses[1]).toBe(409);
    const now = await logoOf();
    if (up.res.status === 201) {
      expect(now).toMatchObject({ mode: "custom", assetId: up.body.asset.id });
      expect(await assetCount()).toBe(before + 1);
    } else {
      expect(now).toMatchObject({ mode: "typography", assetId: null });
      // The losing upload rolled back its row.
      expect(await assetCount()).toBe(before);
    }
  });

  it("upload vs unlink of the current override: one wins", async () => {
    const own = await upload(INHERIT);
    const current = { mode: "custom", assetId: own.body.asset.id };
    const [up, unlink] = await Promise.all([upload(current, webp), patch(current, { mode: "inherit" })]);
    expect([up.res.status, unlink.status].sort()).toEqual(
      up.res.status === 201 ? [201, 409] : [200, 409],
    );
    const now = await logoOf();
    if (up.res.status === 201) expect(now.assetId).toBe(up.body.asset.id);
    else expect(now).toMatchObject(INHERIT);
  });

  it("resubmitting the same attempt reconciles (one row), never writes twice", async () => {
    const attemptId = randomUUID();
    const fields = { file: png, attemptId, expectedMode: "inherit", expectedAssetId: "" };
    const path = `/api/admin/events/${eventId}/logo`;
    const a = await POST(uploadReq(path, fields), props(eventId));
    expect(a.status).toBe(201);
    const before = await assetCount();
    const b = await POST(uploadReq(path, fields), props(eventId));
    expect(b.status).toBe(200);
    expect((await b.json()).status).toBe("reconciled");
    expect(await assetCount()).toBe(before);
  });

  it("rejects cross-origin upload/PATCH, custom by PATCH, and a missing expected field", async () => {
    const before = await assetCount();
    const xoUpload = await POST(
      uploadReq(
        `/api/admin/events/${eventId}/logo`,
        { file: png, attemptId: randomUUID(), expectedMode: "inherit", expectedAssetId: "" },
        "https://evil.example",
      ),
      props(eventId),
    );
    expect(xoUpload.status).toBe(403);
    expect(await assetCount()).toBe(before);
    expect((await patch(INHERIT, { mode: "typography" }, "https://evil.example")).status).toBe(403);
    expect((await patch(INHERIT, { mode: "custom", assetId: randomUUID() })).status).toBe(400);
    expect((await patch({ mode: "inherit" }, { mode: "typography" })).status).toBe(400);
    expect(await logoOf()).toEqual({ ...INHERIT, posterUrl: POSTER });
    // Positive control: the same change from the right origin writes.
    expect((await patch(INHERIT, { mode: "typography" })).status).toBe(200);
  });

  it("404 for a soft-deleted event", async () => {
    const res = await EVENT_POST(
      jsonReq(
        "/api/admin/events",
        "POST",
        eventBody({ originalName: `${TAG} gone`, translations: [{ locale: "ja", name: `${TAG} gone` }] }),
      ),
    );
    const created = await res.json();
    expect(res.status, JSON.stringify(created)).toBe(201);
    const gone = BigInt(created.id);
    await prisma.event.update({ where: { id: gone }, data: { isDeleted: true, deletedAt: new Date() } });
    try {
      expect((await patch(INHERIT, { mode: "typography" }, ORIGIN, gone)).status).toBe(404);
      expect((await getState(gone)).status).toBe(404);
    } finally {
      await prisma.eventTranslation.deleteMany({ where: { eventId: gone } });
      await prisma.event.delete({ where: { id: gone } });
    }
  });

  it("failure before the callback finished → not_saved; after it → outcome_unknown; reconcile re-expires", async () => {
    const real = prisma.$transaction.bind(prisma);
    const spy = vi.spyOn(prisma, "$transaction");
    try {
      spy.mockImplementationOnce((async () => {
        throw new Error("connection reset before commit");
      }) as never);
      const pre = await patch(INHERIT, { mode: "typography" });
      expect(pre.status).toBe(500);
      expect(await pre.json()).toMatchObject({ outcome: "not_saved" });
      expect((await logoOf()).mode).toBe("inherit");

      spy.mockImplementationOnce((async (fn: never) => {
        await real(fn);
        throw new Error("reply lost after commit");
      }) as never);
      const lost = await patch(INHERIT, { mode: "typography" });
      expect(lost.status).toBe(503);
      expect(await lost.json()).toMatchObject({ outcome: "unknown" });
    } finally {
      spy.mockRestore();
    }
    // Positive control: the "lost" PATCH really committed.
    expect((await logoOf()).mode).toBe("typography");
    expect(revalidatePublicData).not.toHaveBeenCalled();
    expect((await getState(eventId, "?reconcile=1")).body.assignment).toEqual({ mode: "typography", assetId: null });
    expect(revalidatePublicData).toHaveBeenCalledTimes(1);
    await getState(eventId);
    expect(revalidatePublicData).toHaveBeenCalledTimes(1);
  });
});

describe("attempt evidence for a lost upload reply", () => {
  it("committed+held, then superseded; not-observed; unavailable without storage config", async () => {
    const up = await upload(INHERIT);
    let s = (await getState(eventId, `?reconcile=1&attemptId=${up.attemptId}`)).body;
    expect(s.attempt).toEqual({ state: "committed", assetId: up.body.asset.id, held: true });

    // Unlinked back to the original expected value: the attempt WAS saved.
    expect((await patch({ mode: "custom", assetId: up.body.asset.id }, { mode: "inherit" })).status).toBe(200);
    s = (await getState(eventId, `?attemptId=${up.attemptId}`)).body;
    expect(s.attempt).toEqual({ state: "committed", assetId: up.body.asset.id, held: false });
    expect(s.assignment).toEqual(INHERIT);

    s = (await getState(eventId, `?attemptId=${randomUUID()}`)).body;
    expect(s.attempt).toEqual({ state: "not-observed" });

    r2.configured = false;
    s = (await getState(eventId, `?attemptId=${up.attemptId}`)).body;
    expect(s.attempt).toEqual({ state: "unavailable" });

    expect((await getState(eventId, "?attemptId=not-a-uuid")).status).toBe(400);
  });
});

describe("unrelated edits and the live path", () => {
  it("the main event PUT never clears or changes the logo override", async () => {
    const up = await upload(INHERIT);
    const res = await EVENT_PUT(
      jsonReq(`/api/admin/events/${eventId}`, "PUT", eventBody({ originalShortName: "renamed" })),
      props(eventId),
    );
    expect(res.status).toBe(200);
    expect(await logoOf()).toEqual({ mode: "custom", assetId: up.body.asset.id, posterUrl: POSTER });
  });

  it("logo writes do not bump the event's setlistRevision", async () => {
    const rev = async () =>
      (await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { setlistRevision: true } })).setlistRevision;
    const before = await rev();
    const up = await upload(INHERIT);
    await patch({ mode: "custom", assetId: up.body.asset.id }, { mode: "typography" });
    await patch({ mode: "typography", assetId: null }, { mode: "inherit" });
    expect(await rev()).toBe(before);
    // Positive control: the writes above really happened.
    expect((await logoOf()).mode).toBe("inherit");
    expect(await prisma.imageAsset.count({ where: { id: up.body.asset.id } })).toBe(1);
  });
});
