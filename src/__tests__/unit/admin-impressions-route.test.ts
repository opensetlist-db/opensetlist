import { describe, it, expect, vi } from "vitest";

// Mock next/headers so verifyAdminAPI() runs the real cookie check against
// an empty cookie store — that's the actual unauthenticated flow we want to pin.
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
  }),
}));

// Prisma is mocked so that if auth ever wrongly passed through, the test
// would fail loudly without touching a real DB — not because we expect the
// happy path to run.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    eventImpression: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn(),
  },
}));

import { DELETE, PATCH } from "@/app/api/admin/impressions/[id]/route";

function makeRequest(method: string) {
  return new Request("http://localhost/api/admin/impressions/1", { method });
}

describe("Admin impression endpoints reject unauthenticated callers", () => {
  it("DELETE without admin_session cookie returns 401", async () => {
    const res = await DELETE(
      makeRequest("DELETE") as unknown as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ id: "1" }) },
    );
    expect(res.status).toBe(401);
  });

  it("PATCH without admin_session cookie returns 401", async () => {
    const res = await PATCH(
      makeRequest("PATCH") as unknown as Parameters<typeof PATCH>[0],
      { params: Promise.resolve({ id: "1" }) },
    );
    expect(res.status).toBe(401);
  });
});
