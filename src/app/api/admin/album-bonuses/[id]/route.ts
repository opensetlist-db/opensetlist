import { parseBonusPurchaseFields, PurchaseInputError } from "@/lib/adminPurchaseFields";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { parseBonusTranslations } from "@/lib/adminParsers";
import { revalidatePublicData } from "@/lib/dataCache";

type RouteProps = { params: Promise<{ id: string }> };

type PatchBody = Record<string, unknown> & {
  originalBonusType?: unknown;
  originalLanguage?: unknown;
  translations?: unknown;
};

export async function PATCH(request: NextRequest, { params }: RouteProps) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "잘못된 ID입니다." }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch {
    return NextResponse.json({ error: "잘못된 JSON입니다." }, { status: 400 });
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

  if (
    body.translations !== undefined &&
    (!Array.isArray(body.translations) || body.translations.some((row) =>
      !row || typeof row !== "object" || typeof row.locale !== "string"))
  ) {
    return NextResponse.json(
      { error: "translations 필드는 배열이어야 합니다." },
      { status: 400 },
    );
  }
  const removed = body.removedTranslationLocales;
  if (removed !== undefined && (!Array.isArray(removed) || removed.some((locale) => typeof locale !== "string"))) {
    return NextResponse.json({ error: "삭제할 번역 언어를 확인해 주세요." }, { status: 400 });
  }
  const translationsProvided = Array.isArray(body.translations);
  const translations = translationsProvided
    ? parseBonusTranslations(body.translations)
    : [];

  try {
    const purchase = parseBonusPurchaseFields(body);
    const originalLanguage = typeof body.originalLanguage === "string"
      ? body.originalLanguage.trim() || "ja"
      : "ja";
    const updated = await prisma.albumStoreBonus.update({
      where: { id },
      data: {
        ...purchase,
        originalBonusType: (body.originalBonusType as string).trim(),
        originalLanguage,
        translations: translationsProvided || removed !== undefined ? {
          deleteMany: removed !== undefined
              ? { locale: { in: removed.filter((locale) => !translations.some((row) => row.locale === locale)) } }
              : translationsProvided && translations.length === 0 ? {} : undefined,
          upsert: translations.map((row) => ({
            where: { bonusId_locale: { bonusId: id, locale: row.locale } },
            create: row,
            update: row,
          })),
        } : undefined,
      },
      include: { translations: true },
    });
    revalidatePublicData();
    return NextResponse.json(serializeBigInt(updated));
  } catch (e) {
    if (e instanceof PurchaseInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2025"
    ) {
      return NextResponse.json(
        { error: "특전을 찾을 수 없습니다." },
        { status: 404 },
      );
    }
    throw e;
  }
}

/**
 * DELETE /api/admin/album-bonuses/[id]
 *
 *   Hard delete. Cascades to AlbumStoreBonusTranslation per schema.
 */
export async function DELETE(_request: NextRequest, { params }: RouteProps) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "잘못된 ID입니다." }, { status: 400 });
  }

  try {
    await prisma.albumStoreBonus.delete({ where: { id } });
    revalidatePublicData();
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2025"
    ) {
      return NextResponse.json(
        { error: "특전을 찾을 수 없습니다." },
        { status: 404 },
      );
    }
    throw e;
  }
}
