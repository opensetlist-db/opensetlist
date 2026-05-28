// Shared input-validation helpers for admin API routes. Each route
// previously inlined verbatim copies; extracting them here keeps a
// single source of truth for the contracts.

import type { AlbumStoreListingStatus } from "@/generated/prisma/enums";

/**
 * Accepts a JSON-shaped string or number and coerces to `bigint`.
 * Returns `null` when the input is the wrong shape or BigInt itself
 * refuses to parse (e.g. "abc"). Callers map `null` to a 400.
 *
 * Number inputs MUST be safe integers — JSON numbers above
 * `Number.MAX_SAFE_INTEGER` (2^53 − 1) are already rounded by the
 * time they reach this function, so feeding them straight into
 * `BigInt(v)` would lock in the rounded value and silently anchor a
 * lookup or write onto the wrong row. The safe-integer guard rejects
 * such inputs with `null` so the caller surfaces a 400 instead of
 * shipping rounded IDs into Prisma. Operator clients that genuinely
 * need >2^53 ids should send them as JSON strings — those bypass
 * the lossy number representation entirely.
 */
export function parseBigInt(v: unknown): bigint | null {
  if (typeof v === "number") {
    return Number.isSafeInteger(v) ? BigInt(v) : null;
  }
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) {
    try {
      return BigInt(v.trim());
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Strict positive integer parser used for disc/track numbers. Accepts
 * a JSON number that's an integer > 0, or a digit-only string that
 * coerces to one. Anything else returns `null`.
 *
 * `Number.isSafeInteger` rejects values outside the (2^53 − 1) safe
 * range; without it, a 17-digit operator typo could pass `Number(v)
 * > 0` while silently rounding to a neighboring integer. Disc/track
 * numbers are always small (<1000), but the guard matters at the
 * type boundary because BigInt IDs share this parser shape.
 */
export function parsePositiveInt(v: unknown): number | null {
  if (
    typeof v === "number" &&
    Number.isInteger(v) &&
    Number.isSafeInteger(v) &&
    v > 0
  ) {
    return v;
  }
  if (typeof v === "string" && /^\d+$/.test(v)) {
    const n = Number(v);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  return null;
}

/**
 * Admin-writable subset of `AlbumStoreListingStatus`. The schema enum
 * has four values (active/sold_out/ended/unknown) but the admin form
 * is a 2-state toggle per
 * `b03-b05-album-bonus-simplification-handoff.md` — read paths still
 * accept the full set, but no admin write should produce sold_out or
 * unknown. If Phase 2 follow-up adds a 매진 toggle, this Set widens
 * and the matching select option appears in the modal.
 */
export const ADMIN_WRITABLE_LISTING_STATUSES: ReadonlySet<AlbumStoreListingStatus> =
  new Set<AlbumStoreListingStatus>(["active", "ended"]);

/**
 * Parses the `translations` array in AlbumStoreBonus create / update
 * bodies down to the schema-side shape. The admin form per the
 * simplification handoff only writes `bonusType`; the schema's
 * `bonusDescription` column stays nullable but never receives a write
 * from this surface.
 */
export function parseBonusTranslations(
  input: unknown,
): { locale: string; bonusType: string | null }[] {
  return Array.isArray(input)
    ? (input as Array<{ locale: unknown; bonusType?: unknown }>)
        .filter((t) => typeof t.locale === "string")
        .map((t) => ({
          locale: t.locale as string,
          bonusType:
            typeof t.bonusType === "string" && t.bonusType.trim()
              ? t.bonusType.trim()
              : null,
        }))
    : [];
}

/**
 * Parses the `translations` array in AlbumStoreListing create / update
 * bodies. Both override columns (storeName, editionLabel) are
 * nullable — the operator fills only what they need to localize, the
 * rest fall through to the listing's original* fields at render time.
 */
export function parseListingTranslations(
  input: unknown,
): {
  locale: string;
  storeName: string | null;
  editionLabel: string | null;
}[] {
  return Array.isArray(input)
    ? (
        input as Array<{
          locale: unknown;
          storeName?: unknown;
          editionLabel?: unknown;
        }>
      )
        .filter((t) => typeof t.locale === "string")
        .map((t) => ({
          locale: t.locale as string,
          storeName:
            typeof t.storeName === "string" && t.storeName.trim()
              ? t.storeName.trim()
              : null,
          editionLabel:
            typeof t.editionLabel === "string" && t.editionLabel.trim()
              ? t.editionLabel.trim()
              : null,
        }))
    : [];
}

/**
 * Parses the `translations` array on Pattern-3 AlbumTrack create /
 * update bodies (drama/bgm titles with no Song parent). Rows with an
 * empty title are dropped so a "delete this locale" UI gesture
 * round-trips correctly through the delete-then-create rebuild on
 * PATCH.
 */
export function parsePattern3TrackTranslations(
  input: unknown,
): { locale: string; title: string }[] {
  return Array.isArray(input)
    ? (input as Array<{ locale: unknown; title: unknown }>)
        .filter(
          (t) =>
            typeof t.locale === "string" &&
            typeof t.title === "string" &&
            (t.title as string).trim(),
        )
        .map((t) => ({
          locale: t.locale as string,
          title: (t.title as string).trim(),
        }))
    : [];
}
