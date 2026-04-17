import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { REPORT_HIDE_THRESHOLD } from "@/lib/config";

type RouteProps = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: RouteProps) {
  const { id } = await params;

  const incremented = await prisma.eventImpression.updateMany({
    where: { id, isDeleted: false },
    data: { reportCount: { increment: 1 } },
  });
  if (incremented.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const row = await prisma.eventImpression.findUnique({
    where: { id },
    select: { reportCount: true, isHidden: true },
  });
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let isHidden = row.isHidden;
  if (row.reportCount >= REPORT_HIDE_THRESHOLD && !row.isHidden) {
    await prisma.eventImpression.updateMany({
      where: { id, isHidden: false },
      data: { isHidden: true },
    });
    isHidden = true;
  }

  return NextResponse.json({
    reportCount: row.reportCount,
    isHidden,
  });
}
