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

type RouteProps = { params: Promise<{ id: string }> };

type PatchBody = {
  originalStoreName?: unknown;
  originalEditionLabel?: unknown;
  originalLanguage?: unknown;
  productUrl?: unknown;
  status?: unknown;
  translations?: unknown;
};

/**
 * PATCH /api/admin/album-listings/[id]
 *
 *   Updates the fields the admin form surfaces. Lifecycle columns
 *   (startsAt/endsAt/lastVerifiedAt/sourceUrl) intentionally NOT
 *   touched — if a row carries non-null values from CSV import or
 *   an earlier UI iteration, the operator's edits don't clobber
 *   them. To clear those, hit the DB directly or wait for a future
 *   admin surface.
 *
 *   → 200 { ...listing }
 *   → 400 invalid input
 *   → 401 unauthorized
 *   → 404 not found (incl. P2025 race window)
 *   → 409 unique conflict
 */
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

  // Translations field is optional on PATCH. "Missing" = preserve
  // existing rows ("I'm only editing the URL"); "empty array" =
  // explicit full-replace wipe. Distinguishing the two avoids the
  // foot-gun where a thin client that doesn't echo translations
  // silently destroys the operator's per-locale edits.
  const translationsProvided = body.translations !== undefined;
  const translations = translationsProvided
    ? parseListingTranslations(body.translations)
    : [];

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.albumStoreListing.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) return null;

      if (translationsProvided) {
        await tx.albumStoreListingTranslation.deleteMany({
          where: { listingId: id },
        });
      }

      return tx.albumStoreListing.update({
        where: { id },
        data: {
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
          productUrl:
            typeof body.productUrl === "string" && body.productUrl.trim()
              ? body.productUrl.trim()
              : null,
          status: body.status as AlbumStoreListingStatus,
          translations:
            translationsProvided && translations.length
              ? { create: translations }
              : undefined,
        },
        include: { translations: true },
      });
    });

    if (!updated) {
      return NextResponse.json(
        { error: "구매처를 찾을 수 없습니다." },
        { status: 404 },
      );
    }
    return NextResponse.json(serializeBigInt(updated));
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") {
        return NextResponse.json(
          { error: "이미 같은 매장의 동일 에디션 항목이 있습니다." },
          { status: 409 },
        );
      }
      // Race window: in-tx findUnique passed but a concurrent DELETE
      // removed the row before update landed.
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
    throw e;
  }
}
