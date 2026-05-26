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

type CreateBody = {
  albumId?: unknown;
  originalStoreName?: unknown;
  originalEditionLabel?: unknown;
  originalLanguage?: unknown;
  productUrl?: unknown;
  status?: unknown;
  translations?: unknown;
};

/**
 * POST /api/admin/album-listings
 *
 *   Body: see CreateBody
 *   → 201 { ...listing }
 *   → 400 invalid input
 *   → 401 unauthorized
 *   → 409 unique conflict (album × originalStoreName × originalEditionLabel)
 *
 * Lifecycle columns (startsAt/endsAt/lastVerifiedAt/sourceUrl) stay
 * on the schema but the admin form doesn't surface them — they end
 * up as NULL on rows created here. A future iteration can re-add
 * the inputs without a schema change.
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

  if (typeof body.albumId !== "string" && typeof body.albumId !== "number") {
    return NextResponse.json(
      { error: "앨범 ID가 필요합니다." },
      { status: 400 },
    );
  }
  let albumId: bigint;
  try {
    albumId = BigInt(body.albumId as string | number);
  } catch {
    return NextResponse.json(
      { error: "유효하지 않은 앨범 ID입니다." },
      { status: 400 },
    );
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

  const translations = parseListingTranslations(body.translations);

  try {
    const created = await prisma.albumStoreListing.create({
      data: {
        albumId,
        originalStoreName: (body.originalStoreName as string).trim(),
        originalEditionLabel:
          typeof body.originalEditionLabel === "string" &&
          body.originalEditionLabel.trim()
            ? body.originalEditionLabel.trim()
            : null,
        originalLanguage:
          typeof body.originalLanguage === "string" && body.originalLanguage
            ? body.originalLanguage
            : "ja",
        productUrl:
          typeof body.productUrl === "string" && body.productUrl.trim()
            ? body.productUrl.trim()
            : null,
        status: body.status as AlbumStoreListingStatus,
        translations: translations.length
          ? { create: translations }
          : undefined,
      },
      include: { translations: true },
    });
    return NextResponse.json(serializeBigInt(created), { status: 201 });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "이미 같은 매장의 동일 에디션 항목이 있습니다." },
        { status: 409 },
      );
    }
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2003"
    ) {
      // FK target (albumId) not found — the referenced album doesn't
      // exist. Standardize on 404 across admin create routes (the
      // same shape as album-bonuses POST and the conventional
      // semantic for "referenced resource missing").
      return NextResponse.json(
        { error: "앨범을 찾을 수 없습니다." },
        { status: 404 },
      );
    }
    throw e;
  }
}
