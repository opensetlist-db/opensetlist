import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { parseBonusTranslations } from "@/lib/adminParsers";

type CreateBody = {
  listingId?: unknown;
  originalBonusType?: unknown;
  originalLanguage?: unknown;
  translations?: unknown;
};

/**
 * POST /api/admin/album-bonuses
 *
 *   Body: see CreateBody
 *   → 201 { ...bonus }
 *   → 400 invalid input
 *   → 401 unauthorized
 *   → 404 listing not found
 *
 * No unique constraint on (listingId, bonusType) by design — multiple
 * character/design variants on the same listing are intentional (e.g.
 * three 蓮ノ空 unit-themed タペストリー on one Amazon edition; the
 * operator marks the variant inside `originalBonusType` itself).
 */
export async function POST(request: NextRequest) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "잘못된 JSON입니다." }, { status: 400 });
  }

  const listingId =
    typeof body.listingId === "string" ? body.listingId.trim() : "";
  if (!listingId) {
    return NextResponse.json(
      { error: "구매처 ID가 필요합니다." },
      { status: 400 },
    );
  }
  if (
    typeof body.originalBonusType !== "string" ||
    !body.originalBonusType.trim()
  ) {
    return NextResponse.json(
      { error: "특전 종류는 필수입니다." },
      { status: 400 },
    );
  }
  const originalLanguage =
    typeof body.originalLanguage === "string" && body.originalLanguage.trim()
      ? body.originalLanguage.trim()
      : "ja";

  try {
    const created = await prisma.albumStoreBonus.create({
      data: {
        listingId,
        originalBonusType: (body.originalBonusType as string).trim(),
        originalLanguage,
        translations: {
          create: parseBonusTranslations(body.translations),
        },
      },
      include: { translations: true },
    });
    return NextResponse.json(serializeBigInt(created), { status: 201 });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2003"
    ) {
      return NextResponse.json(
        { error: "구매처를 찾을 수 없습니다." },
        { status: 404 },
      );
    }
    throw e;
  }
}
