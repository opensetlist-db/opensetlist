import type { ContestReportType } from "@/generated/prisma/enums";

// ContestReport.payload is a Prisma `Json` column, which Prisma
// types as the opaque `JsonValue` on read/write. That's accurate for
// the wire format but useless at call sites — every consumer would
// have to cast manually and risk drift between the type stored, the
// type expected, and the type the route validates.
//
// This module owns the canonical per-type schema + a parse function
// that returns a discriminated union from the route's user input
// (or returns a validation error). Both the POST endpoint
// (server-side, anti-tamper) and the ContestReportSheet client use
// it so the contract is single-source.
//
// Per-type schemas (see prisma/schema.prisma model docstring for the
// shape rationale):
//   wrong_song        → { proposedSongId: number }
//   missing_performer → { stageIdentityIds: string[] }
//   wrong_variant     → { proposedSongId: number, proposedVariantId?: number }
//   other             → {}  (payload empty; the row's `comment` column carries the report)

export interface WrongSongPayload {
  proposedSongId: number;
}

export interface MissingPerformerPayload {
  stageIdentityIds: string[];
}

export interface WrongVariantPayload {
  proposedSongId: number;
  // Variants are separate Song rows linked via Song.baseVersionId,
  // so `proposedVariantId` is itself a Song.id. Optional: a report
  // can flag "this row should be a variant of this base song" even
  // when the user can't pinpoint the specific variant.
  proposedVariantId?: number;
}

export type OtherPayload = Record<string, never>;

export type ContestReportPayload =
  | { type: "wrong_song"; payload: WrongSongPayload }
  | { type: "missing_performer"; payload: MissingPerformerPayload }
  | { type: "wrong_variant"; payload: WrongVariantPayload }
  | { type: "other"; payload: OtherPayload };

// Result type for the parse function — either a valid typed payload
// or a 400-bound error message. Avoiding exceptions keeps the
// caller's branching shallow and matches the rest of the project's
// route-validation pattern (parseScope in /api/songs/search, etc.).
export type ParseResult =
  | { ok: true; value: ContestReportPayload }
  | { ok: false; error: string };

const VALID_TYPES: readonly ContestReportType[] = [
  "wrong_song",
  "missing_performer",
  "wrong_variant",
  "other",
];

function isPositiveInt(v: unknown): v is number {
  return (
    typeof v === "number" &&
    Number.isSafeInteger(v) &&
    v > 0
  );
}

/**
 * Parse + validate an untyped POST body into a typed
 * ContestReportPayload. `type` selects which payload schema applies;
 * `payload` is the raw incoming object.
 *
 * Validation rules per type (verified at the route + re-verified by
 * the typed cast here):
 *   - wrong_song / wrong_variant: `proposedSongId` is a positive
 *     safe-integer (matches Song.id BigInt with `serializeBigInt`
 *     number coercion). `wrong_variant` optionally accepts
 *     `proposedVariantId` (same constraints).
 *   - missing_performer: `stageIdentityIds` is a non-empty array
 *     of unique non-empty strings (stageIdentityId is UUID at
 *     schema level; the empty/dup check guards malformed input).
 *   - other: `payload` is an empty object (extra fields rejected).
 *
 * Returns `{ ok: false }` on any structural mismatch. The route's
 * handler still has to enforce DB-existence checks (Song exists,
 * stageIdentityIds are all in the event's performer roster) since
 * those need a DB round-trip.
 */
export function parseContestReportPayload(
  type: unknown,
  rawPayload: unknown,
): ParseResult {
  if (typeof type !== "string" || !VALID_TYPES.includes(type as ContestReportType)) {
    return {
      ok: false,
      error: "type must be one of: wrong_song, missing_performer, wrong_variant, other",
    };
  }
  if (rawPayload === null || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return { ok: false, error: "payload must be an object" };
  }
  const p = rawPayload as Record<string, unknown>;

  if (type === "wrong_song") {
    if (!isPositiveInt(p.proposedSongId)) {
      return { ok: false, error: "wrong_song requires positive integer proposedSongId" };
    }
    return {
      ok: true,
      value: { type, payload: { proposedSongId: p.proposedSongId } },
    };
  }

  if (type === "wrong_variant") {
    if (!isPositiveInt(p.proposedSongId)) {
      return {
        ok: false,
        error: "wrong_variant requires positive integer proposedSongId",
      };
    }
    let proposedVariantId: number | undefined;
    if (p.proposedVariantId !== undefined) {
      if (!isPositiveInt(p.proposedVariantId)) {
        return {
          ok: false,
          error: "wrong_variant.proposedVariantId must be a positive integer when present",
        };
      }
      proposedVariantId = p.proposedVariantId;
    }
    return {
      ok: true,
      value: {
        type,
        payload: {
          proposedSongId: p.proposedSongId,
          ...(proposedVariantId !== undefined ? { proposedVariantId } : {}),
        },
      },
    };
  }

  if (type === "missing_performer") {
    const ids = p.stageIdentityIds;
    if (!Array.isArray(ids) || ids.length === 0) {
      return {
        ok: false,
        error: "missing_performer requires non-empty stageIdentityIds array",
      };
    }
    if (!ids.every((id) => typeof id === "string" && id.length > 0)) {
      return {
        ok: false,
        error: "stageIdentityIds must be non-empty strings",
      };
    }
    if (new Set(ids).size !== ids.length) {
      return {
        ok: false,
        error: "stageIdentityIds must be unique",
      };
    }
    return {
      ok: true,
      value: { type, payload: { stageIdentityIds: ids as string[] } },
    };
  }

  // type === "other"
  if (Object.keys(p).length !== 0) {
    return {
      ok: false,
      error: "other type expects an empty payload (use `comment` for the report text)",
    };
  }
  return { ok: true, value: { type: "other", payload: {} } };
}
