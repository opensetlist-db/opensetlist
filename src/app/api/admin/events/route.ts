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
    date,
    country,
    posterUrl,
    startTime,
    translations,
    performerIds = [],
    guestIds = [],
  } = body;

  if (!startTime) {
    return NextResponse.json(
      { error: "startTime is required" },
      { status: 400 }
    );
  }

  const slug = body.slug || generateSlug(translations[0]?.name || `event-${Date.now()}`);

  const event = await prisma.event.create({
    data: {
      slug,
      type,
      status: status ?? "scheduled",
      eventSeriesId: eventSeriesId ? BigInt(eventSeriesId) : null,
      date: date ? new Date(date) : null,
      startTime: new Date(startTime),
      country: country || null,
      posterUrl: posterUrl || null,
      translations: {
        create: translations.map(
          (t: {
            locale: string;
            name: string;
            shortName?: string | null;
            city?: string | null;
            venue?: string | null;
          }) => ({
            locale: t.locale,
            name: t.name,
            shortName: t.shortName || null,
            city: t.city || null,
            venue: t.venue || null,
          })
        ),
      },
    },
    include: { translations: true },
  });

  const performerRows = [
    ...(performerIds as string[]).map((id) => ({
      eventId: event.id,
      stageIdentityId: id,
      isGuest: false,
    })),
    ...(guestIds as string[]).map((id) => ({
      eventId: event.id,
      stageIdentityId: id,
      isGuest: true,
    })),
  ];
  if (performerRows.length > 0) {
    await prisma.eventPerformer.createMany({
      data: performerRows,
      skipDuplicates: true,
    });
  }

  return NextResponse.json(serializeBigInt(event), { status: 201 });
}
