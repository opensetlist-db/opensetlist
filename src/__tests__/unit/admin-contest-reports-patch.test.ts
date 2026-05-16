import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/admin-auth", () => ({
  verifyAdminAPI: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contestReport: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
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
    // Happy-path default: atomic updateMany succeeds (count=1)
    (
      prisma.contestReport.updateMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ count: 1 });
  });

  it("returns 401 without admin session", async () => {
    (verifyAdminAPI as ReturnType<typeof vi.fn>).mockResolvedValue(
      Response.json({ error: "unauthorized" }, { status: 401 }),
    );
    const res = await PATCH(patchRequest({ status: "resolved" }) as never, {
      params: paramsAbc,
    });
    expect(res.status).toBe(401);
    expect(prisma.contestReport.updateMany).not.toHaveBeenCalled();
  });

  it("returns 400 on bad status value", async () => {
    const res = await PATCH(patchRequest({ status: "garbage" }) as never, {
      params: paramsAbc,
    });
    expect(res.status).toBe(400);
    // Korean message + machine-readable errorCode per CLAUDE.md
    // admin-i18n exemption.
    const body = await res.json();
    expect(body.errorCode).toBe("invalid_status");
    expect(typeof body.message).toBe("string");
  });

  it("PATCH to resolved uses atomic updateMany with pending guard", async () => {
    const res = await PATCH(patchRequest({ status: "resolved" }) as never, {
      params: paramsAbc,
    });
    expect(res.status).toBe(200);
    const call = (
      prisma.contestReport.updateMany as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    // `where` MUST include `status: "pending"` — that's the atomic
    // primitive closing the read-then-write TOCTOU race two
    // operators racing to resolve the same report.
    expect(call.where).toEqual({ id: "abc-uuid", status: "pending" });
    expect(call.data.status).toBe("resolved");
    expect(call.data.resolvedAt).toBeInstanceOf(Date);
  });

  it("PATCH to dismissed uses the same atomic primitive", async () => {
    const res = await PATCH(patchRequest({ status: "dismissed" }) as never, {
      params: paramsAbc,
    });
    expect(res.status).toBe(200);
    const call = (
      prisma.contestReport.updateMany as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(call.data.status).toBe("dismissed");
  });

  it("idempotent on already-terminal report (count=0 + existing row → 200 no-op)", async () => {
    (
      prisma.contestReport.updateMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ count: 0 });
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
  });

  it("returns 404 on missing report (count=0 + findUnique returns null)", async () => {
    (
      prisma.contestReport.updateMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ count: 0 });
    (
      prisma.contestReport.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);
    const res = await PATCH(patchRequest({ status: "resolved" }) as never, {
      params: paramsAbc,
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.errorCode).toBe("contest_report_not_found");
  });
});
