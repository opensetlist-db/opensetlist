import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/admin-auth", () => ({
  verifyAdminAPI: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    album: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    albumTranslation: {
      deleteMany: vi.fn(),
    },
    albumArtist: {
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { PATCH } from "@/app/api/admin/albums/[id]/route";
import { prisma } from "@/lib/prisma";
import { verifyAdminAPI } from "@/lib/admin-auth";

const verifyMock = verifyAdminAPI as ReturnType<typeof vi.fn>;
const params = Promise.resolve({ id: "42" });

import { jsonRequest as baseJsonRequest } from "../helpers/requestFactory";

// Albums admin currently exposes only PATCH from this route file
// (no POST — albums come from CSV import). Local wrapper sets the
// method default while still routing through the shared factory.
const jsonRequest = (url: string, body: unknown) =>
  baseJsonRequest(url, body, "PATCH");

const baseBody = {
  slug: "test-album",
  type: "album",
  originalTitle: "Test",
  originalLanguage: "ja",
};

describe("PATCH /api/admin/albums/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyMock.mockResolvedValue(null);
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: typeof prisma) => unknown) => fn(prisma),
    );
    (prisma.album.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BigInt(42),
    });
    (prisma.album.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BigInt(42),
      translations: [],
      artists: [],
    });
  });

  it("rejects a request whose artistIds contain a non-parseable entry (CR finding)", async () => {
    // Previously the bad entry was silently dropped, then deleteMany
    // would wipe the existing AlbumArtist rows and only re-create the
    // valid ones — silent data loss.
    const res = await PATCH(
      jsonRequest("http://x/api/admin/albums/42", {
        ...baseBody,
        artistIds: [1, "abc", 3],
      }) as never,
      { params },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("아티스트");
    // Critically: nothing destructive ran.
    expect(prisma.albumArtist.deleteMany).not.toHaveBeenCalled();
    expect(prisma.album.update).not.toHaveBeenCalled();
  });

  it("preserves translations when body omits the field (CR finding)", async () => {
    const res = await PATCH(
      jsonRequest("http://x/api/admin/albums/42", baseBody) as never,
      { params },
    );
    expect(res.status).toBe(200);
    expect(prisma.albumTranslation.deleteMany).not.toHaveBeenCalled();
    const updateCall = (prisma.album.update as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(updateCall.data.translations).toBeUndefined();
  });

  it("preserves AlbumArtist links when body omits artistIds", async () => {
    const res = await PATCH(
      jsonRequest("http://x/api/admin/albums/42", baseBody) as never,
      { params },
    );
    expect(res.status).toBe(200);
    expect(prisma.albumArtist.deleteMany).not.toHaveBeenCalled();
    const updateCall = (prisma.album.update as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(updateCall.data.artists).toBeUndefined();
  });

  it("rejects 400 when translations is non-array (CR follow-up)", async () => {
    const res = await PATCH(
      jsonRequest("http://x/api/admin/albums/42", {
        ...baseBody,
        translations: { ko: "wrong shape" },
      }) as never,
      { params },
    );
    expect(res.status).toBe(400);
    expect(prisma.albumTranslation.deleteMany).not.toHaveBeenCalled();
    expect(prisma.album.update).not.toHaveBeenCalled();
  });

  it("full-replaces translations when body sends an empty array", async () => {
    const res = await PATCH(
      jsonRequest("http://x/api/admin/albums/42", {
        ...baseBody,
        translations: [],
      }) as never,
      { params },
    );
    expect(res.status).toBe(200);
    expect(prisma.albumTranslation.deleteMany).toHaveBeenCalledWith({
      where: { albumId: BigInt(42) },
    });
  });

  it("full-replaces artistIds when body sends an empty array", async () => {
    const res = await PATCH(
      jsonRequest("http://x/api/admin/albums/42", {
        ...baseBody,
        artistIds: [],
      }) as never,
      { params },
    );
    expect(res.status).toBe(200);
    expect(prisma.albumArtist.deleteMany).toHaveBeenCalledWith({
      where: { albumId: BigInt(42) },
    });
  });
});
