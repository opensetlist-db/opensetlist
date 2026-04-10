import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";

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

  const series = await prisma.eventSeries.create({
    data: {
      type,
      artistId: artistId ? BigInt(artistId) : null,
      parentSeriesId: parentSeriesId ? BigInt(parentSeriesId) : null,
      organizerName: organizerName || null,
      hasBoard: hasBoard ?? false,
      translations: {
        create: translations.map(
          (t: { locale: string; name: string; description?: string }) => ({
            locale: t.locale,
            name: t.name,
            description: t.description || null,
          })
        ),
      },
    },
    include: { translations: true },
  });
  return NextResponse.json(serializeBigInt(series), { status: 201 });
}
