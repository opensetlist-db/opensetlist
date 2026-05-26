import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { verifyAdminAPI } from "@/lib/admin-auth";
import type { AlbumStoreListingStatus } from "@/generated/prisma/enums";

const VALID_STATUSES = new Set<AlbumStoreListingStatus>([
  "active",
  "sold_out",
  "ended",
  "unknown",
]);

type CreateBody = {
  albumId?: unknown;
  originalStoreName?: unknown;
  originalEditionLabel?: unknown;
  originalLanguage?: unknown;
  productUrl?: unknown;
  status?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  lastVerifiedAt?: unknown;
  sourceUrl?: unknown;
  translations?: unknown;
};

function parseDate(value: unknown): Date | null | "invalid" {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return "invalid";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

/**
 * POST /api/admin/album-listings
 *
 *   Body: see CreateBody above
 *   → 201 { ...listing }
 *   → 400 invalid input
 *   → 401 unauthorized
 *   → 409 unique conflict (album × originalStoreName × originalEditionLabel)
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
    !VALID_STATUSES.has(body.status as AlbumStoreListingStatus)
  ) {
    return NextResponse.json(
      { error: "잘못된 상태입니다." },
      { status: 400 },
    );
  }

  const startsAt = parseDate(body.startsAt);
  const endsAt = parseDate(body.endsAt);
  const lastVerifiedAt = parseDate(body.lastVerifiedAt);
  if (
    startsAt === "invalid" ||
    endsAt === "invalid" ||
    lastVerifiedAt === "invalid"
  ) {
    return NextResponse.json(
      { error: "날짜 형식이 잘못되었습니다." },
      { status: 400 },
    );
  }

  const translations = Array.isArray(body.translations)
    ? (
        body.translations as Array<{
          locale: unknown;
          storeName?: unknown;
          editionLabel?: unknown;
        }>
      )
        .filter((t) => typeof t.locale === "string")
        .map((t) => ({
          locale: t.locale as string,
          storeName:
            typeof t.storeName === "string" && t.storeName.trim()
              ? t.storeName.trim()
              : null,
          editionLabel:
            typeof t.editionLabel === "string" && t.editionLabel.trim()
              ? t.editionLabel.trim()
              : null,
        }))
    : [];

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
        startsAt,
        endsAt,
        lastVerifiedAt,
        sourceUrl:
          typeof body.sourceUrl === "string" && body.sourceUrl.trim()
            ? body.sourceUrl.trim()
            : null,
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
      return NextResponse.json(
        { error: "앨범을 찾을 수 없습니다." },
        { status: 400 },
      );
    }
    throw e;
  }
}
