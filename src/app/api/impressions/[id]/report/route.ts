import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { REPORT_HIDE_THRESHOLD } from "@/lib/config";
import { ImpressionNotFoundError } from "@/lib/impression";
import { revalidateEventImpressions } from "@/lib/dataCache";

type RouteProps = { params: Promise<{ id: string }> };

// `[id]` is the chain id (rootImpressionId). Reports attach to the
// current row of the chain — a transactional read-then-update so the
// reportCount/isHidden decision is consistent against concurrent edits.
export async function POST(_req: NextRequest, { params }: RouteProps) {
  const { id: chainId } = await params;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.eventImpression.findFirst({
        where: { rootImpressionId: chainId, supersededAt: null, isDeleted: false },
        select: { id: true, eventId: true, reportCount: true, isHidden: true },
      });
      if (!current) throw new ImpressionNotFoundError();

      const nextCount = current.reportCount + 1;
      const nextHidden = current.isHidden || nextCount >= REPORT_HIDE_THRESHOLD;

      await tx.eventImpression.update({
        where: { id: current.id },
        data: { reportCount: nextCount, isHidden: nextHidden },
      });

      return {
        eventId: current.eventId,
        reportCount: nextCount,
        isHidden: nextHidden,
      };
    });

    // A report that crosses the hide threshold removes the impression
    // from the public first page — expire its 5 s cache entry.
    if (result.isHidden) revalidateEventImpressions(result.eventId);
    return NextResponse.json({
      reportCount: result.reportCount,
      isHidden: result.isHidden,
    });
  } catch (err) {
    if (err instanceof ImpressionNotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    throw err;
  }
}
