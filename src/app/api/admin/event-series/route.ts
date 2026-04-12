import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { generateSlug } from "@/lib/slug";

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
  const {
    type,
    artistId,
    parentSeriesId,
    organizerName,
    hasBoard,
    translations,
  } = body;

  const slug = body.slug || generateSlug(translations[0]?.name || `series-${Date.now()}`);

  const series = await prisma.eventSeries.create({
    data: {
      slug,
      type,
      artistId: artistId ? BigInt(artistId) : null,
      parentSeriesId: parentSeriesId ? BigInt(parentSeriesId) : null,
      organizerName: organizerName || null,
      hasBoard: hasBoard ?? false,
      translations: {
        create: translations.map(
          (t: { locale: string; name: string; shortName?: string | null; description?: string }) => ({
            locale: t.locale,
            name: t.name,
            shortName: t.shortName || null,
            description: t.description || null,
          })
        ),
      },
    },
    include: { translations: true },
  });
  return NextResponse.json(serializeBigInt(series), { status: 201 });
}
