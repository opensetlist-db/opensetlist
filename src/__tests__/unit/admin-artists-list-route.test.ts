import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/admin-auth", () => ({
  verifyAdminAPI: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    artist: {
      findMany: vi.fn(),
    },
  },
}));

import { GET } from "@/app/api/admin/artists/route";
import { prisma } from "@/lib/prisma";
import { verifyAdminAPI } from "@/lib/admin-auth";

const verifyMock = verifyAdminAPI as ReturnType<typeof vi.fn>;
const findManyMock = prisma.artist.findMany as ReturnType<typeof vi.fn>;

// The bare list backs every admin artist <select>. It used to be capped
// at `take: 100`, so once prod passed 100 artists the oldest ones
// (id 1 = the Hasunosora headliner) vanished from the song form's
// dropdown and the select showed — and on touch, saved — another artist.
describe("GET /api/admin/artists", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyMock.mockResolvedValue(null);
    findManyMock.mockResolvedValue([]);
  });

  it("returns the full list (no take) without ?q=", async () => {
    await GET(new NextRequest("http://localhost/api/admin/artists"));
    const args = findManyMock.mock.calls[0][0];
    expect(args).not.toHaveProperty("take");
    expect(args.where).toEqual({ isDeleted: false });
  });

  it("treats a blank ?q= as the full list", async () => {
    await GET(new NextRequest("http://localhost/api/admin/artists?q=%20"));
    expect(findManyMock.mock.calls[0][0]).not.toHaveProperty("take");
  });

  it("still caps search results", async () => {
    await GET(new NextRequest("http://localhost/api/admin/artists?q=cerise"));
    const args = findManyMock.mock.calls[0][0];
    expect(args.take).toBe(100);
    expect(args.where.OR).toBeDefined();
  });

  it("orders the already selected artist rows by common hierarchy, with numeric ID ties", async () => {
    findManyMock.mockResolvedValue([
      { id: BigInt(10), parentArtistId: null, type: "group", sortOrder: 1 },
      { id: BigInt(3), parentArtistId: BigInt(2), type: "unit", sortOrder: 1 },
      { id: BigInt(2), parentArtistId: null, type: "group", sortOrder: 1 },
    ]);
    const response = await GET(new NextRequest("http://localhost/api/admin/artists"));
    expect((await response.json()).map((artist: { id: number }) => artist.id)).toEqual([2, 3, 10]);
  });

  it("loads ancestors for search without adding them to the selected result set", async () => {
    const root = { id: BigInt(10), parentArtistId: null, type: "group", sortOrder: 1 };
    const child = { id: BigInt(20), parentArtistId: root.id, type: "unit", sortOrder: null };
    const other = { id: BigInt(2), parentArtistId: null, type: "group", sortOrder: 2 };
    findManyMock.mockResolvedValueOnce([other, child]).mockResolvedValueOnce([other, root, child]);
    const response = await GET(new NextRequest("http://localhost/api/admin/artists?q=fixture"));
    expect((await response.json()).map((artist: { id: number }) => artist.id)).toEqual([20, 2]);
    expect(findManyMock).toHaveBeenCalledTimes(2);
    expect(findManyMock.mock.calls[0][0].take).toBe(100);
  });
});
