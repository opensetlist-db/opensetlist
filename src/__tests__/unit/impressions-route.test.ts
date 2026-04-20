import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    event: {
      findFirst: vi.fn(),
    },
    eventImpression: {
      create: vi.fn(),
    },
  },
}));

import { POST } from "@/app/api/impressions/route";
import { prisma } from "@/lib/prisma";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/impressions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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

  it("accepts a valid payload at exactly 200 chars", async () => {
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
    // client-supplied input.
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
    });
    expect(createArgs.data.id).toBe(createArgs.data.rootImpressionId);
  });
});
