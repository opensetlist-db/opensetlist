import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { REPORT_HIDE_THRESHOLD } from "@/lib/config";

type RouteProps = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: RouteProps) {
  const { id } = await params;

  let iid: bigint;
  try {
    iid = BigInt(id);
  } catch {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const existing = await prisma.eventImpression.findFirst({
    where: { id: iid, isDeleted: false },
    select: { id: true, reportCount: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const nextCount = existing.reportCount + 1;
  const shouldHide = nextCount >= REPORT_HIDE_THRESHOLD;

  const updated = await prisma.eventImpression.update({
    where: { id: iid },
    data: {
      reportCount: nextCount,
      isHidden: shouldHide ? true : undefined,
    },
    select: { reportCount: true, isHidden: true },
  });

  return NextResponse.json({
    reportCount: updated.reportCount,
    isHidden: updated.isHidden,
  });
}
