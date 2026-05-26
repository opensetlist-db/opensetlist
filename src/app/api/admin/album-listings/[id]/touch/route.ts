import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyAdminAPI } from "@/lib/admin-auth";

type RouteProps = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/album-listings/[id]/touch
 *
 *   Bumps `lastVerifiedAt` to now() so periodic operator sweeps can
 *   clear the "확인 필요" stale badge (>30d) with one click. Server
 *   uses `new Date()` (absolute instant) — UI displays in UTC.
 */
export async function POST(_request: NextRequest, { params }: RouteProps) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "잘못된 ID입니다." }, { status: 400 });
  }

  try {
    const updated = await prisma.albumStoreListing.update({
      where: { id },
      data: { lastVerifiedAt: new Date() },
      select: { id: true, lastVerifiedAt: true },
    });
    return NextResponse.json({
      ok: true,
      lastVerifiedAt: updated.lastVerifiedAt,
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2025"
    ) {
      return NextResponse.json(
        { error: "구매처를 찾을 수 없습니다." },
        { status: 404 },
      );
    }
    throw e;
  }
}
