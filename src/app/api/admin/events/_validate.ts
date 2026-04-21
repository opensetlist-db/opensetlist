import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { resolveOriginalLanguage } from "@/lib/csv-parse";

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
 * Parse an optional `eventSeriesId` body field. Strings must be digits-only
 * so `BigInt(...)` can't throw a SyntaxError (e.g. on `"abc"` or `"1.5"`).
 */
export function validateEventSeriesId(
  value: unknown
):
  | { ok: true; value: bigint | null }
  | { ok: false; response: NextResponse } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return { ok: true, value: BigInt(value) };
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return { ok: true, value: BigInt(value) };
  }
  return {
    ok: false,
    response: NextResponse.json(
      { error: "eventSeriesId must be a non-negative integer or digit string" },
      { status: 400 }
    ),
  };
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
  const reject = (msg: string) => ({
    ok: false as const,
    response: NextResponse.json({ error: msg }, { status: 400 }),
  });

  const trimmedName =
    typeof body.originalName === "string" ? body.originalName.trim() : "";
  if (!trimmedName) {
    return reject("originalName is required");
  }

  let resolvedLanguage: string;
  try {
    resolvedLanguage = resolveOriginalLanguage(
      body.originalLanguage as string | undefined | null
    );
  } catch (err) {
    return reject(err instanceof Error ? err.message : String(err));
  }

  const trimmedNullable = (key: string): string | null => {
    const v = body[key];
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t.length > 0 ? t : null;
  };

  return {
    ok: true,
    value: {
      originalName: trimmedName,
      originalShortName: trimmedNullable("originalShortName"),
      originalCity: trimmedNullable("originalCity"),
      originalVenue: trimmedNullable("originalVenue"),
      originalLanguage: resolvedLanguage,
    },
  };
}
