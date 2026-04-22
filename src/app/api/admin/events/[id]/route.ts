import { NextRequest, NextResponse } from "next/server";
import { EventStatus, EventType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import {
  badRequest,
  enumValue,
  nullableEnumValue,
  nullableString,
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
} from "../_validate";

type Props = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const event = await prisma.event.findFirst({
    where: { id: BigInt(id), isDeleted: false },
    include: {
      translations: true,
      eventSeries: { include: { translations: true } },
      performers: {
        include: {
          stageIdentity: {
            include: {
              translations: true,
              artistLinks: {
                include: { artist: { include: { translations: true } } },
              },
            },
          },
        },
      },
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

// PUT-specific: undefined → "don't replace this side". For non-undefined values
// reuse the same trim + reject-empty rules as nullableStringArray so blank IDs
// can't sneak past into ensureStageIdentitiesExist.
function validateOptionalIdArray(
  value: unknown,
  field: string
): { ok: true; value: string[] | undefined } | { ok: false; response: NextResponse } {
  if (value === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(value)) {
    return { ok: false, response: badRequest(`${field} must be an array of strings`) };
  }
  const trimmed: string[] = [];
  for (const v of value) {
    if (typeof v !== "string") {
      return { ok: false, response: badRequest(`${field} must be an array of strings`) };
    }
    const t = v.trim();
    if (t.length === 0) {
      return { ok: false, response: badRequest(`${field} must not contain empty strings`) };
    }
    trimmed.push(t);
  }
  return { ok: true, value: trimmed };
}

export async function PUT(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const eventId = BigInt(id);
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

  const performerCheck = validateOptionalIdArray(body.performerIds, "performerIds");
  if (!performerCheck.ok) return performerCheck.response;
  const guestCheck = validateOptionalIdArray(body.guestIds, "guestIds");
  if (!guestCheck.ok) return guestCheck.response;
  const performerIds = performerCheck.value;
  const guestIds = guestCheck.value;

  const dupErr = validatePerformerGuestIds(performerIds, guestIds);
  if (dupErr) return dupErr;

  try {
    const event = await prisma.$transaction(async (tx) => {
      await ensureStageIdentitiesExist(tx, [
        ...(performerIds ?? []),
        ...(guestIds ?? []),
      ]);

      await tx.eventTranslation.deleteMany({ where: { eventId } });

      const updated = await tx.event.update({
        where: { id: eventId },
        data: {
          type: typeCheck.value,
          // Only overwrite status when the payload explicitly carries one —
          // otherwise existing admin overrides (cancelled/ongoing/completed)
          // would be silently reset to "scheduled" on any unrelated edit.
          ...(statusCheck.value !== null ? { status: statusCheck.value } : {}),
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

      // Only replace rows for the side(s) the payload explicitly includes —
      // an update to performers alone must not wipe existing guests, and vice
      // versa. Same preservation rationale as `status` above.
      async function replaceEventPerformers(ids: string[], isGuest: boolean) {
        await tx.eventPerformer.deleteMany({ where: { eventId, isGuest } });
        if (ids.length === 0) return;
        await tx.eventPerformer.createMany({
          data: ids.map((sid) => ({ eventId, stageIdentityId: sid, isGuest })),
          skipDuplicates: true,
        });
      }

      if (performerIds !== undefined) {
        await replaceEventPerformers(performerIds, false);
      }
      if (guestIds !== undefined) {
        await replaceEventPerformers(guestIds, true);
      }

      return updated;
    });

    return NextResponse.json(serializeBigInt(event));
  } catch (err) {
    if (err instanceof StageIdentityNotFoundError) {
      return stageIdentityNotFoundResponse(err);
    }
    throw err;
  }
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  await prisma.event.update({
    where: { id: BigInt(id) },
    data: { isDeleted: true, deletedAt: new Date() },
  });
  return NextResponse.json({ success: true });
}
