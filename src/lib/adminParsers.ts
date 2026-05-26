// Shared input-validation helpers for admin API routes. Each route
// previously inlined verbatim copies; extracting them here keeps a
// single source of truth for the contracts (e.g. what "invalid date"
// means is now decided in one place, not four).

import type { AlbumStoreListingStatus } from "@/generated/prisma/enums";

/**
 * `null` when the input is genuinely absent (null / undefined / empty
 * string). `"invalid"` when the input is something that looks like a
 * value but doesn't parse. A `Date` instance otherwise.
 *
 * Callers should branch on `=== "invalid"` first and surface a 400
 * before treating `null` as "operator left this field blank".
 */
export function parseDate(value: unknown): Date | null | "invalid" {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return "invalid";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

/**
 * Accepts a JSON-shaped string or number and coerces to `bigint`.
 * Returns `null` when the input is the wrong shape or BigInt itself
 * refuses to parse (e.g. "abc"). Callers map `null` to a 400.
 */
export function parseBigInt(v: unknown): bigint | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  try {
    return BigInt(v as string | number);
  } catch {
    return null;
  }
}

/**
 * Strict positive integer parser used for disc/track numbers. Accepts
 * a JSON number that's an integer > 0, or a digit-only string that
 * coerces to one. Anything else returns `null`.
 */
export function parsePositiveInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) {
    const n = Number(v);
    return n > 0 ? n : null;
  }
  return null;
}

/**
 * Allowed runtime values of the `AlbumStoreListingStatus` Prisma
 * enum. Kept in sync by being typed against the generated enum type —
 * adding a new variant to schema.prisma surfaces a TS error here
 * until this Set is updated.
 */
export const VALID_LISTING_STATUSES: ReadonlySet<AlbumStoreListingStatus> =
  new Set<AlbumStoreListingStatus>(["active", "sold_out", "ended", "unknown"]);
