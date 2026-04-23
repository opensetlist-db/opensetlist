import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    setlistItem: {
      findFirst: vi.fn(),
    },
    setlistItemReaction: {
      create: vi.fn(),
      findFirst: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

// Minimal stand-in for Prisma's runtime PrismaClientKnownRequestError so the
// route's `instanceof Prisma.PrismaClientKnownRequestError` check fires for
// our test-injected error. Class is defined inside the factory because
// vi.mock is hoisted above any top-level declarations.
vi.mock("@/generated/prisma/client", () => {
  class FakePrismaKnownError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return { Prisma: { PrismaClientKnownRequestError: FakePrismaKnownError } };
});

import { POST, DELETE } from "@/app/api/reactions/route";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

const FakePrismaKnownError = Prisma.PrismaClientKnownRequestError as unknown as new (
  code: string,
) => Error & { code: string };

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

  // After each 400 we also assert no Prisma method ran — guards against a
  // regression where validation gets moved below a DB call.
  function expectNoPrismaCalls() {
    expect(prisma.setlistItem.findFirst).not.toHaveBeenCalled();
    expect(prisma.setlistItemReaction.create).not.toHaveBeenCalled();
    expect(prisma.setlistItemReaction.findFirst).not.toHaveBeenCalled();
    expect(prisma.setlistItemReaction.groupBy).not.toHaveBeenCalled();
  }

  it("rejects literal null body without throwing (returns 400)", async () => {
    // Regression: req.json() can return null when the client sends
    // literal JSON null. Prior version destructured straight from `body`
    // and threw TypeError → 500.
    const res = await POST(
      new Request("http://localhost/api/reactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "null",
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(400);
    expectNoPrismaCalls();
  });

  it("rejects missing setlistItemId", async () => {
    const res = await POST(
      makeRequest({ reactionType: "best" }) as unknown as Parameters<
        typeof POST
      >[0],
    );
    expect(res.status).toBe(400);
    expectNoPrismaCalls();
  });

  it("rejects invalid reactionType (not in waiting/best/surprise/moved)", async () => {
    const res = await POST(
      makeRequest({
        setlistItemId: "10",
        reactionType: "love",
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(400);
    expectNoPrismaCalls();
  });

  it("rejects non-numeric setlistItemId", async () => {
    const res = await POST(
      makeRequest({
        setlistItemId: "not-a-bigint",
        reactionType: "best",
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(400);
    expectNoPrismaCalls();
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

  it("creates a reaction and returns reactionId + counts on valid input (no anonId — legacy compat)", async () => {
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
    // Legacy path stores anonId as null so the partial unique skips this row.
    expect(prisma.setlistItemReaction.create).toHaveBeenCalledWith({
      data: { setlistItemId: BigInt(10), reactionType: "best", anonId: null },
    });
  });

  it("rejects bogus anonId types (non-string)", async () => {
    const res = await POST(
      makeRequest({
        setlistItemId: "10",
        reactionType: "best",
        anonId: 12345,
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(400);
    expectNoPrismaCalls();
  });

  it("rejects anonId longer than 64 chars", async () => {
    const res = await POST(
      makeRequest({
        setlistItemId: "10",
        reactionType: "best",
        anonId: "a".repeat(65),
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(400);
    expectNoPrismaCalls();
  });

  it("idempotent: same anonId+setlistItemId+reactionType POSTed twice → same reactionId, second create hits P2002 then findFirst resolves the existing row", async () => {
    // First POST: create succeeds, returns row.
    // Second POST: create throws P2002, route falls through to findFirst
    // and returns the existing row's id.
    (prisma.setlistItemReaction.create as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        id: "reaction-uuid-1",
        setlistItemId: BigInt(10),
        reactionType: "best",
        anonId: "anon-A",
        createdAt: new Date(),
      })
      .mockRejectedValueOnce(new FakePrismaKnownError("P2002"));
    (
      prisma.setlistItemReaction.findFirst as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: "reaction-uuid-1",
      setlistItemId: BigInt(10),
      reactionType: "best",
      anonId: "anon-A",
      createdAt: new Date(),
    });

    const body = {
      setlistItemId: "10",
      reactionType: "best",
      anonId: "anon-A",
    };

    const res1 = await POST(makeRequest(body) as unknown as Parameters<typeof POST>[0]);
    const res2 = await POST(makeRequest(body) as unknown as Parameters<typeof POST>[0]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    const b1 = await res1.json();
    const b2 = await res2.json();
    expect(b1.reactionId).toBe("reaction-uuid-1");
    expect(b2.reactionId).toBe("reaction-uuid-1"); // same id — idempotent
    expect(prisma.setlistItemReaction.create).toHaveBeenCalledTimes(2);
    expect(prisma.setlistItemReaction.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.setlistItemReaction.findFirst).toHaveBeenCalledWith({
      where: { setlistItemId: BigInt(10), reactionType: "best", anonId: "anon-A" },
    });
  });

  it("different anonIds → distinct reactionIds (no P2002)", async () => {
    (prisma.setlistItemReaction.create as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        id: "reaction-uuid-A",
        setlistItemId: BigInt(10),
        reactionType: "best",
        anonId: "anon-A",
      })
      .mockResolvedValueOnce({
        id: "reaction-uuid-B",
        setlistItemId: BigInt(10),
        reactionType: "best",
        anonId: "anon-B",
      });

    const r1 = await POST(
      makeRequest({
        setlistItemId: "10",
        reactionType: "best",
        anonId: "anon-A",
      }) as unknown as Parameters<typeof POST>[0],
    );
    const r2 = await POST(
      makeRequest({
        setlistItemId: "10",
        reactionType: "best",
        anonId: "anon-B",
      }) as unknown as Parameters<typeof POST>[0],
    );

    const b1 = await r1.json();
    const b2 = await r2.json();
    expect(b1.reactionId).toBe("reaction-uuid-A");
    expect(b2.reactionId).toBe("reaction-uuid-B");
    expect(prisma.setlistItemReaction.findFirst).not.toHaveBeenCalled();
  });

  it("empty-string anonId is normalized to null (localStorage-disabled client falls back to legacy create)", async () => {
    const res = await POST(
      makeRequest({
        setlistItemId: "10",
        reactionType: "best",
        anonId: "",
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    expect(prisma.setlistItemReaction.create).toHaveBeenCalledWith({
      data: { setlistItemId: BigInt(10), reactionType: "best", anonId: null },
    });
  });
});

describe("DELETE /api/reactions", () => {
  it("rejects literal null body without throwing (returns 400)", async () => {
    // Regression mirror of the POST null-body case.
    const res = await DELETE(
      new Request("http://localhost/api/reactions", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: "null",
      }) as unknown as Parameters<typeof DELETE>[0],
    );
    expect(res.status).toBe(400);
  });
});
