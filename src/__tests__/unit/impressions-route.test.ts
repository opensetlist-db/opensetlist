import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    event: {
      findFirst: vi.fn(),
    },
    eventImpression: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { GET, POST } from "@/app/api/impressions/route";
import { prisma } from "@/lib/prisma";
import { IMPRESSION_PAGE_SIZE } from "@/lib/config";
import { encodeImpressionCursor } from "@/lib/impressionCursor";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/impressions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// GET handler reads `req.nextUrl.searchParams`, which is a NextRequest
// extension — a plain `Request` lacks `nextUrl`. Construct a real
// NextRequest so the route's URL parsing exercises the production
// path instead of crashing on `undefined.searchParams`.
function makeGetRequest(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/impressions?${query}`);
}

// Build N stub rows matching what `prisma.eventImpression.findMany`
// would return for the GET handler — only the fields the route
// actually reads off `r.*`. Newest-first ordering.
function makeRows(n: number) {
  const base = new Date("2026-05-02T12:00:00.000Z").getTime();
  return Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    rootImpressionId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    eventId: BigInt(1),
    content: `imp ${i}`,
    locale: "ko",
    createdAt: new Date(base - i * 1000),
  }));
}

describe("POST /api/impressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: event exists and is not soft-deleted.
    (prisma.event.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BigInt(1),
    });
    (
      prisma.eventImpression.create as ReturnType<typeof vi.fn>
    ).mockImplementation(async ({ data }) => ({
      id: data.id,
      rootImpressionId: data.rootImpressionId,
      eventId: data.eventId,
      content: data.content,
      locale: data.locale,
      createdAt: new Date("2026-05-02T12:00:00Z"),
    }));
  });

  it("rejects content longer than 200 chars", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(
      makeRequest({
        eventId: "1",
        content: "a".repeat(201),
        locale: "ko",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
    expect(res.status).toBe(400);
    expect(prisma.event.findFirst).not.toHaveBeenCalled();
    expect(prisma.eventImpression.create).not.toHaveBeenCalled();
  });

  it("rejects empty content after trim", async () => {
    const res = await POST(
      makeRequest({
        eventId: "1",
        content: "   ",
        locale: "ko",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
    expect(res.status).toBe(400);
    expect(prisma.event.findFirst).not.toHaveBeenCalled();
    expect(prisma.eventImpression.create).not.toHaveBeenCalled();
  });

  it("rejects missing eventId", async () => {
    const res = await POST(
      makeRequest({
        content: "valid content",
        locale: "ko",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
    expect(res.status).toBe(400);
    expect(prisma.event.findFirst).not.toHaveBeenCalled();
    expect(prisma.eventImpression.create).not.toHaveBeenCalled();
  });

  it("rejects non-numeric eventId", async () => {
    const res = await POST(
      makeRequest({
        eventId: "not-a-bigint",
        content: "valid content",
        locale: "ko",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
    expect(res.status).toBe(400);
    expect(prisma.event.findFirst).not.toHaveBeenCalled();
    expect(prisma.eventImpression.create).not.toHaveBeenCalled();
  });

  it("returns 404 when the event is missing or soft-deleted", async () => {
    (prisma.event.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      null,
    );

    const res = await POST(
      makeRequest({
        eventId: "999",
        content: "valid content",
        locale: "ko",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
    expect(res.status).toBe(404);
    expect(prisma.eventImpression.create).not.toHaveBeenCalled();
  });

  it("accepts a valid payload at exactly 200 chars (no anonId — legacy compat)", async () => {
    const res = await POST(
      makeRequest({
        eventId: "1",
        content: "a".repeat(200),
        locale: "ko",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.impression.content).toBe("a".repeat(200));
    expect(body.impression.id).toBe(body.impression.rootImpressionId);

    // Pin the exact shape the route persists, so a regression that drops
    // or mutates a field fails here even if the response still echoes the
    // client-supplied input. anonId: null when the client doesn't send one.
    expect(prisma.eventImpression.create).toHaveBeenCalledTimes(1);
    const createArgs = (
      prisma.eventImpression.create as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(createArgs.data).toEqual({
      id: expect.any(String),
      rootImpressionId: expect.any(String),
      eventId: BigInt(1),
      content: "a".repeat(200),
      locale: "ko",
      anonId: null,
    });
    expect(createArgs.data.id).toBe(createArgs.data.rootImpressionId);
  });

  it("stores anonId on the new chain when client provides one", async () => {
    const res = await POST(
      makeRequest({
        eventId: "1",
        content: "great show",
        locale: "ko",
        anonId: "anon-A",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
    expect(res.status).toBe(200);
    const createArgs = (
      prisma.eventImpression.create as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(createArgs.data.anonId).toBe("anon-A");
  });

  it("normalizes empty-string anonId to null (localStorage-disabled client)", async () => {
    const res = await POST(
      makeRequest({
        eventId: "1",
        content: "great show",
        locale: "ko",
        anonId: "",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
    expect(res.status).toBe(200);
    const createArgs = (
      prisma.eventImpression.create as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(createArgs.data.anonId).toBeNull();
  });

  it("rejects bogus anonId types (non-string)", async () => {
    const res = await POST(
      makeRequest({
        eventId: "1",
        content: "valid content",
        locale: "ko",
        anonId: 12345,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
    expect(res.status).toBe(400);
    expect(prisma.event.findFirst).not.toHaveBeenCalled();
    expect(prisma.eventImpression.create).not.toHaveBeenCalled();
  });

  it("rejects anonId longer than 64 chars", async () => {
    const res = await POST(
      makeRequest({
        eventId: "1",
        content: "valid content",
        locale: "ko",
        anonId: "a".repeat(65),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
    expect(res.status).toBe(400);
    expect(prisma.event.findFirst).not.toHaveBeenCalled();
    expect(prisma.eventImpression.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/impressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects missing eventId", async () => {
    const res = await GET(makeGetRequest(""));
    expect(res.status).toBe(400);
  });

  it("rejects malformed eventId", async () => {
    const res = await GET(makeGetRequest("eventId=not-a-bigint"));
    expect(res.status).toBe(400);
  });

  it("returns full page + nextCursor + totalCount when includeTotal=1", async () => {
    const rows = makeRows(IMPRESSION_PAGE_SIZE);
    (
      prisma.eventImpression.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(rows);
    (
      prisma.eventImpression.count as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(IMPRESSION_PAGE_SIZE * 3);

    const res = await GET(makeGetRequest("eventId=1&includeTotal=1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      impressions: unknown[];
      nextCursor: string | null;
      totalCount: number;
    };
    expect(body.impressions).toHaveLength(IMPRESSION_PAGE_SIZE);
    // Cursor anchored on the LAST returned row (oldest in this page).
    const last = rows[rows.length - 1];
    expect(body.nextCursor).toBe(encodeImpressionCursor(last.createdAt, last.id));
    expect(body.totalCount).toBe(IMPRESSION_PAGE_SIZE * 3);
  });

  it("skips count() entirely when includeTotal flag is absent (polling hot-path)", async () => {
    const rows = makeRows(IMPRESSION_PAGE_SIZE);
    (
      prisma.eventImpression.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(rows);

    const res = await GET(makeGetRequest("eventId=1"));
    expect(res.status).toBe(200);
    // The count() branch must NOT execute on a polling request — that
    // would defeat the whole point of the gate (a redundant
    // event-wide aggregate every 5s per concurrent viewer).
    expect(prisma.eventImpression.count).not.toHaveBeenCalled();
    const body = (await res.json()) as Record<string, unknown>;
    // Response must omit the field entirely (not null, not 0) so the
    // shape mirrors the cost: nothing computed, nothing returned.
    expect(body).not.toHaveProperty("totalCount");
  });

  it("returns null nextCursor on the last (partial) page", async () => {
    const rows = makeRows(IMPRESSION_PAGE_SIZE - 5);
    (
      prisma.eventImpression.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(rows);
    // No count() mock needed — this URL omits `?includeTotal=1`, so
    // the count branch resolves to undefined synchronously. Leaving a
    // stray `mockResolvedValueOnce` would leak into the next test
    // (the queue is FIFO across tests, not reset by `clearAllMocks`).

    const res = await GET(makeGetRequest("eventId=1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { nextCursor: string | null };
    expect(body.nextCursor).toBeNull();
  });

  it("returns null nextCursor + totalCount=0 when the event has zero impressions (includeTotal=1)", async () => {
    (
      prisma.eventImpression.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce([]);
    (
      prisma.eventImpression.count as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(0);

    const res = await GET(makeGetRequest("eventId=1&includeTotal=1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      impressions: unknown[];
      nextCursor: string | null;
      totalCount: number;
    };
    expect(body.impressions).toEqual([]);
    expect(body.nextCursor).toBeNull();
    expect(body.totalCount).toBe(0);
  });

  it("applies the cursor predicate to findMany; count uses base WHERE when includeTotal=1", async () => {
    const rows = makeRows(IMPRESSION_PAGE_SIZE);
    (
      prisma.eventImpression.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(rows);
    (
      prisma.eventImpression.count as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(200);

    const cursorDate = new Date("2026-05-02T11:00:00.000Z");
    const cursorId = "00000000-0000-4000-8000-00000000abcd";
    const cursor = encodeImpressionCursor(cursorDate, cursorId);

    const res = await GET(
      makeGetRequest(
        `eventId=1&before=${encodeURIComponent(cursor)}&includeTotal=1`,
      ),
    );
    expect(res.status).toBe(200);
    expect(prisma.eventImpression.findMany).toHaveBeenCalledTimes(1);
    const findManyArgs = (
      prisma.eventImpression.findMany as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    // The OR predicate is what enforces strict (createdAt, id) ordering
    // across the cursor boundary — without the id tiebreaker, rows
    // sharing a millisecond with the cursor's createdAt could be
    // skipped or duplicated on subsequent pages.
    expect(findManyArgs.where.OR).toEqual([
      { createdAt: { lt: cursorDate } },
      { createdAt: cursorDate, id: { lt: cursorId } },
    ]);
    // Count query MUST NOT include the cursor predicate — it's the
    // event-wide total used by the "X more" UI, not the page size.
    expect(prisma.eventImpression.count).toHaveBeenCalledTimes(1);
    const countArgs = (
      prisma.eventImpression.count as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(countArgs.where.OR).toBeUndefined();
  });

  it("rejects a malformed cursor with 400", async () => {
    const res = await GET(makeGetRequest("eventId=1&before=not-a-cursor"));
    expect(res.status).toBe(400);
    expect(prisma.eventImpression.findMany).not.toHaveBeenCalled();
  });
});
