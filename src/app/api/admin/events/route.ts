import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { generateSlug } from "@/lib/slug";
import { ensureStageIdentitiesExist } from "./_validate";

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

function validateIdArray(value: unknown, field: string): string[] | NextResponse {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    return NextResponse.json(
      { error: `${field} must be an array of strings` },
      { status: 400 }
    );
  }
  return value as string[];
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
  } = body;

  if (!startTime) {
    return NextResponse.json(
      { error: "startTime is required" },
      { status: 400 }
    );
  }

  const performerIds = validateIdArray(body.performerIds, "performerIds");
  if (performerIds instanceof NextResponse) return performerIds;
  const guestIds = validateIdArray(body.guestIds, "guestIds");
  if (guestIds instanceof NextResponse) return guestIds;

  const existenceErr = await ensureStageIdentitiesExist([
    ...performerIds,
    ...guestIds,
  ]);
  if (existenceErr) return existenceErr;

  const slug = body.slug || generateSlug(translations[0]?.name || `event-${Date.now()}`);

  const event = await prisma.$transaction(async (tx) => {
    const created = await tx.event.create({
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
      ...performerIds.map((id) => ({
        eventId: created.id,
        stageIdentityId: id,
        isGuest: false,
      })),
      ...guestIds.map((id) => ({
        eventId: created.id,
        stageIdentityId: id,
        isGuest: true,
      })),
    ];
    if (performerRows.length > 0) {
      await tx.eventPerformer.createMany({
        data: performerRows,
        skipDuplicates: true,
      });
    }

    return created;
  });

  return NextResponse.json(serializeBigInt(event), { status: 201 });
}
