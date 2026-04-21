import { NextRequest, NextResponse } from "next/server";
import type { EventSeriesType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import {
  badRequest,
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
  const { type, artistId, parentSeriesId, organizerName, hasBoard } = body as {
    type?: EventSeriesType;
    artistId?: string | number | null;
    parentSeriesId?: string | number | null;
    organizerName?: string | null;
    hasBoard?: boolean;
  };

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
      type,
      artistId: artistId ? BigInt(artistId) : null,
      parentSeriesId: parentSeriesId ? BigInt(parentSeriesId) : null,
      organizerName: organizerName || null,
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
