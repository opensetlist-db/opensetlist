import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { parseBonusTranslations } from "@/lib/adminParsers";

type RouteProps = { params: Promise<{ id: string }> };

type PatchBody = {
  originalBonusType?: unknown;
  originalLanguage?: unknown;
  translations?: unknown;
};

/**
 * PATCH /api/admin/album-bonuses/[id]
 *
 *   listingId is NOT mutable — moving a bonus between listings should
 *   go through delete-then-create so the audit trail (when a05 ships)
 *   stays sane. Translations replaced delete-then-create inside a
 *   $transaction.
 *
 *   Bonus-level lifecycle columns (`startsAt`, `endsAt`,
 *   `bonusImageUrl`, `originalBonusDescription`) intentionally NOT
 *   touched — pre-existing non-null values from CSV import or an
 *   earlier UI iteration stay intact.
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
    typeof body.originalBonusType !== "string" ||
    !body.originalBonusType.trim()
  ) {
    return NextResponse.json(
      { error: "특전 종류는 필수입니다." },
      { status: 400 },
    );
  }

  // Same contract as the sibling listings/tracks PATCHes: missing
  // `translations` field = preserve existing rows; explicit empty
  // array = full-replace wipe. Anything else (null / object /
  // string) hits 400 — without that guard the parser falls through
  // to `[]` and the operator's locale rows would be silently wiped
  // by the deleteMany on a malformed request.
  if (
    body.translations !== undefined &&
    !Array.isArray(body.translations)
  ) {
    return NextResponse.json(
      { error: "translations 필드는 배열이어야 합니다." },
      { status: 400 },
    );
  }
  const translationsProvided = Array.isArray(body.translations);
  const translations = translationsProvided
    ? parseBonusTranslations(body.translations)
    : [];

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.albumStoreBonus.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) return null;

      if (translationsProvided) {
        await tx.albumStoreBonusTranslation.deleteMany({
          where: { bonusId: id },
        });
      }

      // Same whitespace-tolerant normalize as POST so a body of
      // `originalLanguage: "   "` falls back to the "ja" default
      // rather than persisting a blank.
      const originalLanguage =
        typeof body.originalLanguage === "string" &&
        body.originalLanguage.trim()
          ? body.originalLanguage.trim()
          : "ja";

      return tx.albumStoreBonus.update({
        where: { id },
        data: {
          originalBonusType: (body.originalBonusType as string).trim(),
          originalLanguage,
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
        { error: "특전을 찾을 수 없습니다." },
        { status: 404 },
      );
    }
    return NextResponse.json(serializeBigInt(updated));
  } catch (e) {
    // Race window: in-tx findUnique passed but a concurrent DELETE
    // removed the row before update landed.
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
