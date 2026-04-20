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
  });
});
