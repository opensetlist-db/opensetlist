import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { parseDate } from "@/lib/adminParsers";

type CreateBody = {
  listingId?: unknown;
  originalBonusType?: unknown;
  originalBonusDescription?: unknown;
  originalLanguage?: unknown;
  bonusImageUrl?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  translations?: unknown;
};

function parseTranslations(input: unknown) {
  return Array.isArray(input)
    ? (
        input as Array<{
          locale: unknown;
          bonusType?: unknown;
          bonusDescription?: unknown;
        }>
      )
        .filter((t) => typeof t.locale === "string")
        .map((t) => ({
          locale: t.locale as string,
          bonusType:
            typeof t.bonusType === "string" && t.bonusType.trim()
              ? t.bonusType.trim()
              : null,
          bonusDescription:
            typeof t.bonusDescription === "string" && t.bonusDescription.trim()
              ? t.bonusDescription.trim()
              : null,
        }))
    : [];
}

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
 * three 蓮ノ空 unit-themed タペストリー on one Amazon edition).
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

  if (typeof body.listingId !== "string" || !body.listingId) {
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

  const startsAt = parseDate(body.startsAt);
  const endsAt = parseDate(body.endsAt);
  if (startsAt === "invalid" || endsAt === "invalid") {
    return NextResponse.json(
      { error: "날짜 형식이 잘못되었습니다." },
      { status: 400 },
    );
  }

  try {
    const created = await prisma.albumStoreBonus.create({
      data: {
        listingId: body.listingId,
        originalBonusType: (body.originalBonusType as string).trim(),
        originalBonusDescription:
          typeof body.originalBonusDescription === "string" &&
          body.originalBonusDescription.trim()
            ? body.originalBonusDescription.trim()
            : null,
        originalLanguage:
          typeof body.originalLanguage === "string" && body.originalLanguage
            ? body.originalLanguage
            : "ja",
        bonusImageUrl:
          typeof body.bonusImageUrl === "string" && body.bonusImageUrl.trim()
            ? body.bonusImageUrl.trim()
            : null,
        startsAt,
        endsAt,
        translations: {
          create: parseTranslations(body.translations),
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
