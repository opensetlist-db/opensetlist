import { parseBonusPurchaseFields, PurchaseInputError } from "@/lib/adminPurchaseFields";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { parseBonusTranslations } from "@/lib/adminParsers";
import { revalidatePublicData } from "@/lib/dataCache";

type CreateBody = Record<string, unknown> & {
  listingId?: unknown;
  originalBonusType?: unknown;
  originalLanguage?: unknown;
  translations?: unknown;
};

export async function POST(request: NextRequest) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
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
    const purchase = parseBonusPurchaseFields(body);
    const created = await prisma.albumStoreBonus.create({
      data: {
        ...purchase,
        listingId,
        originalBonusType: (body.originalBonusType as string).trim(),
        originalLanguage,
        translations: {
          create: parseBonusTranslations(body.translations),
        },
      },
      include: { translations: true },
    });
    revalidatePublicData();
    return NextResponse.json(serializeBigInt(created), { status: 201 });
  } catch (e) {
    if (e instanceof PurchaseInputError) return NextResponse.json({ error: e.message }, { status: 400 });
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
