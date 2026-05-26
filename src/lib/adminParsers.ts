// Shared input-validation helpers for admin API routes. Each route
// previously inlined verbatim copies; extracting them here keeps a
// single source of truth for the contracts.

import type { AlbumStoreListingStatus } from "@/generated/prisma/enums";

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
