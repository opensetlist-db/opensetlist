import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { generateSlug } from "@/lib/slug";
import {
  badRequest,
  nullableString,
  originalLanguage as parseOriginalLanguage,
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
  const body = await request.json();
  const { type, artistId, parentSeriesId, organizerName, hasBoard } = body;

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

  const slug = body.slug || generateSlug(translations.value[0]?.name || `series-${Date.now()}`);

  const series = await prisma.eventSeries.create({
    data: {
      slug,
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
  return NextResponse.json(serializeBigInt(series), { status: 201 });
}
