// Display-layer helpers for AlbumStoreListing + AlbumStoreBonus rows.
// Mirrors the helper-per-field shape src/lib/albumTrackTitle.ts uses
// for AlbumTrack display.
//
// b03 surfaces five fields off this pair of tables:
//   - storeName        (listing-level, free-text + Translation)
//   - editionLabel     (listing-level, free-text + Translation, nullable)
//   - status badge     (listing-level, schema 4-state → UI 2-state)
//   - productUrl       (listing-level, rendered verbatim as anchor href)
//   - bonusType        (bonus-level, free-text + Translation)
//
// `originalBonusDescription`, `bonusImageUrl`, `sourceUrl`, the
// lifecycle date columns (`startsAt` / `endsAt` / `lastVerifiedAt`)
// and the stale-warning UI from the original b03 spec are deliberately
// out of scope — see wiki/output/b03-b05-album-bonus-simplification-
// handoff.md for the simplification trade-offs the operator approved
// on 2026-05-26. The columns stay nullable on the schema so future
// surfaces can re-expose them without a destructive migration.
import type {
  AlbumStoreListingModel,
  AlbumStoreListingTranslationModel,
  AlbumStoreBonusModel,
  AlbumStoreBonusTranslationModel,
} from "@/generated/prisma/models";
import type { BigIntStringified } from "@/lib/utils";
import { projectPurchaseOptions, type PurchaseListing } from "@/lib/purchaseAvailability";

// BigIntStringified-wrapped because every caller in the b03 chain
// (`AlbumPurchasePanel` on the album page) receives
// listings via page.tsx's `serializeBigIntAsString(album)` JSON
// boundary — `id` / `albumId` arrive as `string`, lifecycle date
// columns arrive as ISO strings. The Prisma-generated `Model` types
// still declare `bigint` / `Date`; wrapping with `BigIntStringified`
// keeps the helper signatures honest about what survives the wire.
export type EnrichedListing = BigIntStringified<
  AlbumStoreListingModel & {
    translations?: AlbumStoreListingTranslationModel[];
  }
>;

export type EnrichedBonus = BigIntStringified<
  AlbumStoreBonusModel & {
    translations?: AlbumStoreBonusTranslationModel[];
  }
>;

// originalStoreName is NOT NULL on the schema, so resolution is
// "translation row → original" with no synthetic floor — the column
// is guaranteed to carry the operator's raw input.
export function resolveStoreName(
  listing: EnrichedListing,
  locale: string,
): string {
  const trans = listing.translations?.find((t) => t.locale === locale);
  return trans?.storeName ?? listing.originalStoreName;
}

// originalEditionLabel IS nullable (a single-edition album has no
// label to set), so this helper can legitimately return null and
// callers render the listing without an edition row when that happens.
export function resolveEditionLabel(
  listing: EnrichedListing,
  locale: string,
): string | null {
  const trans = listing.translations?.find((t) => t.locale === locale);
  return trans?.editionLabel ?? listing.originalEditionLabel;
}

// originalBonusType is NOT NULL. The Translation row's bonusType
// column IS nullable (translators override only the columns they
// localize — the bonus-description column lives next to it and either
// override can land in isolation), so we still `??` through the
// fallback chain.
export function resolveBonusType(
  bonus: EnrichedBonus,
  locale: string,
): string {
  const trans = bonus.translations?.find((t) => t.locale === locale);
  return trans?.bonusType ?? bonus.originalBonusType;
}

export function countActiveBonuses(listings: readonly PurchaseListing[], performanceOnly = false): number {
  return projectPurchaseOptions(listings, new Date(), { performanceOnly }).bonusCount;
}

export { resolveStoreKey } from "@/lib/storeKeys";
