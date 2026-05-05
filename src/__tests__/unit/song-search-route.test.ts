import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    song: {
      findMany: vi.fn(),
    },
  },
}));

import { GET } from "@/app/api/songs/search/route";
import { prisma } from "@/lib/prisma";

const findMany = prisma.song.findMany as ReturnType<typeof vi.fn>;

function makeRequest(query: string) {
  return new Request(`http://localhost/api/songs/search?${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
});

describe("GET /api/songs/search — empty query", () => {
  it("returns [] for missing q without hitting Prisma", async () => {
    const res = await GET(makeRequest("") as unknown as Parameters<typeof GET>[0]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("returns [] for whitespace-only q without hitting Prisma", async () => {
    const res = await GET(
      makeRequest("q=%20%20%20") as unknown as Parameters<typeof GET>[0]
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/songs/search — base-only filtering", () => {
  it("filters baseVersionId: null when includeVariants is absent", async () => {
    await GET(makeRequest("q=dream") as unknown as Parameters<typeof GET>[0]);

    expect(findMany).toHaveBeenCalledTimes(1);
    const call = findMany.mock.calls[0][0];
    expect(call.where.baseVersionId).toBe(null);
    expect(call.where.isDeleted).toBe(false);
  });

  it("filters baseVersionId: null when includeVariants=false explicitly", async () => {
    await GET(
      makeRequest("q=dream&includeVariants=false") as unknown as Parameters<
        typeof GET
      >[0]
    );

    const call = findMany.mock.calls[0][0];
    expect(call.where.baseVersionId).toBe(null);
  });

  it("drops the baseVersionId filter when includeVariants=true (admin path)", async () => {
    await GET(
      makeRequest("q=dream&includeVariants=true") as unknown as Parameters<
        typeof GET
      >[0]
    );

    const call = findMany.mock.calls[0][0];
    expect(call.where).not.toHaveProperty("baseVersionId");
  });
});

describe("GET /api/songs/search — query matching", () => {
  it("builds a case-insensitive OR over originalTitle and translation titles", async () => {
    await GET(makeRequest("q=Hanamusubi") as unknown as Parameters<typeof GET>[0]);

    const call = findMany.mock.calls[0][0];
    expect(call.where.OR).toEqual([
      { originalTitle: { contains: "Hanamusubi", mode: "insensitive" } },
      {
        translations: {
          some: { title: { contains: "Hanamusubi", mode: "insensitive" } },
        },
      },
    ]);
  });

  it("trims surrounding whitespace before searching", async () => {
    await GET(
      makeRequest("q=%20%20dream%20%20") as unknown as Parameters<typeof GET>[0]
    );

    const call = findMany.mock.calls[0][0];
    expect(call.where.OR[0]).toEqual({
      originalTitle: { contains: "dream", mode: "insensitive" },
    });
  });
});

describe("GET /api/songs/search — excludeIds", () => {
  it("applies id: notIn for valid comma-separated ids", async () => {
    await GET(
      makeRequest("q=dream&excludeIds=10,20,30") as unknown as Parameters<
        typeof GET
      >[0]
    );

    const call = findMany.mock.calls[0][0];
    expect(call.where.id).toEqual({
      notIn: [BigInt(10), BigInt(20), BigInt(30)],
    });
  });

  it("drops non-numeric tokens silently", async () => {
    await GET(
      makeRequest(
        "q=dream&excludeIds=abc,42,1.5,7"
      ) as unknown as Parameters<typeof GET>[0]
    );

    const call = findMany.mock.calls[0][0];
    expect(call.where.id).toEqual({ notIn: [BigInt(42), BigInt(7)] });
  });

  it("omits the id filter entirely when excludeIds is empty", async () => {
    await GET(
      makeRequest("q=dream&excludeIds=") as unknown as Parameters<typeof GET>[0]
    );

    const call = findMany.mock.calls[0][0];
    expect(call.where).not.toHaveProperty("id");
  });
});

describe("GET /api/songs/search — result limit", () => {
  it("caps results at 20", async () => {
    await GET(makeRequest("q=dream") as unknown as Parameters<typeof GET>[0]);

    const call = findMany.mock.calls[0][0];
    expect(call.take).toBe(20);
  });
});

describe("GET /api/songs/search — DB error path", () => {
  it("returns [] with HTTP 500 when prisma throws", async () => {
    findMany.mockRejectedValueOnce(new Error("DB connection lost"));

    const res = await GET(
      makeRequest("q=dream") as unknown as Parameters<typeof GET>[0],
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual([]);
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
