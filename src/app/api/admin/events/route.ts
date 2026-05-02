import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { EventStatus, EventType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { resolveCanonicalSlug } from "@/lib/slug";
import {
  badRequest,
  enumValue,
  nullableEnumValue,
  nullableString,
  nullableStringArray,
  parseJsonBody,
} from "@/lib/admin-input";
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

export async function POST(request: NextRequest) {
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const typeCheck = enumValue(body.type, "type", Object.values(EventType));
  if (!typeCheck.ok) return badRequest(typeCheck.message);

  const statusCheck = nullableEnumValue(body.status, "status", Object.values(EventStatus));
  if (!statusCheck.ok) return badRequest(statusCheck.message);

  const country = nullableString(body.country, "country");
  if (!country.ok) return badRequest(country.message);

  const posterUrl = nullableString(body.posterUrl, "posterUrl");
  if (!posterUrl.ok) return badRequest(posterUrl.message);

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

  const performerIdsCheck = nullableStringArray(body.performerIds, "performerIds");
  if (!performerIdsCheck.ok) return badRequest(performerIdsCheck.message);
  const performerIds = performerIdsCheck.value;

  const guestIdsCheck = nullableStringArray(body.guestIds, "guestIds");
  if (!guestIdsCheck.ok) return badRequest(guestIdsCheck.message);
  const guestIds = guestIdsCheck.value;

  const dupErr = validatePerformerGuestIds(performerIds, guestIds);
  if (dupErr) return dupErr;

  const slugResult = await resolveCanonicalSlug(body.slug, translations[0].name, "event");
  if (!slugResult.ok) return badRequest(slugResult.message);
  const slug = slugResult.slug;

  try {
    const event = await prisma.$transaction(async (tx) => {
      await ensureStageIdentitiesExist(tx, [...performerIds, ...guestIds]);

      const created = await tx.event.create({
        data: {
          slug,
          type: typeCheck.value,
          status: statusCheck.value ?? "scheduled",
          eventSeriesId,
          date,
          startTime,
          country: country.value,
          posterUrl: posterUrl.value,
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
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        {
          error: `슬러그 '${slug}'가 이미 사용 중입니다. 다른 슬러그를 입력하세요.`,
        },
        { status: 409 }
      );
    }
    throw err;
  }
}
