import { NextRequest, NextResponse } from "next/server";
import { EventSeriesType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import {
  badRequest,
  enumValue,
  nullableBigIntId,
  nullableString,
  originalLanguage as parseOriginalLanguage,
  parseJsonBody,
  parseLocalizedTranslations,
  requireString,
} from "@/lib/admin-input";

type Props = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const seriesId = BigInt(id);
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  const typeCheck = enumValue(body.type, "type", Object.values(EventSeriesType));
  if (!typeCheck.ok) return badRequest(typeCheck.message);

  const artistIdCheck = nullableBigIntId(body.artistId, "artistId");
  if (!artistIdCheck.ok) return badRequest(artistIdCheck.message);

  const parentSeriesIdCheck = nullableBigIntId(body.parentSeriesId, "parentSeriesId");
  if (!parentSeriesIdCheck.ok) return badRequest(parentSeriesIdCheck.message);

  const organizerName = nullableString(body.organizerName, "organizerName");
  if (!organizerName.ok) return badRequest(organizerName.message);

  const { hasBoard } = body as { hasBoard?: boolean };

  const name = requireString(body.originalName, "originalName");
  if (!name.ok) return badRequest(name.message);

  const shortName = nullableString(body.originalShortName, "originalShortName");
  if (!shortName.ok) return badRequest(shortName.message);

  const description = nullableString(body.originalDescription, "originalDescription");
  if (!description.ok) return badRequest(description.message);

  const language = parseOriginalLanguage(body.originalLanguage);
  if (!language.ok) return badRequest(language.message);

  const translations = parseLocalizedTranslations(body.translations);
  if (!translations.ok) return badRequest(translations.message);

  await prisma.eventSeriesTranslation.deleteMany({ where: { eventSeriesId: seriesId } });

  const series = await prisma.eventSeries.update({
    where: { id: seriesId },
    data: {
      type: typeCheck.value,
      artistId: artistIdCheck.value,
      parentSeriesId: parentSeriesIdCheck.value,
      organizerName: organizerName.value,
      hasBoard: hasBoard ?? false,
      originalName: name.value,
      originalShortName: shortName.value,
      originalDescription: description.value,
      originalLanguage: language.value,
      translations: { create: translations.value },
    },
    include: { translations: true },
  });
  return NextResponse.json(serializeBigInt(series));
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  await prisma.eventSeries.update({
    where: { id: BigInt(id) },
    data: { isDeleted: true, deletedAt: new Date() },
  });
  return NextResponse.json({ success: true });
}
