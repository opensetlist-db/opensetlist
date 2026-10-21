import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import sharp from "sharp";
import { randomUUID } from "node:crypto";

// Album cover editing against the DEV database: the info PATCH that must
// leave the cover alone (or compare-and-set it, rolling back every field
// on a mismatch), the cover route's URL edit / unlink / upload / re-read,
// recovery from an unknown outcome, and the CSV importer that never
// writes a cover.
//
// Storage is the in-memory write-once store (same semantics as R2); R2
// config is stubbed only so the route can rebuild an attempt's key.
// Nothing here talks to R2.
//
// Fixtures: one album (slug = TAG) and ImageAsset rows under BASE.
// afterAll hard-deletes both and asserts nothing is left.

const h = vi.hoisted(() => ({ storage: null as unknown }));

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
vi.mock("@/lib/imageUpload/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/imageUpload/storage")>()),
  getImageStorage: () => h.storage,
  readR2Config: () => ({
    accountId: "itest",
    accessKeyId: "itest",
    secretAccessKey: "itest",
    bucket: "itest",
    publicBaseUrl: "https://images.test.invalid",
    keyPrefix: "itest",
  }),
}));

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { revalidatePublicData } from "@/lib/dataCache";
import { PATCH } from "@/app/api/admin/albums/[id]/route";
import { GET, POST, PUT } from "@/app/api/admin/albums/[id]/cover/route";
import { POST as IMPORT_POST } from "@/app/api/admin/import/route";
import {
  UploadError,
  albumCoverTarget,
  writeAlbumImageUrl,
  writeAssignment,
  type AssignmentDb,
} from "@/lib/imageUpload";
import { MemoryImageStorage } from "@/lib/imageUpload/memoryStorage";

const TAG = `cover-itest-${Date.now()}`;
const BASE = `https://images.test.invalid/${TAG}`;
const EXTERNAL = `https://m.media-amazon.com/images/I/${TAG}-a._SL500_.jpg`;
const EXTERNAL_B = `https://example.com/${TAG}/b.jpg`;
const ORIGIN = "http://x";

let albumId: bigint;
let png: Uint8Array;
let storage: MemoryImageStorage;

const params = () => ({ params: Promise.resolve({ id: albumId.toString() }) });
const url = (suffix = "") => `${ORIGIN}/api/admin/albums/${albumId}${suffix}`;

function json(method: string, target: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(target, {
    method,
    headers: { "Content-Type": "application/json", origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

function upload(fields: Record<string, string>, bytes: Uint8Array = png) {
  const form = new FormData();
  form.set("file", new Blob([bytes as BlobPart], { type: "image/png" }), "cover.png");
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new NextRequest(url("/cover"), { method: "POST", headers: { origin: ORIGIN }, body: form });
}

async function cover(): Promise<string | null> {
  return (await prisma.album.findUniqueOrThrow({ where: { id: albumId }, select: { imageUrl: true } })).imageUrl;
}

async function setCover(imageUrl: string | null) {
  await prisma.album.update({ where: { id: albumId }, data: { imageUrl } });
}

const info = (over: Record<string, unknown> = {}) => ({
  slug: TAG,
  type: "single",
  originalTitle: `${TAG} album`,
  originalLanguage: "ja",
  ...over,
});

beforeAll(async () => {
  png = new Uint8Array(
    await sharp({ create: { width: 64, height: 64, channels: 3, background: "#245cce" } })
      .png()
      .toBuffer(),
  );
  storage = new MemoryImageStorage("itest", BASE);
  h.storage = storage;
  const album = await prisma.album.create({
    data: { slug: TAG, type: "single", originalTitle: `${TAG} album`, imageUrl: EXTERNAL },
  });
  albumId = album.id;
});

afterAll(async () => {
  if (albumId) await prisma.album.delete({ where: { id: albumId } });
  await prisma.imageAsset.deleteMany({ where: { publicUrl: { startsWith: BASE } } });
  expect(await prisma.album.count({ where: { slug: TAG } })).toBe(0);
  expect(await prisma.imageAsset.count({ where: { publicUrl: { startsWith: BASE } } })).toBe(0);
});

describe("album info PATCH and the cover", () => {
  it("an info edit without imageUrl keeps the existing external cover", async () => {
    await setCover(EXTERNAL);
    const res = await PATCH(json("PATCH", url(), info({ labelName: "Lantis" })), params());
    expect(res.status).toBe(200);
    expect(await cover()).toBe(EXTERNAL);
    // positive control: the info field itself was written
    expect((await prisma.album.findUniqueOrThrow({ where: { id: albumId } })).labelName).toBe("Lantis");
  });

  it("imageUrl without the expected value is refused, not written blindly", async () => {
    await setCover(EXTERNAL_B);
    const res = await PATCH(json("PATCH", url(), info({ imageUrl: EXTERNAL, labelName: "stale" })), params());
    expect(res.status).toBe(400);
    expect(await cover()).toBe(EXTERNAL_B);
    expect((await prisma.album.findUniqueOrThrow({ where: { id: albumId } })).labelName).toBe("Lantis");
  });

  it("a stale expected cover rolls back every field of the request (real transaction)", async () => {
    await setCover(EXTERNAL_B);
    const res = await PATCH(
      json("PATCH", url(), info({ labelName: "should-not-stick", imageUrl: null, expectedImageUrl: EXTERNAL })),
      params(),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ code: "assignment_conflict", current: { imageUrl: EXTERNAL_B } });
    expect(await cover()).toBe(EXTERNAL_B);
    expect((await prisma.album.findUniqueOrThrow({ where: { id: albumId } })).labelName).toBe("Lantis");
  });

  it("a matching expected cover is written together with the info fields", async () => {
    await setCover(EXTERNAL_B);
    const res = await PATCH(
      json("PATCH", url(), info({ labelName: "Lantis", imageUrl: ` ${EXTERNAL} `, expectedImageUrl: EXTERNAL_B })),
      params(),
    );
    expect(res.status).toBe(200);
    expect(await cover()).toBe(EXTERNAL);
  });

  it("a non-string imageUrl is a 400, not an unlink", async () => {
    await setCover(EXTERNAL);
    const res = await PATCH(json("PATCH", url(), info({ imageUrl: 42, expectedImageUrl: EXTERNAL })), params());
    expect(res.status).toBe(400);
    expect(await cover()).toBe(EXTERNAL);
  });
});

describe("cover route — URL edit and unlink", () => {
  it("replaces the URL, unlinks to null, and nothing brings the old URL back", async () => {
    await setCover(EXTERNAL);
    vi.mocked(revalidatePublicData).mockClear();
    let res = await PUT(json("PUT", url("/cover"), { expectedImageUrl: EXTERNAL, imageUrl: EXTERNAL_B }), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ imageUrl: EXTERNAL_B, provenance: null });
    expect(revalidatePublicData).toHaveBeenCalled();

    res = await PUT(json("PUT", url("/cover"), { expectedImageUrl: EXTERNAL_B, imageUrl: null }), params());
    expect(res.status).toBe(200);
    expect(await cover()).toBeNull();

    // An unrelated info save afterwards leaves it empty.
    res = await PATCH(json("PATCH", url(), info({ labelName: "Lantis" })), params());
    expect(res.status).toBe(200);
    expect(await cover()).toBeNull();
  });

  it("a stale expected value is 409 with the current value; the cover is untouched", async () => {
    await setCover(EXTERNAL_B);
    const res = await PUT(json("PUT", url("/cover"), { expectedImageUrl: EXTERNAL, imageUrl: null }), params());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "assignment_conflict",
      outcome: "conflict",
      current: { imageUrl: EXTERNAL_B },
    });
    expect(await cover()).toBe(EXTERNAL_B);
  });

  it("two saves from the same loaded value: exactly one wins", async () => {
    await setCover(EXTERNAL);
    const [a, b] = await Promise.all([
      PUT(json("PUT", url("/cover"), { expectedImageUrl: EXTERNAL, imageUrl: EXTERNAL_B }), params()),
      PUT(json("PUT", url("/cover"), { expectedImageUrl: EXTERNAL, imageUrl: null }), params()),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? EXTERNAL_B : null;
    expect(await cover()).toBe(winner);
  });

  it("validates the request: missing expected, bad URL, cross origin", async () => {
    await setCover(EXTERNAL);
    expect((await PUT(json("PUT", url("/cover"), { imageUrl: null }), params())).status).toBe(400);
    expect(
      (await PUT(json("PUT", url("/cover"), { expectedImageUrl: EXTERNAL, imageUrl: "javascript:alert(1)" }), params()))
        .status,
    ).toBe(400);
    expect(
      (
        await PUT(
          json("PUT", url("/cover"), { expectedImageUrl: EXTERNAL, imageUrl: null }, { origin: "https://evil.example" }),
          params(),
        )
      ).status,
    ).toBe(403);
    expect(await cover()).toBe(EXTERNAL);
  });
});

describe("cover route — upload and re-read", () => {
  it("URL → upload → URL: managed URL assigned, provenance by exact URL, asset row retained after replacement", async () => {
    await setCover(EXTERNAL);
    const attemptId = randomUUID();
    let res = await POST(
      upload({ attemptId, expectedImageUrl: EXTERNAL, sourceUrl: "https://example.com/src", usageNote: "itest" }),
      params(),
    );
    expect(res.status).toBe(201);
    const managed = (await res.json()).asset.publicUrl as string;
    expect(managed.startsWith(BASE)).toBe(true);
    expect(await cover()).toBe(managed);

    res = await GET(new NextRequest(url(`/cover?attemptId=${attemptId}`)), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      imageUrl: managed,
      provenance: { sourceUrl: "https://example.com/src", usageNote: "itest", width: 64, height: 64 },
      attempt: { state: "committed", publicUrl: managed },
    });

    // Same attempt again (e.g. after a lost reply): reconciled, no second write.
    res = await POST(upload({ attemptId, expectedImageUrl: EXTERNAL }), params());
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("reconciled");

    res = await PUT(json("PUT", url("/cover"), { expectedImageUrl: managed, imageUrl: EXTERNAL_B }), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ imageUrl: EXTERNAL_B, provenance: null });
    expect(await prisma.imageAsset.count({ where: { publicUrl: managed } })).toBe(1);

    // The committed attempt is now superseded: re-read says so, a resend
    // must not take the assignment back.
    res = await GET(new NextRequest(url(`/cover?attemptId=${attemptId}`)), params());
    expect(await res.json()).toMatchObject({ imageUrl: EXTERNAL_B, attempt: { state: "committed" } });
    res = await POST(upload({ attemptId, expectedImageUrl: EXTERNAL }), params());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ attemptCommitted: true });
    expect(await cover()).toBe(EXTERNAL_B);
  });

  it("an external URL never inherits provenance; an unknown attempt reads as absent", async () => {
    await setCover(EXTERNAL);
    const res = await GET(new NextRequest(url(`/cover?attemptId=${randomUUID()}`)), params());
    expect(await res.json()).toMatchObject({ imageUrl: EXTERNAL, provenance: null, attempt: { state: "absent" } });
  });

  it("a stale upload is 409 and stores nothing", async () => {
    await setCover(EXTERNAL_B);
    const before = storage.puts.length;
    const res = await POST(upload({ attemptId: randomUUID(), expectedImageUrl: EXTERNAL }), params());
    expect(res.status).toBe(409);
    expect(storage.puts.length).toBe(before);
    expect(await cover()).toBe(EXTERNAL_B);
  });

  it("GET of a missing album is 404; a malformed attempt id is 400", async () => {
    const missing = { params: Promise.resolve({ id: "9223372036854775806" }) };
    expect((await GET(new NextRequest(`${ORIGIN}/api/admin/albums/9223372036854775806/cover`), missing)).status).toBe(
      404,
    );
    expect((await GET(new NextRequest(url("/cover?attemptId=nope")), params())).status).toBe(400);
  });
});

describe("non-upload write outcomes", () => {
  it("failure inside the transaction is not_saved and leaves the cover; failure after it is unknown", async () => {
    await setCover(EXTERNAL);
    const target = albumCoverTarget(albumId);

    const preCommit = writeAssignment(target, async () => {
      throw new Error("db down");
    });
    await expect(preCommit).rejects.toMatchObject({ code: "not_saved" });
    expect(await cover()).toBe(EXTERNAL);

    // Commits for real, then the reply is "lost".
    const lostReply: AssignmentDb = {
      $transaction: (async (fn: never, opts: never) => {
        await prisma.$transaction(fn, opts);
        throw new Error("connection reset");
      }) as never,
    };
    const lost = writeAssignment(
      target,
      (tx) => writeAlbumImageUrl(tx, albumId, { imageUrl: EXTERNAL }, EXTERNAL_B),
      lostReply,
    );
    await expect(lost).rejects.toBeInstanceOf(UploadError);
    await expect(lost).rejects.toMatchObject({ code: "outcome_unknown", outcome: "unknown" });
    // The form's re-read then finds the requested value in place.
    const res = await GET(new NextRequest(url("/cover")), params());
    expect((await res.json()).imageUrl).toBe(EXTERNAL_B);
  });
});

describe("CSV import keeps covers", () => {
  it("re-importing an existing album row leaves imageUrl untouched", async () => {
    await setCover(EXTERNAL);
    const csv = `slug,originalTitle,originalLanguage,type,labelName\n${TAG},${TAG} album,ja,single,Lantis\n`;
    const res = await IMPORT_POST(json("POST", `${ORIGIN}/api/admin/import`, { type: "albums", csv }));
    expect(res.status).toBe(200);
    expect(await cover()).toBe(EXTERNAL);
  });
});
