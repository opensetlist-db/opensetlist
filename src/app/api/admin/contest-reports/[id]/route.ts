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
 *   → 200 { ok: true, skipped: "already_terminal" }    (idempotent no-op)
 *   → 400 { errorCode, message }
 *   → 401 unauthorized
 *   → 404 { errorCode, message }
 *
 * Operator action endpoint — flips the report's status and stamps
 * `resolvedAt` when transitioning to a terminal state. Idempotent
 * via an atomic `updateMany` filter on `status: "pending"`: if zero
 * rows updated, a follow-up findUnique distinguishes "not found"
 * (404) from "already terminal" (200 no-op).
 *
 * Error responses use `{ errorCode, message }` shape per CLAUDE.md
 * admin-i18n exemption — `errorCode` stays English for machine
 * parsing (telemetry, alerting), `message` is Korean for the
 * operator-facing surfaces (e.g. inline alert strings rendered by
 * the admin client).
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
    return NextResponse.json(
      { errorCode: "invalid_id", message: "유효하지 않은 요청 ID입니다." },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { errorCode: "invalid_json", message: "잘못된 JSON입니다." },
      { status: 400 },
    );
  }
  if (body === null || typeof body !== "object") {
    return NextResponse.json(
      { errorCode: "invalid_body", message: "요청 본문은 객체여야 합니다." },
      { status: 400 },
    );
  }
  const { status } = body as { status?: string };
  if (
    typeof status !== "string" ||
    !TERMINAL_STATUSES.includes(status as ContestReportStatus)
  ) {
    return NextResponse.json(
      {
        errorCode: "invalid_status",
        message: "상태는 'resolved' 또는 'dismissed'여야 합니다.",
      },
      { status: 400 },
    );
  }

  try {
    // Atomic conditional update: only flip if the row is still
    // `pending`. Closes the TOCTOU race the previous two-step
    // (findUnique then update) pattern had — two operators racing
    // to resolve the same report at exact same moment would both
    // pass the existence check + the status check, then both
    // update, double-stamping resolvedAt.
    const result = await prisma.contestReport.updateMany({
      where: { id, status: "pending" },
      data: {
        status: status as ContestReportStatus,
        resolvedAt: new Date(),
      },
    });

    if (result.count === 1) {
      return NextResponse.json({ ok: true });
    }

    // Zero rows updated. Distinguish "report doesn't exist" (404)
    // from "report exists but already terminal" (200 idempotent
    // no-op) so the operator UI can render the right message.
    const existing = await prisma.contestReport.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!existing) {
      return NextResponse.json(
        {
          errorCode: "contest_report_not_found",
          message: "해당 정정 요청을 찾을 수 없습니다.",
        },
        { status: 404 },
      );
    }
    // Already resolved/dismissed by a parallel operator action.
    return NextResponse.json({ ok: true, skipped: "already_terminal" });
  } catch (err) {
    console.error("[PATCH /api/admin/contest-reports/[id]] db error", err);
    return NextResponse.json(
      {
        errorCode: "internal_error",
        message: "처리 중 오류가 발생했습니다.",
      },
      { status: 500 },
    );
  }
}
