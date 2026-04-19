import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import {
  ensureStageIdentitiesExist,
  StageIdentityNotFoundError,
  stageIdentityNotFoundResponse,
  validateDateInput,
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

function validateOptionalIdArray(
  value: unknown,
  field: string
): { ok: true; value: string[] | undefined } | { ok: false; response: NextResponse } {
  if (value === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `${field} must be an array of strings` },
        { status: 400 }
      ),
    };
  }
  return { ok: true, value: value as string[] };
}

export async function PUT(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const eventId = BigInt(id);
  const body = await request.json();
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
          type,
          // Only overwrite status when the payload explicitly carries one —
          // otherwise existing admin overrides (cancelled/ongoing/completed)
          // would be silently reset to "scheduled" on any unrelated edit.
          ...(status !== undefined ? { status } : {}),
          eventSeriesId,
          date,
          startTime,
          country: country || null,
          posterUrl: posterUrl || null,
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
