import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyAdminAPI } from "@/lib/admin-auth";
import type { ContestReportStatus } from "@/generated/prisma/enums";

type RouteProps = { params: Promise<{ id: string }> };

/**
 * PATCH /api/admin/contest-reports/[id]
 *
 *   Body: { status: "resolved" | "dismissed" }
 *   → 200 { ok: true }
 *   → 401 unauthorized
 *   → 404 not found
 *
 * Operator action endpoint — flips the report's status and stamps
 * `resolvedAt` when transitioning to a terminal state. Idempotent:
 * a PATCH against an already-terminal report is a no-op (updates
 * zero rows but returns 200 either way; operator UI re-renders
 * the list).
 *
 * Auto-apply (e.g., for type=wrong_song, swap the row's
 * SetlistItemSong.songId to the proposed one) is OUT OF SCOPE at
 * 1C — operator manually edits the row via the existing admin
 * row-edit page after reading the report. Phase 2 polish adds
 * per-type auto-apply.
 */

const TERMINAL_STATUSES: readonly ContestReportStatus[] = [
  "resolved",
  "dismissed",
];

export async function PATCH(request: NextRequest, { params }: RouteProps) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (body === null || typeof body !== "object") {
    return NextResponse.json(
      { error: "body must be an object" },
      { status: 400 },
    );
  }
  const { status } = body as { status?: string };
  if (
    typeof status !== "string" ||
    !TERMINAL_STATUSES.includes(status as ContestReportStatus)
  ) {
    return NextResponse.json(
      { error: "status must be 'resolved' or 'dismissed'" },
      { status: 400 },
    );
  }

  try {
    const existing = await prisma.contestReport.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "contest_report_not_found" },
        { status: 404 },
      );
    }

    // Idempotent: if already terminal, no-op succeeds.
    if (existing.status !== "pending") {
      return NextResponse.json(
        { ok: true, skipped: "already_terminal" },
      );
    }

    await prisma.contestReport.update({
      where: { id },
      data: {
        status: status as ContestReportStatus,
        resolvedAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[PATCH /api/admin/contest-reports/[id]] db error", err);
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500 },
    );
  }
}
