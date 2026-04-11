import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";

type Props = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const event = await prisma.event.findFirst({
    where: { id: BigInt(id), isDeleted: false },
    include: {
      translations: true,
      eventSeries: { include: { translations: true } },
      setlistItems: {
        where: { isDeleted: false },
        include: {
          songs: {
            include: { song: { include: { translations: true } } },
            orderBy: { order: "asc" },
          },
          performers: {
            include: {
              stageIdentity: { include: { translations: true } },
            },
          },
        },
        orderBy: { position: "asc" },
      },
    },
  });
  if (!event) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(serializeBigInt(event));
}

export async function PUT(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const eventId = BigInt(id);
  const body = await request.json();
  const {
    type,
    status,
    eventSeriesId,
    parentEventId,
    date,
    country,
    translations,
  } = body;

  await prisma.eventTranslation.deleteMany({ where: { eventId } });

  const event = await prisma.event.update({
    where: { id: eventId },
    data: {
      type,
      status: status ?? "upcoming",
      eventSeriesId: eventSeriesId ? BigInt(eventSeriesId) : null,
      parentEventId: parentEventId ? BigInt(parentEventId) : null,
      date: date ? new Date(date) : null,
      country: country || null,
      translations: {
        create: translations.map(
          (t: { locale: string; name: string }) => ({
            locale: t.locale,
            name: t.name,
          })
        ),
      },
    },
    include: { translations: true },
  });
  return NextResponse.json(serializeBigInt(event));
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  await prisma.event.update({
    where: { id: BigInt(id) },
    data: { isDeleted: true, deletedAt: new Date() },
  });
  return NextResponse.json({ success: true });
}
