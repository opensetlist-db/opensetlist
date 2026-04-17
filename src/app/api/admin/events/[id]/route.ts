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
          artists: {
            include: {
              artist: { include: { translations: true } },
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
    date,
    country,
    posterUrl,
    startTime,
    translations,
  } = body;

  if (!startTime) {
    return NextResponse.json(
      { error: "startTime is required" },
      { status: 400 }
    );
  }

  await prisma.eventTranslation.deleteMany({ where: { eventId } });

  const event = await prisma.event.update({
    where: { id: eventId },
    data: {
      type,
      // Only overwrite status when the payload explicitly carries one —
      // otherwise existing admin overrides (cancelled/ongoing/completed)
      // would be silently reset to "scheduled" on any unrelated edit.
      ...(status !== undefined ? { status } : {}),
      eventSeriesId: eventSeriesId ? BigInt(eventSeriesId) : null,
      date: date ? new Date(date) : null,
      startTime: new Date(startTime),
      country: country || null,
      posterUrl: posterUrl || null,
      translations: {
        create: translations.map(
          (t: { locale: string; name: string; shortName?: string | null }) => ({
            locale: t.locale,
            name: t.name,
            shortName: t.shortName || null,
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
