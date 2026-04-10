import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";

export async function GET() {
  const events = await prisma.event.findMany({
    where: { isDeleted: false },
    include: {
      translations: true,
      eventSeries: { include: { translations: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json(serializeBigInt(events));
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    type,
    status,
    eventSeriesId,
    parentEventId,
    date,
    venue,
    city,
    country,
    translations,
  } = body;

  const event = await prisma.event.create({
    data: {
      type,
      status: status ?? "upcoming",
      eventSeriesId: eventSeriesId ? BigInt(eventSeriesId) : null,
      parentEventId: parentEventId ? BigInt(parentEventId) : null,
      date: date ? new Date(date) : null,
      venue: venue || null,
      city: city || null,
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
  return NextResponse.json(serializeBigInt(event), { status: 201 });
}
