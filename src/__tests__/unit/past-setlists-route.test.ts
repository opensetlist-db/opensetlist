import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    event: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { GET } from "@/app/api/events/[id]/past-setlists/route";
import { prisma } from "@/lib/prisma";

function getRequest(url = "http://localhost/api/events/1/past-setlists") {
  return new Request(url);
}

const params1 = Promise.resolve({ id: "1" });

function songRow(over: Record<string, unknown> = {}) {
  return {
    id: BigInt(10),
    originalTitle: "Song",
    originalLanguage: "ja",
    variantLabel: null,
    baseVersionId: null,
    isDeleted: false,
    translations: [],
    baseVersion: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/events/[id]/past-setlists", () => {
  it("returns 400 for non-bigint id segment", async () => {
    const res = await GET(getRequest() as never, {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(res.status).toBe(400);
    expect(prisma.event.findFirst).not.toHaveBeenCalled();
  });

  it("returns 404 when the event is missing or soft-deleted", async () => {
    (prisma.event.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await GET(getRequest() as never, { params: params1 });
    expect(res.status).toBe(404);
    expect(prisma.event.findMany).not.toHaveBeenCalled();
  });

  it("returns 200 + pastEvents:[] when current event has no eventSeriesId (and skips findMany)", async () => {
    (prisma.event.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BigInt(1),
      date: new Date("2025-05-02T00:00:00Z"),
      eventSeriesId: null,
    });
    const res = await GET(getRequest() as never, { params: params1 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, pastEvents: [] });
    expect(prisma.event.findMany).not.toHaveBeenCalled();
  });

  it("returns 200 + pastEvents:[] when current event date is null (TBA), no findMany", async () => {
    (prisma.event.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BigInt(1),
      date: null,
      eventSeriesId: BigInt(5),
    });
    const res = await GET(getRequest() as never, { params: params1 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pastEvents).toEqual([]);
    expect(prisma.event.findMany).not.toHaveBeenCalled();
  });

  it("builds the right where clause: same series, not self, date lt current, soft-delete + confirmed-song-some", async () => {
    const currentDate = new Date("2025-05-02T00:00:00Z");
    (prisma.event.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BigInt(1),
      date: currentDate,
      eventSeriesId: BigInt(5),
    });
    (prisma.event.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await GET(getRequest() as never, { params: params1 });
    const args = (prisma.event.findMany as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(args.where).toMatchObject({
      eventSeriesId: BigInt(5),
      isDeleted: false,
      id: { not: BigInt(1) },
      date: { lt: currentDate },
    });
    expect(args.where.setlistItems).toMatchObject({
      some: { isDeleted: false, status: "confirmed", type: "song" },
    });
    expect(args.orderBy).toEqual({ date: "desc" });
    expect(args.take).toBe(10);
  });

  it("flattens sibling setlists and serialises BigInts to numbers", async () => {
    (prisma.event.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BigInt(1),
      date: new Date("2025-05-02T00:00:00Z"),
      eventSeriesId: BigInt(5),
    });
    (prisma.event.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: BigInt(2),
        date: new Date("2025-04-01T00:00:00Z"),
        originalName: "Day 1",
        originalShortName: "D1",
        originalLanguage: "ja",
        originalVenue: "Tokyo",
        translations: [
          { locale: "ko", name: "1일차", shortName: null, venue: "도쿄" },
        ],
        setlistItems: [
          {
            position: 1,
            songs: [
              {
                order: 0,
                song: songRow({ id: BigInt(100), originalTitle: "A" }),
              },
              // medley second slot — should be dropped by the flatten rule
              {
                order: 1,
                song: songRow({ id: BigInt(101), originalTitle: "B" }),
              },
            ],
          },
          {
            position: 2,
            songs: [
              {
                order: 0,
                song: songRow({ id: BigInt(102), originalTitle: "C" }),
              },
            ],
          },
        ],
      },
    ]);

    const res = await GET(getRequest() as never, { params: params1 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.pastEvents).toHaveLength(1);
    const ev = body.pastEvents[0];
    expect(ev.eventId).toBe(2);
    expect(typeof ev.eventId).toBe("number");
    expect(ev.songCount).toBe(2);
    expect(ev.songs.map((s: { songId: number }) => s.songId)).toEqual([100, 102]);
    expect(ev.date).toBe(new Date("2025-04-01T00:00:00Z").toISOString());
    expect(ev.translations[0]).toEqual({
      locale: "ko",
      name: "1일차",
      shortName: null,
      venue: "도쿄",
    });
  });

  it("returns 500 db_error when event.findFirst rejects", async () => {
    (prisma.event.findFirst as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("connection reset"),
    );
    const res = await GET(getRequest() as never, { params: params1 });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "db_error" });
    expect(prisma.event.findMany).not.toHaveBeenCalled();
  });

  it("returns 500 db_error when event.findMany rejects", async () => {
    (prisma.event.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BigInt(1),
      date: new Date("2025-05-02T00:00:00Z"),
      eventSeriesId: BigInt(5),
    });
    (prisma.event.findMany as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("pooler restart"),
    );
    const res = await GET(getRequest() as never, { params: params1 });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "db_error" });
  });

  it("drops siblings whose event id is beyond Number.MAX_SAFE_INTEGER (no truncated eventId in response)", async () => {
    const unsafeId = BigInt(2) ** BigInt(53) + BigInt(7);
    (prisma.event.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BigInt(1),
      date: new Date("2025-05-02T00:00:00Z"),
      eventSeriesId: BigInt(5),
    });
    (prisma.event.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: unsafeId,
        date: new Date("2025-04-02T00:00:00Z"),
        originalName: "Unsafe id",
        originalShortName: null,
        originalLanguage: "ja",
        originalVenue: null,
        translations: [],
        setlistItems: [
          { position: 1, songs: [{ order: 0, song: songRow({ id: BigInt(100) }) }] },
        ],
      },
      {
        id: BigInt(3),
        date: new Date("2025-04-01T00:00:00Z"),
        originalName: "Safe",
        originalShortName: null,
        originalLanguage: "ja",
        originalVenue: null,
        translations: [],
        setlistItems: [
          { position: 1, songs: [{ order: 0, song: songRow({ id: BigInt(200) }) }] },
        ],
      },
    ]);
    const res = await GET(getRequest() as never, { params: params1 });
    const body = await res.json();
    expect(body.pastEvents).toHaveLength(1);
    expect(body.pastEvents[0].eventId).toBe(3);
  });

  it("drops siblings whose songCount collapses to 0 after flatten (every effective song soft-deleted)", async () => {
    (prisma.event.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BigInt(1),
      date: new Date("2025-05-02T00:00:00Z"),
      eventSeriesId: BigInt(5),
    });
    (prisma.event.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: BigInt(2),
        date: new Date("2025-04-01T00:00:00Z"),
        originalName: "Dead",
        originalShortName: null,
        originalLanguage: "ja",
        originalVenue: null,
        translations: [],
        setlistItems: [
          {
            position: 1,
            songs: [
              {
                order: 0,
                song: songRow({ id: BigInt(50), isDeleted: true }),
              },
            ],
          },
        ],
      },
      {
        id: BigInt(3),
        date: new Date("2025-04-02T00:00:00Z"),
        originalName: "Alive",
        originalShortName: null,
        originalLanguage: "ja",
        originalVenue: null,
        translations: [],
        setlistItems: [
          {
            position: 1,
            songs: [{ order: 0, song: songRow({ id: BigInt(60) }) }],
          },
        ],
      },
    ]);
    const res = await GET(getRequest() as never, { params: params1 });
    const body = await res.json();
    expect(body.pastEvents).toHaveLength(1);
    expect(body.pastEvents[0].eventId).toBe(3);
  });
});
