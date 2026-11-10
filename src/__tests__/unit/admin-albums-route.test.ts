import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/admin-auth", () => ({
  verifyAdminAPI: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    album: {
      create: vi.fn(),
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
import { POST } from "@/app/api/admin/albums/route";
import { prisma } from "@/lib/prisma";
import { verifyAdminAPI } from "@/lib/admin-auth";

const verifyMock = verifyAdminAPI as ReturnType<typeof vi.fn>;
const params = Promise.resolve({ id: "42" });

import { jsonRequest as baseJsonRequest } from "../helpers/requestFactory";

const jsonRequest = (url: string, body: unknown) =>
  baseJsonRequest(url, body, "PATCH");

const baseBody = {
  slug: "test-album",
  type: "album",
  originalTitle: "Test",
  originalLanguage: "ja",
};
const storedTitle = {
  originalTitle: baseBody.originalTitle,
  originalLanguage: baseBody.originalLanguage,
  translations: [],
};

describe("POST /api/admin/albums", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyMock.mockResolvedValue(null);
  });

  it("rejects a mixed title with a missing public locale", async () => {
    const res = await POST(baseJsonRequest("http://x/api/admin/albums", {
      ...baseBody,
      originalTitle: "Say Good-Bye 涙",
      translations: [{ locale: "ko", title: "Say Good-Bye 눈물" }],
    }, "POST") as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "앨범 제목: en 표기 누락" });
    expect(prisma.album.create).not.toHaveBeenCalled();
  });

  it("accepts an exempt Roman title and returns the ID without rounding", async () => {
    vi.mocked(prisma.album.create).mockResolvedValueOnce({ id: BigInt("9007199254740993") } as never);
    const res = await POST(baseJsonRequest("http://x/api/admin/albums", baseBody, "POST") as never);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "9007199254740993" });
  });
});

describe("PATCH /api/admin/albums/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyMock.mockResolvedValue(null);
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: typeof prisma) => unknown) => fn(prisma),
    );
    (prisma.album.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BigInt(42),
      ...storedTitle,
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
    vi.mocked(prisma.album.findUnique).mockResolvedValueOnce({
      ...storedTitle,
      translations: [{ locale: "ko", title: "테스트" }],
    } as never);
    const res = await PATCH(
      jsonRequest("http://x/api/admin/albums/42", {
        ...baseBody,
        translations: [],
      }) as never,
      { params },
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(prisma.album.update).mock.calls[0][0].data.translations).toMatchObject({
      deleteMany: { locale: { in: ["ko"] } },
    });
  });

  it("preserves missing legacy translations on a date-only PATCH", async () => {
    vi.mocked(prisma.album.findUnique).mockResolvedValueOnce({
      ...storedTitle,
      originalTitle: "Say Good-Bye 涙",
    } as never);
    const res = await PATCH(jsonRequest("http://x/api/admin/albums/42", {
      releaseDate: "2026-11-25",
    }) as never, { params });
    expect(res.status).toBe(200);
    expect(prisma.albumTranslation.deleteMany).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.album.update).mock.calls[0][0].data.originalTitle).toBeUndefined();
  });

  it("rejects deletion of a required translation before any write", async () => {
    vi.mocked(prisma.album.findUnique).mockResolvedValueOnce({
      ...storedTitle,
      originalTitle: "Say Good-Bye 涙",
      translations: [
        { locale: "ko", title: "Say Good-Bye 눈물" },
        { locale: "en", title: "Say Good-Bye Namida" },
      ],
    } as never);
    const res = await PATCH(jsonRequest("http://x/api/admin/albums/42", {
      translations: [{ locale: "ko", title: "" }],
      releaseDate: null,
    }) as never, { params });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "앨범 제목: ko 표기 누락" });
    expect(prisma.albumTranslation.deleteMany).not.toHaveBeenCalled();
    expect(prisma.album.update).not.toHaveBeenCalled();
  });

  it("upserts the requested locale and preserves other translations", async () => {
    vi.mocked(prisma.album.findUnique).mockResolvedValueOnce({
      ...storedTitle,
      originalTitle: "Say Good-Bye 涙",
      translations: [
        { locale: "ko", title: "Say Good-Bye 눈물" },
        { locale: "en", title: "Old English title" },
      ],
    } as never);
    const res = await PATCH(jsonRequest("http://x/api/admin/albums/42", {
      translations: [{ locale: "en", title: "Say Good-Bye Namida" }],
    }) as never, { params });
    expect(res.status).toBe(200);
    expect(vi.mocked(prisma.album.update).mock.calls[0][0].data.translations).toMatchObject({
      deleteMany: { locale: { in: [] } },
      upsert: [{ update: { title: "Say Good-Bye Namida" } }],
    });
  });

  it("requires the translations to be explicitly submitted again when changing the original", async () => {
    vi.mocked(prisma.album.findUnique).mockResolvedValueOnce({
      ...storedTitle,
      originalTitle: "旧題",
      translations: [
        { locale: "ko", title: "이전 제목" },
        { locale: "en", title: "Previous title" },
      ],
    } as never);
    const res = await PATCH(jsonRequest("http://x/api/admin/albums/42", {
      originalTitle: "新題",
    }) as never, { params });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("ko 기존 표기 재검수");
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

describe("PATCH /api/admin/albums/[id] — cover handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyMock.mockResolvedValue(null);
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: typeof prisma) => unknown) => fn(prisma),
    );
    (prisma.album.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: BigInt(42), ...storedTitle });
    (prisma.album.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: BigInt(42), translations: [] });
  });

  it("an info edit that omits imageUrl never writes the cover", async () => {
    const res = await PATCH(jsonRequest("http://x/api/admin/albums/42", baseBody) as never, { params });
    expect(res.status).toBe(200);
    const data = (prisma.album.update as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect("imageUrl" in data).toBe(false);
  });

  it("imageUrl without expectedImageUrl is a 400 before any write (old form tab)", async () => {
    const res = await PATCH(
      jsonRequest("http://x/api/admin/albums/42", { ...baseBody, imageUrl: "https://example.com/a.jpg" }) as never,
      { params },
    );
    expect(res.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.album.update).not.toHaveBeenCalled();
  });
});

