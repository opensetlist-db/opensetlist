import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { verifyAdminAPI } from "@/lib/admin-auth";
import type { ContestReportStatus } from "@/generated/prisma/enums";

/**
 * GET /api/admin/contest-reports
 *
 *   Query params:
 *     ?status=pending|resolved|dismissed   default: pending
 *     ?eventId=N                          optional filter
 *     ?limit=N                            default 100, max 500
 *
 *   → 200 { reports: Array<{
 *       id, type, status, payload, comment, createdAt, resolvedAt,
 *       setlistItem: { id, position, eventId, event: { title, ... } },
 *     }> }
 *   → 401 unauthorized
 *
 * Backs the operator triage page at /admin/contest-reports.
 * Limited to N rows to keep the table render manageable; the
 * status filter is the primary navigation (operator works from
 * pending; resolved/dismissed tabs are reference).
 */
const ROW_LIMIT_DEFAULT = 100;
const ROW_LIMIT_MAX = 500;
const VALID_STATUSES: readonly ContestReportStatus[] = [
  "pending",
  "resolved",
  "dismissed",
];

export async function GET(request: NextRequest) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const rawStatus = url.searchParams.get("status") ?? "pending";
  const status: ContestReportStatus = VALID_STATUSES.includes(
    rawStatus as ContestReportStatus,
  )
    ? (rawStatus as ContestReportStatus)
    : "pending";

  const rawEventId = url.searchParams.get("eventId");
  let eventId: bigint | undefined;
  if (rawEventId) {
    try {
      eventId = BigInt(rawEventId);
    } catch {
      return NextResponse.json(
        { error: "invalid eventId" },
        { status: 400 },
      );
    }
  }

  const rawLimit = url.searchParams.get("limit");
  let limit = ROW_LIMIT_DEFAULT;
  if (rawLimit) {
    const parsed = Number.parseInt(rawLimit, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      limit = Math.min(parsed, ROW_LIMIT_MAX);
    }
  }

  try {
    const reports = await prisma.contestReport.findMany({
      where: {
        status,
        ...(eventId !== undefined
          ? { setlistItem: { eventId } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        setlistItem: {
          select: {
            id: true,
            position: true,
            eventId: true,
            event: {
              select: {
                id: true,
                originalName: true,
              },
            },
            songs: {
              select: {
                song: {
                  select: {
                    id: true,
                    originalTitle: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    return NextResponse.json({
      reports: serializeBigInt(reports),
    });
  } catch (err) {
    console.error("[GET /api/admin/contest-reports] db error", err);
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500 },
    );
  }
}
