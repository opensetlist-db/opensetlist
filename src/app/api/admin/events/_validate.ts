import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import {
  badRequest,
  nullableString as parseNullableString,
  originalLanguage as parseOriginalLanguage,
  requireString,
} from "@/lib/admin-input";

export function validatePerformerGuestIds(
  performerIds: string[] | undefined,
  guestIds: string[] | undefined
): NextResponse | null {
  if (performerIds && new Set(performerIds).size !== performerIds.length) {
    return NextResponse.json(
      { error: "performerIds contains duplicates" },
      { status: 400 }
    );
  }
  if (guestIds && new Set(guestIds).size !== guestIds.length) {
    return NextResponse.json(
      { error: "guestIds contains duplicates" },
      { status: 400 }
    );
  }
  if (performerIds && guestIds) {
    const guestSet = new Set(guestIds);
    const overlap = performerIds.filter((id) => guestSet.has(id));
    if (overlap.length > 0) {
      return NextResponse.json(
        {
          error: "stageIdentityId(s) cannot be both performer and guest",
          ids: overlap,
        },
        { status: 400 }
      );
    }
  }
  return null;
}

/**
 * Thrown from inside a transaction when one or more stageIdentity ids don't
 * resolve. Caught at the route boundary and converted to a 400 response.
 */
export class StageIdentityNotFoundError extends Error {
  readonly missingIds: string[];
  constructor(missingIds: string[]) {
    super(`Unknown stageIdentityId(s): ${missingIds.join(", ")}`);
    this.name = "StageIdentityNotFoundError";
    this.missingIds = missingIds;
  }
}

export async function ensureStageIdentitiesExist(
  tx: Prisma.TransactionClient,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return;
  const unique = Array.from(new Set(ids));
  const found = await tx.stageIdentity.findMany({
    where: { id: { in: unique } },
    select: { id: true },
  });
  const foundSet = new Set(found.map((r) => r.id));
  const missing = unique.filter((id) => !foundSet.has(id));
  if (missing.length > 0) {
    throw new StageIdentityNotFoundError(missing);
  }
}

export function stageIdentityNotFoundResponse(
  err: StageIdentityNotFoundError
): NextResponse {
  return NextResponse.json(
    { error: "Unknown stageIdentityId(s)", missingIds: err.missingIds },
    { status: 400 }
  );
}

/**
 * Convert a Prisma P2003 foreign-key violation into a readable 400.
 *
 * Both event routes accept several FK fields whose shape-validators
 * (`validateArtistId`, `validateEventSeriesId`, `ensureStageIdentitiesExist`)
 * don't probe row existence — a syntactically valid ID that points at a
 * non-existent or concurrently-deleted row reaches Prisma and trips
 * P2003. Without this helper the request surfaces as a generic 500.
 *
 * The message is intentionally field-neutral: P2003 can fire on
 * artistId, eventSeriesId, or stageIdentityId (the latter from
 * `eventPerformer.createMany` if a stage identity is deleted between
 * the pre-flight `ensureStageIdentitiesExist` check and the insert).
 * Naming a specific field in the human-readable string would
 * misdirect the operator on the wrong-FK case; the actual offending
 * column rides along in `field` from `err.meta.field_name`.
 *
 * The 400 is preferable to a 409: the operator submitted a malformed
 * input (a stale or made-up ID), not a state conflict between two
 * concurrent writes.
 */
export function fkViolationResponse(
  err: Prisma.PrismaClientKnownRequestError
): NextResponse {
  return NextResponse.json(
    {
      error: "유효하지 않은 참조 ID가 포함되어 있습니다. 입력값을 확인해 주세요.",
      field: err.meta?.field_name ?? null,
    },
    { status: 400 }
  );
}

/**
 * Parse an optional nullable BigInt FK body field. Strings must be
 * digits-only so `BigInt(...)` can't throw a SyntaxError (e.g. on
 * `"abc"` or `"1.5"`). Empty string / null / undefined all coerce to
 * null — the admin form submits `""` for "no selection."
 *
 * The numeric branch only accepts values inside `Number.isSafeInteger`
 * range. Anything past 2^53 - 1 has already lost precision by the time
 * it reaches JSON.parse on the request body — the bytes that arrived
 * over the wire can't be recovered. Rather than silently casting a
 * lossy value to a 64-bit BigInt (and pointing at a row the operator
 * never meant to touch), reject and force the caller to use the string
 * form. Strings carry full 64-bit precision through the JSON layer.
 *
 * Shared by validateEventSeriesId, validateArtistId, and any future
 * nullable-FK fields on Event so the accepted shapes + error wording
 * stay in lockstep across the POST and PUT routes.
 */
function validateNullableBigIntFk(
  value: unknown,
  field: string
):
  | { ok: true; value: bigint | null }
  | { ok: false; response: NextResponse } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return { ok: true, value: BigInt(value) };
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return { ok: true, value: BigInt(value) };
  }
  return {
    ok: false,
    response: NextResponse.json(
      // Admin-route convention: error bodies surfaced to the operator
      // are Korean. Colon-separator phrasing sidesteps the dynamic
      // field-name josa pitfall — `${field}` is an English token like
      // `artistId` or `eventSeriesId`, so a "는/은" suffix would read
      // awkwardly. The form's submit handler renders `body?.error`
      // verbatim in an `alert(...)`, so this string is what the
      // operator sees.
      {
        error: `${field}: 0 이상의 정수 또는 숫자 문자열이어야 합니다.`,
      },
      { status: 400 }
    ),
  };
}

export function validateEventSeriesId(value: unknown) {
  return validateNullableBigIntFk(value, "eventSeriesId");
}

export function validateArtistId(value: unknown) {
  return validateNullableBigIntFk(value, "artistId");
}

// `Event.bdAlbumId` — nullable FK to Album. Same shape contract as the
// other two FKs: empty / null / undefined coerce to null (the picker
// submits "" for "no selection"); strings must be digits-only.
// `fkViolationResponse` handles the P2003 case at the route boundary
// without naming the field, so a stale Album id (deleted between picker
// fetch and PUT) surfaces as a friendly 400, not a 500.
export function validateBdAlbumId(value: unknown) {
  return validateNullableBigIntFk(value, "bdAlbumId");
}

/**
 * Parse a required ISO date/datetime string into a Date, rejecting
 * anything `new Date(...)` would coerce to Invalid Date.
 */
export function validateDateInput(
  value: unknown,
  field: string,
  required: boolean
):
  | { ok: true; value: Date | null }
  | { ok: false; response: NextResponse } {
  if (value === undefined || value === null || value === "") {
    if (required) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: `${field} is required` },
          { status: 400 }
        ),
      };
    }
    return { ok: true, value: null };
  }
  if (typeof value !== "string" && !(value instanceof Date)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `${field} must be a date string or Date` },
        { status: 400 }
      ),
    };
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `${field} is not a valid date` },
        { status: 400 }
      ),
    };
  }
  return { ok: true, value: parsed };
}

export type EventTranslationInput = {
  locale: string;
  name: string;
  shortName: string | null;
  city: string | null;
  venue: string | null;
};

function nullableString(
  value: unknown
): { ok: true; value: string | null } | { ok: false } {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: null };
  }
  if (typeof value === "string") return { ok: true, value };
  return { ok: false };
}

export function validateEventTranslations(
  raw: unknown
):
  | { ok: true; value: EventTranslationInput[] }
  | { ok: false; response: NextResponse } {
  const reject = (msg: string) => ({
    ok: false as const,
    response: NextResponse.json({ error: msg }, { status: 400 }),
  });
  if (!Array.isArray(raw) || raw.length === 0) {
    return reject("translations must be a non-empty array");
  }
  const out: EventTranslationInput[] = [];
  const seenLocales = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object") {
      return reject(`translations[${i}] must be an object`);
    }
    const t = item as Record<string, unknown>;
    if (typeof t.locale !== "string" || t.locale.length === 0) {
      return reject(`translations[${i}].locale must be a non-empty string`);
    }
    if (seenLocales.has(t.locale)) {
      return reject(`translations contains duplicate locale "${t.locale}"`);
    }
    seenLocales.add(t.locale);
    if (typeof t.name !== "string" || t.name.length === 0) {
      return reject(`translations[${i}].name must be a non-empty string`);
    }
    const shortName = nullableString(t.shortName);
    if (!shortName.ok) return reject(`translations[${i}].shortName must be string or null`);
    const city = nullableString(t.city);
    if (!city.ok) return reject(`translations[${i}].city must be string or null`);
    const venue = nullableString(t.venue);
    if (!venue.ok) return reject(`translations[${i}].venue must be string or null`);
    out.push({
      locale: t.locale,
      name: t.name,
      shortName: shortName.value,
      city: city.value,
      venue: venue.value,
    });
  }
  return { ok: true, value: out };
}

export type EventOriginalFields = {
  originalName: string;
  originalShortName: string | null;
  originalCity: string | null;
  originalVenue: string | null;
  originalLanguage: string;
};

export function validateEventOriginals(
  body: Record<string, unknown>
):
  | { ok: true; value: EventOriginalFields }
  | { ok: false; response: NextResponse } {
  const name = requireString(body.originalName, "originalName");
  if (!name.ok) return { ok: false, response: badRequest(name.message) };

  const language = parseOriginalLanguage(body.originalLanguage);
  if (!language.ok) return { ok: false, response: badRequest(language.message) };

  const shortName = parseNullableString(body.originalShortName, "originalShortName");
  if (!shortName.ok) return { ok: false, response: badRequest(shortName.message) };

  const city = parseNullableString(body.originalCity, "originalCity");
  if (!city.ok) return { ok: false, response: badRequest(city.message) };

  const venue = parseNullableString(body.originalVenue, "originalVenue");
  if (!venue.ok) return { ok: false, response: badRequest(venue.message) };

  return {
    ok: true,
    value: {
      originalName: name.value,
      originalShortName: shortName.value,
      originalCity: city.value,
      originalVenue: venue.value,
      originalLanguage: language.value,
    },
  };
}
