import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { verifyAdminAPI } from "@/lib/admin-auth";

type RouteProps = { params: Promise<{ id: string }> };

type PatchBody = {
  originalBonusType?: unknown;
  originalBonusDescription?: unknown;
  originalLanguage?: unknown;
  bonusImageUrl?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  translations?: unknown;
};

function parseDate(value: unknown): Date | null | "invalid" {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return "invalid";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

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
 * PATCH /api/admin/album-bonuses/[id]
 *
 *   listingId is NOT mutable — moving a bonus between listings should
 *   go through delete-then-create so the audit trail (when a05 ships)
 *   stays sane. Translations replaced delete-then-create inside a
 *   $transaction.
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

  const startsAt = parseDate(body.startsAt);
  const endsAt = parseDate(body.endsAt);
  if (startsAt === "invalid" || endsAt === "invalid") {
    return NextResponse.json(
      { error: "날짜 형식이 잘못되었습니다." },
      { status: 400 },
    );
  }

  const translations = parseTranslations(body.translations);

  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.albumStoreBonus.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) return null;

    await tx.albumStoreBonusTranslation.deleteMany({ where: { bonusId: id } });

    return tx.albumStoreBonus.update({
      where: { id },
      data: {
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
        translations: translations.length
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
