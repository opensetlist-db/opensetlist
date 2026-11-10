import { NextRequest, NextResponse } from "next/server";
import { EventSeriesType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import {
  badRequest,
  enumValue,
  nullableBigIntId,
  nullableBoolean,
  nullableString,
  originalLanguage as parseOriginalLanguage,
  parseJsonBody,
  requireString,
} from "@/lib/admin-input";
import { prepareEventLanguageWrite, seriesLanguageFields } from "@/lib/adminEventLanguage";
import { revalidatePublicData } from "@/lib/dataCache";
import { verifyAdminAPI } from "@/lib/admin-auth";

type Props = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Props) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const seriesId = BigInt(id);
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  const typeCheck = "type" in body
    ? enumValue(body.type, "type", Object.values(EventSeriesType))
    : { ok: true as const, value: undefined };
  if (!typeCheck.ok) return badRequest(typeCheck.message);

  const artistIdCheck = nullableBigIntId(body.artistId, "artistId");
  if (!artistIdCheck.ok) return badRequest(artistIdCheck.message);

  const parentSeriesIdCheck = nullableBigIntId(body.parentSeriesId, "parentSeriesId");
  if (!parentSeriesIdCheck.ok) return badRequest(parentSeriesIdCheck.message);

  const organizerName = nullableString(body.organizerName, "organizerName");
  if (!organizerName.ok) return badRequest(organizerName.message);

  const hasBoardCheck = nullableBoolean(body.hasBoard, "hasBoard");
  if (!hasBoardCheck.ok) return badRequest(hasBoardCheck.message);

  const name = "originalName" in body
    ? requireString(body.originalName, "originalName")
    : { ok: true as const, value: undefined };
  if (!name.ok) return badRequest(name.message);

  const shortName = nullableString(body.originalShortName, "originalShortName");
  if (!shortName.ok) return badRequest(shortName.message);

  const description = nullableString(body.originalDescription, "originalDescription");
  if (!description.ok) return badRequest(description.message);

  const language = "originalLanguage" in body
    ? parseOriginalLanguage(body.originalLanguage)
    : { ok: true as const, value: undefined };
  if (!language.ok) return badRequest(language.message);

  const series = await prisma.$transaction(async (tx) => {
    // Serialize the read/merge/write for concurrent edits to the same series.
    await tx.$queryRaw`SELECT id FROM "EventSeries" WHERE id = ${seriesId} FOR UPDATE`;
    const before = await tx.eventSeries.findUnique({
      where: { id: seriesId },
      select: {
        originalName: true, originalShortName: true, originalLanguage: true,
        originalDescription: true, organizerName: true, translations: true,
      },
    });
    if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const source = {
      originalName: name.value ?? before.originalName,
      originalShortName: "originalShortName" in body ? shortName.value : before.originalShortName,
      originalDescription: "originalDescription" in body ? description.value : before.originalDescription,
      originalLanguage: language.value ?? before.originalLanguage,
      organizerName: "organizerName" in body ? organizerName.value : before.organizerName,
    };
    const translations = prepareEventLanguageWrite(body, seriesLanguageFields, source, before);
    if (!translations.ok) return badRequest(translations.message);
    return tx.eventSeries.update({
      where: { id: seriesId },
      data: {
        type: typeCheck.value,
        artistId: "artistId" in body ? artistIdCheck.value : undefined,
        parentSeriesId: "parentSeriesId" in body ? parentSeriesIdCheck.value : undefined,
        hasBoard: "hasBoard" in body ? hasBoardCheck.value ?? false : undefined,
        ...source,
        translations: {
          deleteMany: translations.value.removed.length ? { locale: { in: translations.value.removed } } : undefined,
          upsert: translations.value.changed.map((row) => ({
            where: { eventSeriesId_locale: { eventSeriesId: seriesId, locale: row.locale } },
            create: row,
            update: row,
          })),
        },
      },
      include: { translations: true },
    });
  });
  if (series instanceof NextResponse) return series;
  revalidatePublicData();
  return NextResponse.json(serializeBigInt(series));
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  await prisma.eventSeries.update({
    where: { id: BigInt(id) },
    data: { isDeleted: true, deletedAt: new Date() },
  });
  revalidatePublicData();
  return NextResponse.json({ success: true });
}
