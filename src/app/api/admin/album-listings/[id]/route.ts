import { parseListingPurchaseFields, PurchaseInputError } from "@/lib/adminPurchaseFields";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { verifyAdminAPI } from "@/lib/admin-auth";
import type { AlbumStoreListingStatus } from "@/generated/prisma/enums";
import {
  ADMIN_WRITABLE_LISTING_STATUSES,
  parseListingTranslations,
} from "@/lib/adminParsers";
import { revalidatePublicData } from "@/lib/dataCache";

type RouteProps = { params: Promise<{ id: string }> };

type PatchBody = Record<string, unknown> & {
  originalStoreName?: unknown;
  originalEditionLabel?: unknown;
  originalLanguage?: unknown;
  status?: unknown;
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
    typeof body.originalStoreName !== "string" ||
    !body.originalStoreName.trim()
  ) {
    return NextResponse.json(
      { error: "매장 이름은 필수입니다." },
      { status: 400 },
    );
  }
  if (
    typeof body.status !== "string" ||
    !ADMIN_WRITABLE_LISTING_STATUSES.has(
      body.status as AlbumStoreListingStatus,
    )
  ) {
    return NextResponse.json(
      { error: "잘못된 상태입니다." },
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
    ? parseListingTranslations(body.translations)
    : [];

  try {
    const purchase = parseListingPurchaseFields(body);
    const updated = await prisma.albumStoreListing.update({
      where: { id },
      data: {
        ...purchase,
        revision: { increment: 1 },
        // Verified choices are no longer safe matches for the store/edition importer.
        ...(purchase.isBonusOption != null ? { optionKey: id } : {}),
        originalStoreName: (body.originalStoreName as string).trim(),
        originalEditionLabel:
          typeof body.originalEditionLabel === "string" &&
          body.originalEditionLabel.trim()
            ? body.originalEditionLabel.trim()
            : null,
        originalLanguage:
          typeof body.originalLanguage === "string" &&
          body.originalLanguage.trim()
            ? body.originalLanguage.trim()
            : "ja",

        status: body.status as AlbumStoreListingStatus,
        translations: translationsProvided || removed !== undefined ? {
          deleteMany: removed !== undefined
              ? { locale: { in: removed.filter((locale) => !translations.some((row) => row.locale === locale)) } }
              : translationsProvided && translations.length === 0 ? {} : undefined,
          upsert: translations.map((row) => ({
            where: { listingId_locale: { listingId: id, locale: row.locale } },
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
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") {
        return NextResponse.json(
          { error: "이미 같은 매장의 동일 에디션 항목이 있습니다." },
          { status: 409 },
        );
      }
      if (e.code === "P2025") {
        return NextResponse.json(
          { error: "구매처를 찾을 수 없습니다." },
          { status: 404 },
        );
      }
    }
    throw e;
  }
}

/**
 * DELETE /api/admin/album-listings/[id]
 *
 *   Hard delete. Cascades to AlbumStoreBonus and
 *   AlbumStoreListingTranslation per schema's onDelete: Cascade.
 *   No soft-delete column on this model.
 */
export async function DELETE(_request: NextRequest, { params }: RouteProps) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "잘못된 ID입니다." }, { status: 400 });
  }

  try {
    await prisma.albumStoreListing.delete({ where: { id } });
    revalidatePublicData();
    return NextResponse.json({ ok: true });
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
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      return NextResponse.json({ error: "종료·복구 이력이 있는 구매 옵션은 삭제할 수 없습니다." }, { status: 409 });
    }
    throw e;
  }
}
