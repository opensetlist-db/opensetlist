import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyAdminAPI } from "@/lib/admin-auth";

type RouteProps = { params: Promise<{ id: string }> };

// `[id]` is the chain id (rootImpressionId). Soft-delete and restore
// operate on the entire chain — every version of an impression follows
// its head's moderation state.
export async function DELETE(_req: NextRequest, { params }: RouteProps) {
  const unauth = await verifyAdminAPI();
  if (unauth) return unauth;

  const { id: chainId } = await params;

  const result = await prisma.eventImpression.updateMany({
    where: { rootImpressionId: chainId },
    data: {
      isDeleted: true,
      deletedAt: new Date(),
    },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

export async function PATCH(_req: NextRequest, { params }: RouteProps) {
  const unauth = await verifyAdminAPI();
  if (unauth) return unauth;

  const { id: chainId } = await params;

  // Restore the whole chain, then reset moderation flags on the current
  // row only — older superseded rows should not have their state mutated.
  const [restored] = await prisma.$transaction([
    prisma.eventImpression.updateMany({
      where: { rootImpressionId: chainId },
      data: { isDeleted: false, deletedAt: null },
    }),
    prisma.eventImpression.updateMany({
      where: { rootImpressionId: chainId, supersededAt: null },
      data: { isHidden: false, reportCount: 0 },
    }),
  ]);

  if (restored.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
