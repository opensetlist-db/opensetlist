import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { EventStatus, EventType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
  liveWriterTransaction,
  withAdminLiveWriterBusy,
} from "@/lib/liveWriterTx";
import { serializeBigInt } from "@/lib/utils";
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
  fkViolationResponse,
  StageIdentityNotFoundError,
  stageIdentityNotFoundResponse,
  validateArtistId,
  validateBdAlbumId,
  validateDateInput,
  validateEngagementOpensAt,
  checkOpensAtBeforeStart,
  validateEventOriginals,
  validateEventSeriesId,
  validateEventTranslations,
  validatePerformerGuestIds,
} from "../_validate";
import { revalidateEventData, revalidatePublicData } from "@/lib/dataCache";
import { verifyAdminAPI } from "@/lib/admin-auth";
import {
  bumpSetlistRevisionAndBroadcast,
  lockEvent,
  revToNumber,
} from "@/lib/liveBroadcast";

type Props = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Props) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

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

// PUT-only wrapper: undefined → "don't replace this side". Everything else
// flows through nullableStringArray so the trim + reject-empty rules (and their
// error messages) stay in lockstep with the POST path.
function validateOptionalIdArray(
  value: unknown,
  field: string
): { ok: true; value: string[] | undefined } | { ok: false; response: NextResponse } {
  if (value === undefined) return { ok: true, value: undefined };
  const result = nullableStringArray(value, field);
  if (!result.ok) return { ok: false, response: badRequest(result.message) };
  return { ok: true, value: result.value };
}

// The PUT / DELETE saves can bump the setlist revision, so they run as
// live writers: a save the database could not even start answers 503 +
// Retry-After (see `withAdminLiveWriterBusy`); every other outcome is
// unchanged.
export async function PUT(request: NextRequest, props: Props) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;
  return withAdminLiveWriterBusy(() => updateEvent(request, props));
}

export async function DELETE(_request: NextRequest, props: Props) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;
  return withAdminLiveWriterBusy(() => deleteEvent(props));
}

async function updateEvent(request: NextRequest, { params }: Props) {
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

  const opensAtCheck = validateEngagementOpensAt(body.engagementOpensAt, startTime);
  if (!opensAtCheck.ok) return opensAtCheck.response;
  const engagementOpensAt = opensAtCheck.value;
  // A payload without the key keeps the stored opens-at (see the
  // conditional write below) — but it may carry a moved startTime, so
  // re-check the stored value against it. Otherwise moving the show
  // earlier than an existing opens-at would persist a window that
  // never opens.
  if (!("engagementOpensAt" in body)) {
    const stored = await prisma.event.findUnique({
      where: { id: eventId },
      select: { engagementOpensAt: true },
    });
    const storedCheck = checkOpensAtBeforeStart(
      stored?.engagementOpensAt ?? null,
      startTime
    );
    if (!storedCheck.ok) return storedCheck.response;
  }

  const dateCheck = validateDateInput(body.date, "date", false);
  if (!dateCheck.ok) return dateCheck.response;
  const date = dateCheck.value;

  const seriesCheck = validateEventSeriesId(body.eventSeriesId);
  if (!seriesCheck.ok) return seriesCheck.response;
  const eventSeriesId = seriesCheck.value;

  const artistCheck = validateArtistId(body.artistId);
  if (!artistCheck.ok) return artistCheck.response;
  const artistId = artistCheck.value;

  const bdAlbumCheck = validateBdAlbumId(body.bdAlbumId);
  if (!bdAlbumCheck.ok) return bdAlbumCheck.response;
  const bdAlbumId = bdAlbumCheck.value;

  const organizerName = nullableString(body.organizerName, "organizerName");
  if (!organizerName.ok) return badRequest(organizerName.message);

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
    const { updated: event, rev } = await liveWriterTransaction("admin-event-update", async (tx) => {
      // n14: lock the event row and read the fields the live snapshot
      // carries BEFORE writing, so we can tell whether this edit
      // changes what `/api/setlist` serves. Most event edits (title,
      // venue, poster, performers) don't, and must not wake every live
      // viewer; a status / startTime / opens-at change does (it flips
      // the live page's mode and the wish/predict lock), so it bumps
      // the setlist revision and broadcasts inside this transaction.
      // A missing event falls through to the update below, which
      // throws P2025 as before.
      await lockEvent(tx, eventId);
      const before = await tx.event.findUnique({
        where: { id: eventId },
        select: { status: true, startTime: true, engagementOpensAt: true },
      });

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
          artistId,
          bdAlbumId,
          organizerName: organizerName.value,
          date,
          startTime,
          // Only touch the override when the payload carries the key, so
          // a caller that doesn't know about it can't wipe an operator's
          // opens-at. The admin form always sends it (null = clear).
          ...("engagementOpensAt" in body ? { engagementOpensAt } : {}),
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

      const liveFieldsChanged =
        before !== null &&
        (before.status !== updated.status ||
          before.startTime.getTime() !== updated.startTime.getTime() ||
          (before.engagementOpensAt?.getTime() ?? null) !==
            (updated.engagementOpensAt?.getTime() ?? null));
      const rev = liveFieldsChanged
        ? await bumpSetlistRevisionAndBroadcast(tx, eventId)
        : null;

      return { updated, rev };
    }, (r) => r.rev);

    // `revalidatePublicData` already expires every cached public read
    // (the event tag included, since every entry also carries the
    // public tag); the explicit event-tag expiry keeps this writer on
    // the same contract as the setlist writers in case the public
    // purge is ever narrowed.
    revalidatePublicData();
    revalidateEventData(eventId);
    return NextResponse.json({
      ...serializeBigInt(event),
      ...(rev !== null ? { rev: revToNumber(rev) } : {}),
    });
  } catch (err) {
    if (err instanceof StageIdentityNotFoundError) {
      return stageIdentityNotFoundResponse(err);
    }
    // P2003: an FK column (artistId, eventSeriesId, or stageIdentityId
    // on the replaced eventPerformer rows) points at a non-existent
    // row. Without this guard, an FK violation surfaces as a generic
    // 500 and the operator has no idea which field is stale. See
    // fkViolationResponse for the field-neutral 400 mapping.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2003"
    ) {
      return fkViolationResponse(err);
    }
    throw err;
  }
}

async function deleteEvent({ params }: Props) {
  const { id } = await params;
  const eventId = BigInt(id);
  // The live snapshot carries `isDeleted` (a deleted event resolves to
  // `status: null`), so a soft-delete is a snapshot change like any
  // other: bump + broadcast in the same transaction (n14).
  await liveWriterTransaction("admin-event-delete", async (tx) => {
    await lockEvent(tx, eventId);
    await tx.event.update({
      where: { id: eventId },
      data: { isDeleted: true, deletedAt: new Date() },
      select: { id: true },
    });
    return bumpSetlistRevisionAndBroadcast(tx, eventId);
  });
  revalidatePublicData();
  return NextResponse.json({ success: true });
}
