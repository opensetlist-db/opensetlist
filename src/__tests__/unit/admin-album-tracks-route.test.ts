import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/admin-auth", () => ({
  verifyAdminAPI: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    albumTrack: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findUnique: vi.fn(),
    },
    albumTrackTranslation: {
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { POST } from "@/app/api/admin/album-tracks/route";
import { PATCH } from "@/app/api/admin/album-tracks/[id]/route";
import { prisma } from "@/lib/prisma";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { Prisma } from "@/generated/prisma/client";

const verifyMock = verifyAdminAPI as ReturnType<typeof vi.fn>;

import { jsonRequest } from "../helpers/requestFactory";

describe("POST /api/admin/album-tracks — pattern dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyMock.mockResolvedValue(null);
    (prisma.albumTrack.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "uuid-1",
      translations: [],
    });
  });

  it("returns 401 without admin session", async () => {
    verifyMock.mockResolvedValue(
      Response.json({ error: "unauthorized" }, { status: 401 }),
    );
    const res = await POST(
      jsonRequest("http://x/api/admin/album-tracks", {
        pattern: "vocal",
        albumId: 1,
        discNumber: 1,
        trackNumber: 1,
        songId: 5,
      }) as never,
    );
    expect(res.status).toBe(401);
  });

  it("Pattern 1 (vocal) accepts a Song connect", async () => {
    const res = await POST(
      jsonRequest("http://x/api/admin/album-tracks", {
        pattern: "vocal",
        albumId: 1,
        discNumber: 1,
        trackNumber: 1,
        songId: 5,
      }) as never,
    );
    expect(res.status).toBe(201);
    const call = (prisma.albumTrack.create as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(call.data.song.connect.id).toBe(BigInt(5));
  });

  it("Pattern 2 rejects a Pattern-3 variant value", async () => {
    const res = await POST(
      jsonRequest("http://x/api/admin/album-tracks", {
        pattern: "off_vocal_w_parent",
        albumId: 1,
        discNumber: 1,
        trackNumber: 1,
        parentSongId: 7,
        variant: "drama", // wrong allowlist
      }) as never,
    );
    expect(res.status).toBe(400);
    expect(prisma.albumTrack.create).not.toHaveBeenCalled();
  });

  it("Pattern 2 rejects missing parentSongId", async () => {
    const res = await POST(
      jsonRequest("http://x/api/admin/album-tracks", {
        pattern: "off_vocal_w_parent",
        albumId: 1,
        discNumber: 1,
        trackNumber: 1,
        variant: "off-vocal",
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("Pattern 3 rejects a Pattern-2 variant value", async () => {
    const res = await POST(
      jsonRequest("http://x/api/admin/album-tracks", {
        pattern: "direct",
        albumId: 1,
        discNumber: 1,
        trackNumber: 1,
        variant: "instrumental", // wrong allowlist
        title: "Drama 1",
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("Pattern 3 accepts drama with translations", async () => {
    const res = await POST(
      jsonRequest("http://x/api/admin/album-tracks", {
        pattern: "direct",
        albumId: 1,
        discNumber: 1,
        trackNumber: 1,
        variant: "drama",
        title: "ドラマパート",
        titleLanguage: "ja",
        translations: [{ locale: "ko", title: "드라마 파트" }],
      }) as never,
    );
    expect(res.status).toBe(201);
    const call = (prisma.albumTrack.create as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(call.data.variant).toBe("drama");
    expect(call.data.translations.create).toEqual([
      { locale: "ko", title: "드라마 파트" },
    ]);
  });

  it("returns 409 on (album, disc, track) collision", async () => {
    (prisma.albumTrack.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    const res = await POST(
      jsonRequest("http://x/api/admin/album-tracks", {
        pattern: "vocal",
        albumId: 1,
        discNumber: 1,
        trackNumber: 1,
        songId: 5,
      }) as never,
    );
    expect(res.status).toBe(409);
  });
});

describe("PATCH /api/admin/album-tracks/[id] — pattern transitions", () => {
  const params = Promise.resolve({ id: "track-uuid" });

  beforeEach(() => {
    vi.clearAllMocks();
    verifyMock.mockResolvedValue(null);
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: typeof prisma) => unknown) => fn(prisma),
    );
    (prisma.albumTrack.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      { id: "track-uuid" },
    );
    (prisma.albumTrack.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "track-uuid",
      translations: [],
    });
  });

  it("wipes translations + clears stale columns when moving to Pattern 1", async () => {
    const res = await PATCH(
      jsonRequest(
        "http://x/api/admin/album-tracks/track-uuid",
        {
          pattern: "vocal",
          discNumber: 1,
          trackNumber: 3,
          songId: 99,
        },
        "PATCH",
      ) as never,
      { params },
    );
    expect(res.status).toBe(200);

    expect(
      prisma.albumTrackTranslation.deleteMany,
    ).toHaveBeenCalledWith({ where: { albumTrackId: "track-uuid" } });

    const updateCall = (prisma.albumTrack.update as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    expect(updateCall.data.parentSong).toEqual({ disconnect: true });
    expect(updateCall.data.variant).toBeNull();
    expect(updateCall.data.title).toBeNull();
    expect(updateCall.data.titleLanguage).toBeNull();
  });

  it("disconnects song + clears title when moving to Pattern 2", async () => {
    const res = await PATCH(
      jsonRequest(
        "http://x/api/admin/album-tracks/track-uuid",
        {
          pattern: "off_vocal_w_parent",
          discNumber: 1,
          trackNumber: 2,
          variant: "off-vocal",
          parentSongId: 42,
        },
        "PATCH",
      ) as never,
      { params },
    );
    expect(res.status).toBe(200);
    const updateCall = (prisma.albumTrack.update as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    expect(updateCall.data.song).toEqual({ disconnect: true });
    expect(updateCall.data.title).toBeNull();
    expect(updateCall.data.variant).toBe("off-vocal");
  });

  it("preserves AlbumTrackTranslation rows when Pattern 3 PATCH omits translations", async () => {
    // CR finding: a thin curl that just adjusts the title of a
    // drama/bgm track shouldn't wipe the operator's ko/ja overrides.
    const res = await PATCH(
      jsonRequest(
        "http://x/api/admin/album-tracks/track-uuid",
        {
          pattern: "direct",
          discNumber: 1,
          trackNumber: 1,
          variant: "drama",
          title: "Drama Update",
          // translations intentionally omitted
        },
        "PATCH",
      ) as never,
      { params },
    );
    expect(res.status).toBe(200);
    expect(prisma.albumTrackTranslation.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects 400 when Pattern 3 translations is non-array (CR follow-up)", async () => {
    const res = await PATCH(
      jsonRequest(
        "http://x/api/admin/album-tracks/track-uuid",
        {
          pattern: "direct",
          discNumber: 1,
          trackNumber: 1,
          variant: "drama",
          title: "Drama Update",
          translations: { ko: "wrong shape" },
        },
        "PATCH",
      ) as never,
      { params },
    );
    expect(res.status).toBe(400);
    expect(prisma.albumTrackTranslation.deleteMany).not.toHaveBeenCalled();
    expect(prisma.albumTrack.update).not.toHaveBeenCalled();
  });

  it("wipes Pattern 3 translations when caller supplies an empty array", async () => {
    const res = await PATCH(
      jsonRequest(
        "http://x/api/admin/album-tracks/track-uuid",
        {
          pattern: "direct",
          discNumber: 1,
          trackNumber: 1,
          variant: "drama",
          title: "Drama Update",
          translations: [],
        },
        "PATCH",
      ) as never,
      { params },
    );
    expect(res.status).toBe(200);
    expect(prisma.albumTrackTranslation.deleteMany).toHaveBeenCalledWith({
      where: { albumTrackId: "track-uuid" },
    });
  });

  it("returns 404 when target track is missing", async () => {
    (
      prisma.albumTrack.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);
    const res = await PATCH(
      jsonRequest(
        "http://x/api/admin/album-tracks/track-uuid",
        {
          pattern: "vocal",
          discNumber: 1,
          trackNumber: 1,
          songId: 5,
        },
        "PATCH",
      ) as never,
      { params },
    );
    expect(res.status).toBe(404);
  });
});
