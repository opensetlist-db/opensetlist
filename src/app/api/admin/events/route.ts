import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { generateSlug } from "@/lib/slug";

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
    country,
    posterUrl,
    startTime,
    translations,
  } = body;

  const slug = body.slug || generateSlug(translations[0]?.name || `event-${Date.now()}`);

  const event = await prisma.event.create({
    data: {
      slug,
      type,
      status: status ?? "scheduled",
      eventSeriesId: eventSeriesId ? BigInt(eventSeriesId) : null,
      parentEventId: parentEventId ? BigInt(parentEventId) : null,
      date: date ? new Date(date) : null,
      startTime: startTime ? new Date(startTime) : null,
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
  return NextResponse.json(serializeBigInt(event), { status: 201 });
}
