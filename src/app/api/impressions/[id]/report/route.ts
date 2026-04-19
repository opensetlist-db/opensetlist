import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { REPORT_HIDE_THRESHOLD } from "@/lib/config";

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
        select: { id: true, reportCount: true, isHidden: true },
      });
      if (!current) throw new ImpressionNotFoundError();

      const nextCount = current.reportCount + 1;
      const nextHidden = current.isHidden || nextCount >= REPORT_HIDE_THRESHOLD;

      await tx.eventImpression.update({
        where: { id: current.id },
        data: { reportCount: nextCount, isHidden: nextHidden },
      });

      return { reportCount: nextCount, isHidden: nextHidden };
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ImpressionNotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    throw err;
  }
}

class ImpressionNotFoundError extends Error {}
