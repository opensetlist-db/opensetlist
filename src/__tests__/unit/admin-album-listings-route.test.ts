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
import { POST as POST_TOUCH } from "@/app/api/admin/album-listings/[id]/touch/route";
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

  it("returns 400 on malformed date", async () => {
    const res = await POST(
      jsonRequest("http://x/api/admin/album-listings", {
        ...baseValid,
        startsAt: "not-a-date",
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

describe("POST /api/admin/album-listings/[id]/touch", () => {
  const params = Promise.resolve({ id: "list-uuid" });

  beforeEach(() => {
    vi.clearAllMocks();
    verifyMock.mockResolvedValue(null);
  });

  it("sets lastVerifiedAt close to the current instant", async () => {
    const before = Date.now();
    (prisma.albumStoreListing.update as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { data: { lastVerifiedAt: Date } }) => ({
        id: "list-uuid",
        lastVerifiedAt: args.data.lastVerifiedAt,
      }),
    );
    const res = await POST_TOUCH(
      jsonRequest("http://x/api/admin/album-listings/list-uuid/touch", null, "POST") as never,
      { params },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const updatedAt = new Date(body.lastVerifiedAt).getTime();
    expect(updatedAt).toBeGreaterThanOrEqual(before);
    expect(updatedAt).toBeLessThanOrEqual(Date.now() + 50);
  });
});
