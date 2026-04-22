import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { generateSlug } from "@/lib/slug";
import { parseJsonBody } from "@/lib/admin-input";
import {
  ensureStageIdentitiesExist,
  StageIdentityNotFoundError,
  stageIdentityNotFoundResponse,
  validateDateInput,
  validateEventOriginals,
  validateEventSeriesId,
  validateEventTranslations,
  validatePerformerGuestIds,
} from "./_validate";

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
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = parsed.body as Record<string, any>;
  const { type, status, country, posterUrl } = body;

  const startTimeCheck = validateDateInput(body.startTime, "startTime", true);
  if (!startTimeCheck.ok) return startTimeCheck.response;
  const startTime = startTimeCheck.value!;

  const dateCheck = validateDateInput(body.date, "date", false);
  if (!dateCheck.ok) return dateCheck.response;
  const date = dateCheck.value;

  const seriesCheck = validateEventSeriesId(body.eventSeriesId);
  if (!seriesCheck.ok) return seriesCheck.response;
  const eventSeriesId = seriesCheck.value;

  const translationsCheck = validateEventTranslations(body.translations);
  if (!translationsCheck.ok) return translationsCheck.response;
  const translations = translationsCheck.value;

  const originalsCheck = validateEventOriginals(body);
  if (!originalsCheck.ok) return originalsCheck.response;
  const originals = originalsCheck.value;

  const performerIds = validateIdArray(body.performerIds, "performerIds");
  if (performerIds instanceof NextResponse) return performerIds;
  const guestIds = validateIdArray(body.guestIds, "guestIds");
  if (guestIds instanceof NextResponse) return guestIds;

  const dupErr = validatePerformerGuestIds(performerIds, guestIds);
  if (dupErr) return dupErr;

  const slug = body.slug || generateSlug(translations[0].name || `event-${Date.now()}`);

  try {
    const event = await prisma.$transaction(async (tx) => {
      await ensureStageIdentitiesExist(tx, [...performerIds, ...guestIds]);

      const created = await tx.event.create({
        data: {
          slug,
          type,
          status: status ?? "scheduled",
          eventSeriesId,
          date,
          startTime,
          country: country || null,
          posterUrl: posterUrl || null,
          ...originals,
          translations: { create: translations },
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
  } catch (err) {
    if (err instanceof StageIdentityNotFoundError) {
      return stageIdentityNotFoundResponse(err);
    }
    throw err;
  }
}
