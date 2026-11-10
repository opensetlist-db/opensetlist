import { randomUUID } from "node:crypto";
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

type CreateBody = Record<string, unknown> & {
  albumId?: unknown;
  originalStoreName?: unknown;
  originalEditionLabel?: unknown;
  originalLanguage?: unknown;
  status?: unknown;
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

  const rawId = body.albumId;
  if ((typeof rawId !== "string" || !/^[1-9]\d{0,18}$/.test(rawId)) &&
    (typeof rawId !== "number" || !Number.isSafeInteger(rawId) || rawId < 1)) {
    return NextResponse.json({ error: "유효하지 않은 앨범 ID입니다." }, { status: 400 });
  }
  const albumId = BigInt(rawId);
  if (albumId > BigInt("9223372036854775807")) {
    return NextResponse.json({ error: "유효하지 않은 앨범 ID입니다." }, { status: 400 });
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
    const purchase = parseListingPurchaseFields(body);
    const id = randomUUID();
    const created = await prisma.albumStoreListing.create({
      data: {
        ...purchase,
        id,
        optionKey: purchase.isBonusOption == null ? "" : id,
        albumId,
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
        translations: translations.length
          ? { create: translations }
          : undefined,
      },
      include: { translations: true },
    });
    revalidatePublicData();
    return NextResponse.json(serializeBigInt(created), { status: 201 });
  } catch (e) {
    if (e instanceof PurchaseInputError) return NextResponse.json({ error: e.message }, { status: 400 });
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
