import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/admin-auth", () => ({
  verifyAdminAPI: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    albumStoreListing: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findUnique: vi.fn(),
    },
    albumStoreListingTranslation: {
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { POST } from "@/app/api/admin/album-listings/route";
import {
  PATCH as PATCH_LISTING,
  DELETE as DELETE_LISTING,
} from "@/app/api/admin/album-listings/[id]/route";
import { prisma } from "@/lib/prisma";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { Prisma } from "@/generated/prisma/client";

const verifyMock = verifyAdminAPI as ReturnType<typeof vi.fn>;

function jsonRequest(url: string, body: unknown, method = "POST") {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// 2-state admin status per b03-b05-album-bonus-simplification-handoff:
// only `active` / `ended` are writable from the admin form.
const baseValid = {
  albumId: "1",
  originalStoreName: "amazon_jp",
  status: "active",
};

describe("POST /api/admin/album-listings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyMock.mockResolvedValue(null);
  });

  it("returns 401 without admin session", async () => {
    verifyMock.mockResolvedValue(
      Response.json({ error: "unauthorized" }, { status: 401 }),
    );
    const res = await POST(
      jsonRequest("http://x/api/admin/album-listings", baseValid) as never,
    );
    expect(res.status).toBe(401);
    expect(prisma.albumStoreListing.create).not.toHaveBeenCalled();
  });

  it("returns 400 when albumId is missing", async () => {
    const res = await POST(
      jsonRequest("http://x/api/admin/album-listings", {
        originalStoreName: "amazon_jp",
        status: "active",
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when storeName is empty", async () => {
    const res = await POST(
      jsonRequest("http://x/api/admin/album-listings", {
        ...baseValid,
        originalStoreName: "  ",
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 on unknown status value", async () => {
    const res = await POST(
      jsonRequest("http://x/api/admin/album-listings", {
        ...baseValid,
        status: "garbage",
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when status is sold_out (admin form is 2-state)", async () => {
    // Schema enum still has sold_out, but the admin write path
    // intentionally only allows active/ended. A client that POSTs
    // sold_out hits the 400 path rather than silently succeeding.
    const res = await POST(
      jsonRequest("http://x/api/admin/album-listings", {
        ...baseValid,
        status: "sold_out",
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when status is unknown (admin form is 2-state)", async () => {
    const res = await POST(
      jsonRequest("http://x/api/admin/album-listings", {
        ...baseValid,
        status: "unknown",
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("returns 409 with operator-readable Korean body on unique conflict", async () => {
    (prisma.albumStoreListing.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    const res = await POST(
      jsonRequest("http://x/api/admin/album-listings", baseValid) as never,
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("동일 에디션");
  });

  it("creates listing with empty productUrl as null", async () => {
    (prisma.albumStoreListing.create as ReturnType<typeof vi.fn>).mockResolvedValue(
      { id: "uuid-1", albumId: BigInt(1), originalStoreName: "amazon_jp" },
    );
    const res = await POST(
      jsonRequest("http://x/api/admin/album-listings", {
        ...baseValid,
        productUrl: "",
      }) as never,
    );
    expect(res.status).toBe(201);
    const call = (prisma.albumStoreListing.create as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    expect(call.data.productUrl).toBeNull();
  });

  it("does NOT set the dropped lifecycle columns on create", async () => {
    // The handoff drops sourceUrl/startsAt/endsAt/lastVerifiedAt from
    // the admin form. A POST that omits them shouldn't end up writing
    // any of those keys — Prisma's default-null handles the schema
    // side, and we want to confirm the route isn't sneaking them in.
    (prisma.albumStoreListing.create as ReturnType<typeof vi.fn>).mockResolvedValue(
      { id: "uuid-1", albumId: BigInt(1), originalStoreName: "amazon_jp" },
    );
    await POST(
      jsonRequest("http://x/api/admin/album-listings", baseValid) as never,
    );
    const call = (prisma.albumStoreListing.create as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    expect("sourceUrl" in call.data).toBe(false);
    expect("startsAt" in call.data).toBe(false);
    expect("endsAt" in call.data).toBe(false);
    expect("lastVerifiedAt" in call.data).toBe(false);
  });
});

describe("PATCH /api/admin/album-listings/[id]", () => {
  const params = Promise.resolve({ id: "list-uuid" });

  beforeEach(() => {
    vi.clearAllMocks();
    verifyMock.mockResolvedValue(null);
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: typeof prisma) => unknown) => fn(prisma),
    );
  });

  it("returns 401 without admin session", async () => {
    verifyMock.mockResolvedValue(
      Response.json({ error: "unauthorized" }, { status: 401 }),
    );
    const res = await PATCH_LISTING(
      jsonRequest("http://x/api/admin/album-listings/list-uuid", baseValid, "PATCH") as never,
      { params },
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 when listing not found", async () => {
    (
      prisma.albumStoreListing.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);
    const res = await PATCH_LISTING(
      jsonRequest("http://x/api/admin/album-listings/list-uuid", baseValid, "PATCH") as never,
      { params },
    );
    expect(res.status).toBe(404);
    expect(
      prisma.albumStoreListingTranslation.deleteMany,
    ).not.toHaveBeenCalled();
  });

  it("replaces translations delete-then-create on update", async () => {
    (
      prisma.albumStoreListing.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: "list-uuid" });
    (prisma.albumStoreListing.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "list-uuid",
      translations: [],
    });
    const res = await PATCH_LISTING(
      jsonRequest(
        "http://x/api/admin/album-listings/list-uuid",
        {
          ...baseValid,
          translations: [{ locale: "ko", storeName: "아마존 재팬", editionLabel: null }],
        },
        "PATCH",
      ) as never,
      { params },
    );
    expect(res.status).toBe(200);
    expect(
      prisma.albumStoreListingTranslation.deleteMany,
    ).toHaveBeenCalledWith({ where: { listingId: "list-uuid" } });
    const updateCall = (
      prisma.albumStoreListing.update as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(updateCall.data.translations.create).toEqual([
      { locale: "ko", storeName: "아마존 재팬", editionLabel: null },
    ]);
  });

  it("does NOT touch the dropped lifecycle columns on update", async () => {
    // Per the handoff, PATCH must preserve pre-existing values in
    // sourceUrl/startsAt/endsAt/lastVerifiedAt that may have been
    // set by CSV import or an earlier UI iteration.
    (
      prisma.albumStoreListing.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: "list-uuid" });
    (prisma.albumStoreListing.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "list-uuid",
      translations: [],
    });
    await PATCH_LISTING(
      jsonRequest("http://x/api/admin/album-listings/list-uuid", baseValid, "PATCH") as never,
      { params },
    );
    const updateCall = (
      prisma.albumStoreListing.update as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect("sourceUrl" in updateCall.data).toBe(false);
    expect("startsAt" in updateCall.data).toBe(false);
    expect("endsAt" in updateCall.data).toBe(false);
    expect("lastVerifiedAt" in updateCall.data).toBe(false);
  });

  it("preserves existing translations when body omits the field", async () => {
    // CR finding: a thin client that PATCHes only the URL shouldn't
    // wipe per-locale labels.
    (
      prisma.albumStoreListing.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: "list-uuid" });
    (prisma.albumStoreListing.update as ReturnType<typeof vi.fn>).mockResolvedValue(
      { id: "list-uuid", translations: [] },
    );
    // baseValid does NOT include translations
    const res = await PATCH_LISTING(
      jsonRequest("http://x/api/admin/album-listings/list-uuid", baseValid, "PATCH") as never,
      { params },
    );
    expect(res.status).toBe(200);
    // The deleteMany of translations is the destructive step — must
    // be skipped when the field is missing.
    expect(
      prisma.albumStoreListingTranslation.deleteMany,
    ).not.toHaveBeenCalled();
    const updateCall = (
      prisma.albumStoreListing.update as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(updateCall.data.translations).toBeUndefined();
  });

  it("rejects 400 when translations is a non-array (CR follow-up)", async () => {
    // Without this guard, the parser falls through to [] and the
    // deleteMany silently wipes existing rows.
    (
      prisma.albumStoreListing.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: "list-uuid" });
    const res = await PATCH_LISTING(
      jsonRequest(
        "http://x/api/admin/album-listings/list-uuid",
        { ...baseValid, translations: "not-an-array" },
        "PATCH",
      ) as never,
      { params },
    );
    expect(res.status).toBe(400);
    expect(
      prisma.albumStoreListingTranslation.deleteMany,
    ).not.toHaveBeenCalled();
    expect(prisma.albumStoreListing.update).not.toHaveBeenCalled();
  });

  it("wipes translations on explicit empty array (full-replace)", async () => {
    // Distinguish "field missing" (preserve) from "[] supplied"
    // (full-replace clear).
    (
      prisma.albumStoreListing.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: "list-uuid" });
    (prisma.albumStoreListing.update as ReturnType<typeof vi.fn>).mockResolvedValue(
      { id: "list-uuid", translations: [] },
    );
    const res = await PATCH_LISTING(
      jsonRequest(
        "http://x/api/admin/album-listings/list-uuid",
        { ...baseValid, translations: [] },
        "PATCH",
      ) as never,
      { params },
    );
    expect(res.status).toBe(200);
    expect(
      prisma.albumStoreListingTranslation.deleteMany,
    ).toHaveBeenCalledWith({ where: { listingId: "list-uuid" } });
  });

  it("maps P2025 → 404 (concurrent DELETE race)", async () => {
    (
      prisma.albumStoreListing.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: "list-uuid" });
    (prisma.albumStoreListing.update as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("vanished", {
        code: "P2025",
        clientVersion: "test",
      }),
    );
    const res = await PATCH_LISTING(
      jsonRequest("http://x/api/admin/album-listings/list-uuid", baseValid, "PATCH") as never,
      { params },
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/admin/album-listings/[id]", () => {
  const params = Promise.resolve({ id: "list-uuid" });

  beforeEach(() => {
    vi.clearAllMocks();
    verifyMock.mockResolvedValue(null);
  });

  it("returns 404 when listing is missing (P2025)", async () => {
    (prisma.albumStoreListing.delete as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("not-found", {
        code: "P2025",
        clientVersion: "test",
      }),
    );
    const res = await DELETE_LISTING(
      jsonRequest("http://x/api/admin/album-listings/list-uuid", null, "DELETE") as never,
      { params },
    );
    expect(res.status).toBe(404);
  });
});
