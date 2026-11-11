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
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

import { POST } from "@/app/api/admin/album-tracks/route";
import { PATCH } from "@/app/api/admin/album-tracks/[id]/route";
import { prisma } from "@/lib/prisma";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { Prisma } from "@/generated/prisma/client";
import { trackTitleSnapshot } from "@/lib/albumTrackTitleValidation";

const verifyMock = verifyAdminAPI as ReturnType<typeof vi.fn>;

import { jsonRequest } from "../helpers/requestFactory";

const drama = {
  pattern: "direct",
  albumId: 1,
  discNumber: 1,
  trackNumber: 1,
  variant: "drama",
  title: "ドラマパート",
  titleLanguage: "ja",
};

const dramaTranslations = [
  { locale: "ko", title: "드라마 파트" },
  { locale: "en", title: "Drama Part" },
];

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
    const res = await POST(jsonRequest("http://x/api/admin/album-tracks", {
      ...drama,
      translations: dramaTranslations,
    }) as never);
    expect(res.status).toBe(201);
    const call = (prisma.albumTrack.create as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(call.data.variant).toBe("drama");
    expect(call.data.translations.create).toEqual(dramaTranslations);

    vi.mocked(prisma.albumTrack.create).mockClear();
    const missing = await POST(jsonRequest("http://x/api/admin/album-tracks", {
      ...drama,
      translations: dramaTranslations.slice(0, 1),
    }) as never);
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: expect.stringContaining("en 표기 누락") });
    expect(prisma.albumTrack.create).not.toHaveBeenCalled();
  });

  it("allows Latin titles, but a symbolic title needs a sourced locale decision", async () => {
    const create = (data: Record<string, unknown>) => POST(
      jsonRequest("http://x/api/admin/album-tracks", { ...drama, ...data }) as never,
    );
    expect((await create({ title: "ＢＧＭ 1！" })).status).toBe(201);
    const title = "？？？";
    const missing = await create({ title });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: expect.stringContaining("기호 제목") });
    const translations = ["ko", "en"].map((locale) => ({ locale, title }));
    expect((await create({ title, translations })).status).toBe(400);
    expect((await create({ title, translations, confirmedSameLocales: ["ko", "en"] })).status).toBe(201);
    expect(prisma.albumTrack.create).toHaveBeenCalledTimes(2);
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
      {
        id: "track-uuid",
        songId: null,
        parentSongId: null,
        variant: "drama",
        title: drama.title,
        titleLanguage: "ja",
        translations: dramaTranslations,
      },
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
          title: "ドラマパート更新",
          // translations intentionally omitted
        },
        "PATCH",
      ) as never,
      { params },
    );
    expect(res.status).toBe(200);
    expect(prisma.albumTrackTranslation.deleteMany).not.toHaveBeenCalled();
  });

  it("allows reordering an incomplete legacy row and rejects removal from a complete row before writing", async () => {
    const patch = (fields: Record<string, unknown>) => PATCH(
      jsonRequest("http://x/api/admin/album-tracks/track-uuid", {
        pattern: "direct", variant: "drama", discNumber: 2, trackNumber: 4,
        ...fields,
      }, "PATCH") as never,
      { params },
    );
    const findUnique = vi.mocked(prisma.albumTrack.findUnique);
    const existing = await findUnique({ where: { id: "track-uuid" } });
    findUnique.mockResolvedValueOnce({
      ...existing!,
      titleLanguage: null,
      translations: dramaTranslations.slice(0, 1),
    } as never);
    expect((await patch({})).status).toBe(200);
    expect(prisma.albumTrack.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ discNumber: 2, trackNumber: 4, title: undefined, titleLanguage: undefined }),
    }));

    vi.mocked(prisma.albumTrack.update).mockClear();
    const rejected = await patch({ translations: dramaTranslations.slice(0, 1) });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ error: expect.stringContaining("en 표기 누락") });
    expect(prisma.albumTrack.update).not.toHaveBeenCalled();
    expect(prisma.albumTrackTranslation.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects stale form snapshots before replacing title rows", async () => {
    const patch = (expectedTitleSnapshot: string) => PATCH(
      jsonRequest("http://x/api/admin/album-tracks/track-uuid", {
        ...drama,
        translations: [dramaTranslations[0], { locale: "en", title: "Mini Drama" }],
        expectedTitleSnapshot,
      }, "PATCH") as never,
      { params },
    );
    const snapshot = trackTitleSnapshot({ ...drama, translations: dramaTranslations.toReversed() });
    expect((await patch(snapshot)).status).toBe(200);
    expect(prisma.albumTrackTranslation.deleteMany).toHaveBeenCalled();

    vi.mocked(prisma.albumTrackTranslation.deleteMany).mockClear();
    vi.mocked(prisma.albumTrack.update).mockClear();
    expect((await patch(trackTitleSnapshot({ ...drama, translations: [] }))).status).toBe(409);
    expect(prisma.albumTrackTranslation.deleteMany).not.toHaveBeenCalled();
    expect(prisma.albumTrack.update).not.toHaveBeenCalled();
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
