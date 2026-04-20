// NOTE: This file pins current behavior of POST /api/reactions, which has
// NO idempotency mechanism — each POST creates a new SetlistItemReaction row,
// and SetlistItemReaction has no @@unique constraint to dedup. Spam-clicking
// an emotion button inflates the count. Tracked separately as a launch-blocker
// follow-up; this test pins what the endpoint actually does today.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    setlistItem: {
      findFirst: vi.fn(),
    },
    setlistItemReaction: {
      create: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

import { POST } from "@/app/api/reactions/route";
import { prisma } from "@/lib/prisma";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/reactions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/reactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.setlistItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      { id: BigInt(10) },
    );
    (
      prisma.setlistItemReaction.create as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: "reaction-uuid-1",
      setlistItemId: BigInt(10),
      reactionType: "best",
      createdAt: new Date("2026-05-02T12:00:00Z"),
    });
    (
      prisma.setlistItemReaction.groupBy as ReturnType<typeof vi.fn>
    ).mockResolvedValue([{ reactionType: "best", _count: 1 }]);
  });

  it("rejects missing setlistItemId", async () => {
    const res = await POST(
      makeRequest({ reactionType: "best" }) as unknown as Parameters<
        typeof POST
      >[0],
    );
    expect(res.status).toBe(400);
  });

  it("rejects invalid reactionType (not in waiting/best/surprise/moved)", async () => {
    const res = await POST(
      makeRequest({
        setlistItemId: "10",
        reactionType: "love",
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(400);
  });

  it("rejects non-numeric setlistItemId", async () => {
    const res = await POST(
      makeRequest({
        setlistItemId: "not-a-bigint",
        reactionType: "best",
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when setlist item is missing or soft-deleted", async () => {
    (prisma.setlistItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      null,
    );

    const res = await POST(
      makeRequest({
        setlistItemId: "999",
        reactionType: "best",
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(404);
  });

  it("creates a reaction and returns reactionId + counts on valid input", async () => {
    const res = await POST(
      makeRequest({
        setlistItemId: "10",
        reactionType: "best",
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reactionId).toBe("reaction-uuid-1");
    expect(body.counts).toEqual({ best: 1 });
  });
});
