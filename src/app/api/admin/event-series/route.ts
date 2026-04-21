import { NextRequest, NextResponse } from "next/server";
import { EventSeriesType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { generateSlug } from "@/lib/slug";
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

export async function GET() {
  const series = await prisma.eventSeries.findMany({
    where: { isDeleted: false },
    include: {
      translations: true,
      artist: { include: { translations: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(serializeBigInt(series));
}

export async function POST(request: NextRequest) {
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

  const slug =
    (typeof body.slug === "string" && body.slug) ||
    generateSlug(translations.value[0]?.name || `series-${Date.now()}`);

  const series = await prisma.eventSeries.create({
    data: {
      slug,
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
  return NextResponse.json(serializeBigInt(series), { status: 201 });
}
