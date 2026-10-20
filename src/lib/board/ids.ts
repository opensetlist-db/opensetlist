/**
 * Decimal-string ids of the fan board (n15) — one definition shared by
 * the starter-pick JSON, the pick routes and the client's local copy.
 *
 * Why strings: `Song.id` / `Artist.id` / `Event.id` are BigInt, JSON has
 * no BigInt, and a JS number silently rounds past 2^53. A positive
 * decimal of at most 19 digits that fits int64 round-trips exactly;
 * consumers convert with `BigInt()`.
 *
 * Pure (no Prisma / Next imports): safe from client code.
 */

const DECIMAL_ID = /^[1-9][0-9]{0,18}$/;
const INT64_MAX = BigInt("9223372036854775807");

/** A positive decimal-string id within int64. Numbers are rejected on
 *  purpose so a client can't drift back to the lossy shape unnoticed. */
export function isDecimalId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    DECIMAL_ID.test(value) &&
    BigInt(value) <= INT64_MAX
  );
}

/** `isDecimalId` → BigInt, else null. */
export function parseDecimalId(value: unknown): bigint | null {
  return isDecimalId(value) ? BigInt(value) : null;
}
