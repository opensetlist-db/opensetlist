import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    event: {
      findFirst: vi.fn(),
    },
    song: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    songWish: {
      groupBy: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { GET, POST } from "@/app/api/events/[id]/wishes/route";
import { DELETE } from "@/app/api/events/[id]/wishes/[wishId]/route";
import { prisma } from "@/lib/prisma";

function postRequest(body: unknown) {
  return new Request("http://localhost/api/events/1/wishes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getRequest(url = "http://localhost/api/events/1/wishes") {
  return new Request(url);
}

const params1 = Promise.resolve({ id: "1" });

describe("POST /api/events/[id]/wishes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.event.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BigInt(1),
    });
    (prisma.song.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BigInt(42),
    });
    (prisma.songWish.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "wish-uuid-1",
      songId: BigInt(42),
    });
  });

  it("happy path: creates a wish and returns { id, songId }", async () => {
    const res = await POST(
      postRequest({ songId: 42 }) as never,
      { params: params1 },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: "wish-uuid-1", songId: 42 });
    expect(prisma.songWish.create).toHaveBeenCalledWith({
      data: { eventId: BigInt(1), songId: BigInt(42) },
      select: { id: true, songId: true },
    });
  });

  it("rejects literal null body with 400 (no Prisma call)", async () => {
    const res = await POST(
      new Request("http://localhost/api/events/1/wishes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "null",
      }) as never,
      { params: params1 },
    );
    expect(res.status).toBe(400);
    expect(prisma.songWish.create).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON body with 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/events/1/wishes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }) as never,
      { params: params1 },
    );
    expect(res.status).toBe(400);
    expect(prisma.songWish.create).not.toHaveBeenCalled();
  });

  it.each([
    ["non-number songId (string)", { songId: "42" }],
    ["non-integer songId", { songId: 1.5 }],
    ["zero songId", { songId: 0 }],
    ["negative songId", { songId: -1 }],
    ["NaN songId", { songId: NaN }],
    ["missing songId", {}],
  ])("rejects invalid input (%s) with 400", async (_label, body) => {
    const res = await POST(postRequest(body) as never, { params: params1 });
    expect(res.status).toBe(400);
    expect(prisma.songWish.create).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid eventId path segment (non-bigint string)", async () => {
    const res = await POST(postRequest({ songId: 42 }) as never, {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(res.status).toBe(400);
    expect(prisma.songWish.create).not.toHaveBeenCalled();
  });

  it("returns 404 when event is missing (or soft-deleted)", async () => {
    (prisma.event.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      null,
    );
    const res = await POST(postRequest({ songId: 42 }) as never, {
      params: params1,
    });
    expect(res.status).toBe(404);
    expect(prisma.songWish.create).not.toHaveBeenCalled();
  });

  it("returns 404 when song is missing (or soft-deleted)", async () => {
    (prisma.song.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      null,
    );
    const res = await POST(postRequest({ songId: 42 }) as never, {
      params: params1,
    });
    expect(res.status).toBe(404);
    expect(prisma.songWish.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/events/[id]/wishes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns top3 with song display payloads, ordered by count desc", async () => {
    (prisma.songWish.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
      { songId: BigInt(10), _count: { _all: 24 } },
      { songId: BigInt(20), _count: { _all: 18 } },
      { songId: BigInt(30), _count: { _all: 12 } },
    ]);
    // Note: findMany may return rows in DB order, not the count
    // order — the route re-keys on id and uses the groupBy ordering.
    (prisma.song.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: BigInt(20),
        originalTitle: "ハナムスビ",
        originalLanguage: "ja",
        variantLabel: null,
        baseVersionId: null,
        translations: [{ locale: "ko", title: "꽃 매듭", variantLabel: null }],
      },
      {
        id: BigInt(10),
        originalTitle: "残陽",
        originalLanguage: "ja",
        variantLabel: null,
        baseVersionId: null,
        translations: [],
      },
      {
        id: BigInt(30),
        originalTitle: "ペレニアル",
        originalLanguage: "ja",
        variantLabel: null,
        baseVersionId: null,
        translations: [],
      },
    ]);
    const res = await GET(getRequest() as never, { params: params1 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.top3).toHaveLength(3);
    // Order matches groupBy (count desc), not findMany.
    expect(body.top3.map((e: { song: { id: number } }) => e.song.id)).toEqual([
      10, 20, 30,
    ]);
    expect(body.top3[0].count).toBe(24);
    expect(body.top3[1].count).toBe(18);
    // BigInt round-trip via serializeBigInt → numbers in the JSON.
    expect(typeof body.top3[0].song.id).toBe("number");
  });

  it("returns empty top3 when no wishes exist for the event", async () => {
    (prisma.songWish.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue(
      [],
    );
    const res = await GET(getRequest() as never, { params: params1 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.top3).toEqual([]);
    // Skip the song findMany when there are zero groups.
    expect(prisma.song.findMany).not.toHaveBeenCalled();
  });

  it("filters translations by [locale, ja] when locale query param is present", async () => {
    (prisma.songWish.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
      { songId: BigInt(10), _count: { _all: 1 } },
    ]);
    (prisma.song.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await GET(
      getRequest("http://localhost/api/events/1/wishes?locale=ko") as never,
      { params: params1 },
    );
    const findManyCall = (prisma.song.findMany as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    expect(findManyCall.select.translations.where).toEqual({
      locale: { in: ["ko", "ja"] },
    });
  });

  it("returns 400 for invalid eventId path segment", async () => {
    const res = await GET(getRequest() as never, {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/events/[id]/wishes/[wishId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.songWish.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      { count: 1 },
    );
  });

  it("deletes by wishId and returns { ok: true }", async () => {
    const res = await DELETE(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "1", wishId: "wish-uuid-abc" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(prisma.songWish.deleteMany).toHaveBeenCalledWith({
      where: { id: "wish-uuid-abc" },
    });
  });

  it("idempotent: returns 200 even when no row matches (count: 0)", async () => {
    (prisma.songWish.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      { count: 0 },
    );
    const res = await DELETE(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "1", wishId: "missing-uuid" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("returns 400 for empty wishId", async () => {
    const res = await DELETE(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "1", wishId: "" }),
    });
    expect(res.status).toBe(400);
    expect(prisma.songWish.deleteMany).not.toHaveBeenCalled();
  });
});
