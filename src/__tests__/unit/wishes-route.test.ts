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

  it("returns 403 when event has already started (server-side lock)", async () => {
    // Server-side lock: wishlist writes close at event.startTime.
    // Pairs with the client-side wall-clock fallback in
    // <EventWishSection> for the long-open-page case (laptop sleep
    // past startTime); also catches outright bypass via curl /
    // DevTools / a stale page that ignored its own client gate.
    // v0.10.0 smoke caught the symptom as "I can still modify
    // during the event" when the page was opened pre-startTime.
    (prisma.event.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BigInt(1),
      // 1h in the past — locked.
      startTime: new Date(Date.now() - 60 * 60 * 1000),
    });
    const res = await POST(postRequest({ songId: 42 }) as never, {
      params: params1,
    });
    expect(res.status).toBe(403);
    expect(prisma.songWish.create).not.toHaveBeenCalled();
  });

  it("allows POST when event.startTime is in the future (lock not active)", async () => {
    (prisma.event.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BigInt(1),
      // 1h in the future — pre-show.
      startTime: new Date(Date.now() + 60 * 60 * 1000),
    });
    const res = await POST(postRequest({ songId: 42 }) as never, {
      params: params1,
    });
    expect(res.status).toBe(200);
    expect(prisma.songWish.create).toHaveBeenCalled();
  });

  it("allows POST when event.startTime is null (TBA event, no lock anchor)", async () => {
    // TBA events shouldn't lock — the operator hasn't pinned a
    // start instant yet, so the client never enters its lock state
    // either (`<EventWishSection>` derives isLocked from startMs;
    // null startTime → never-lock).
    (prisma.event.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BigInt(1),
      startTime: null,
    });
    const res = await POST(postRequest({ songId: 42 }) as never, {
      params: params1,
    });
    expect(res.status).toBe(200);
    expect(prisma.songWish.create).toHaveBeenCalled();
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

  it("excludes soft-deleted songs (where: { isDeleted: false })", async () => {
    (prisma.songWish.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
      { songId: BigInt(10), _count: { _all: 1 } },
    ]);
    (prisma.song.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await GET(getRequest() as never, { params: params1 });
    const findManyCall = (prisma.song.findMany as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    // Same soft-delete contract POST enforces — a wish pointing at a
    // since-deleted song falls out of TOP-3 instead of rendering as
    // "Unknown song" client-side.
    expect(findManyCall.where).toMatchObject({ isDeleted: false });
  });

  it("orders groupBy by count desc with songId asc tie-break", async () => {
    (prisma.songWish.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue(
      [],
    );
    await GET(getRequest() as never, { params: params1 });
    const groupByCall = (prisma.songWish.groupBy as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    // Deterministic ordering: when two songs share a count the lower
    // songId wins. Without this, page-level rendering of ties is
    // non-deterministic across requests.
    expect(groupByCall.orderBy).toEqual([
      { _count: { id: "desc" } },
      { songId: "asc" },
    ]);
  });

  it("race: groupBy returns 3 ids but findMany returns 2 — top3 has 2 entries (skips the missing one)", async () => {
    (prisma.songWish.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
      { songId: BigInt(10), _count: { _all: 24 } },
      { songId: BigInt(20), _count: { _all: 18 } },
      { songId: BigInt(30), _count: { _all: 12 } },
    ]);
    // Concurrent delete: song 20 vanished between the groupBy and the
    // findMany. The flatMap-empty path drops it; results stay
    // ordered, just shorter.
    (prisma.song.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
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
    expect(body.top3).toHaveLength(2);
    expect(body.top3.map((e: { song: { id: number } }) => e.song.id)).toEqual([
      10, 30,
    ]);
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

  it("deletes by (wishId, eventId) and returns { ok: true }", async () => {
    const res = await DELETE(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "1", wishId: "wish-uuid-abc" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    // Scoped delete: a wishId from another event passed via this URL
    // would no-op (count: 0) instead of cross-event deleting.
    expect(prisma.songWish.deleteMany).toHaveBeenCalledWith({
      where: { id: "wish-uuid-abc", eventId: BigInt(1) },
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

  it("returns 400 for invalid eventId path segment", async () => {
    const res = await DELETE(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "abc", wishId: "wish-uuid-abc" }),
    });
    expect(res.status).toBe(400);
    expect(prisma.songWish.deleteMany).not.toHaveBeenCalled();
  });

  it("returns 403 when event has already started (server-side lock)", async () => {
    // Symmetric with POST: deletes also freeze at startTime,
    // otherwise a long-open page could remove a wish post-lock and
    // corrupt the fan TOP-3 mid-show.
    (prisma.event.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      startTime: new Date(Date.now() - 60 * 60 * 1000),
    });
    const res = await DELETE(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "1", wishId: "wish-uuid-abc" }),
    });
    expect(res.status).toBe(403);
    expect(prisma.songWish.deleteMany).not.toHaveBeenCalled();
  });

  it("idempotent past-startTime: missing-event row falls through to 200", async () => {
    // The event lookup returns null when the event was soft-deleted
    // (or never existed). The optional-chain `event?.startTime`
    // bails out, the lock check is skipped, and the deleteMany
    // no-ops with count=0. Preserves the existing
    // idempotent-DELETE shape so an undo race doesn't surface as
    // an error.
    (prisma.event.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      null,
    );
    (prisma.songWish.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      { count: 0 },
    );
    const res = await DELETE(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "1", wishId: "wish-uuid-abc" }),
    });
    expect(res.status).toBe(200);
  });

  it("allows DELETE when event.startTime is in the future (lock not active)", async () => {
    (prisma.event.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      startTime: new Date(Date.now() + 60 * 60 * 1000),
    });
    const res = await DELETE(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "1", wishId: "wish-uuid-abc" }),
    });
    expect(res.status).toBe(200);
    expect(prisma.songWish.deleteMany).toHaveBeenCalled();
  });
});
