import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/admin-auth", () => ({
  verifyAdminAPI: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contestReport: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { PATCH } from "@/app/api/admin/contest-reports/[id]/route";
import { prisma } from "@/lib/prisma";
import { verifyAdminAPI } from "@/lib/admin-auth";

const paramsAbc = Promise.resolve({ id: "abc-uuid" });

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/admin/contest-reports/abc-uuid", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/admin/contest-reports/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (verifyAdminAPI as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (
      prisma.contestReport.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: "abc-uuid",
      status: "pending",
    });
    (prisma.contestReport.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  it("returns 401 without admin session", async () => {
    (verifyAdminAPI as ReturnType<typeof vi.fn>).mockResolvedValue(
      Response.json({ error: "unauthorized" }, { status: 401 }),
    );
    const res = await PATCH(patchRequest({ status: "resolved" }) as never, {
      params: paramsAbc,
    });
    expect(res.status).toBe(401);
    expect(prisma.contestReport.update).not.toHaveBeenCalled();
  });

  it("returns 400 on bad status value", async () => {
    const res = await PATCH(patchRequest({ status: "garbage" }) as never, {
      params: paramsAbc,
    });
    expect(res.status).toBe(400);
  });

  it("PATCH to resolved sets status + resolvedAt", async () => {
    const res = await PATCH(patchRequest({ status: "resolved" }) as never, {
      params: paramsAbc,
    });
    expect(res.status).toBe(200);
    const call = (
      prisma.contestReport.update as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(call.where).toEqual({ id: "abc-uuid" });
    expect(call.data.status).toBe("resolved");
    expect(call.data.resolvedAt).toBeInstanceOf(Date);
  });

  it("PATCH to dismissed sets status + resolvedAt", async () => {
    const res = await PATCH(patchRequest({ status: "dismissed" }) as never, {
      params: paramsAbc,
    });
    expect(res.status).toBe(200);
    const call = (
      prisma.contestReport.update as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(call.data.status).toBe("dismissed");
  });

  it("idempotent on already-terminal report (no-op + 200)", async () => {
    (
      prisma.contestReport.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: "abc-uuid",
      status: "resolved",
    });
    const res = await PATCH(patchRequest({ status: "dismissed" }) as never, {
      params: paramsAbc,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, skipped: "already_terminal" });
    expect(prisma.contestReport.update).not.toHaveBeenCalled();
  });

  it("returns 404 on missing report", async () => {
    (
      prisma.contestReport.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);
    const res = await PATCH(patchRequest({ status: "resolved" }) as never, {
      params: paramsAbc,
    });
    expect(res.status).toBe(404);
  });
});
