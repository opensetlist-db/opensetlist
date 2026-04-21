import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { generateSlug } from "@/lib/slug";
import { resolveOriginalLanguage } from "@/lib/csv-parse";

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

type IncomingTranslation = {
  locale: string;
  name: string;
  shortName?: string | null;
  description?: string | null;
};

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    type,
    artistId,
    parentSeriesId,
    organizerName,
    hasBoard,
    translations,
    originalName,
    originalShortName,
    originalDescription,
    originalLanguage,
  } = body;

  const trimmedOriginalName = typeof originalName === "string" ? originalName.trim() : "";
  if (!trimmedOriginalName) {
    return NextResponse.json(
      { error: "originalName is required" },
      { status: 400 }
    );
  }

  let resolvedOriginalLanguage: string;
  try {
    resolvedOriginalLanguage = resolveOriginalLanguage(originalLanguage);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  const slug = body.slug || generateSlug(translations[0]?.name || `series-${Date.now()}`);

  const series = await prisma.eventSeries.create({
    data: {
      slug,
      type,
      artistId: artistId ? BigInt(artistId) : null,
      parentSeriesId: parentSeriesId ? BigInt(parentSeriesId) : null,
      organizerName: organizerName || null,
      hasBoard: hasBoard ?? false,
      originalName: trimmedOriginalName,
      originalShortName: originalShortName?.trim() || null,
      originalDescription: originalDescription?.trim() || null,
      originalLanguage: resolvedOriginalLanguage,
      translations: {
        create: translations.map((t: IncomingTranslation) => ({
          locale: t.locale,
          name: t.name,
          shortName: t.shortName?.trim() || null,
          description: t.description?.trim() || null,
        })),
      },
    },
    include: { translations: true },
  });
  return NextResponse.json(serializeBigInt(series), { status: 201 });
}
