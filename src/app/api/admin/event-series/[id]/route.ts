import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";

type Props = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const seriesId = BigInt(id);
  const body = await request.json();
  const { type, artistId, parentSeriesId, organizerName, hasBoard, translations } = body;

  await prisma.eventSeriesTranslation.deleteMany({ where: { eventSeriesId: seriesId } });

  const series = await prisma.eventSeries.update({
    where: { id: seriesId },
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
