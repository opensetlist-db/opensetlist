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

// BigIntStringified-wrapped because every caller in the b03 chain
// (`AlbumBonusTab` → `ListingCard` / `EndedListingToggle`) receives
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

// Schema enum is 4-state (active / sold_out / unknown / ended) but
// the b03 UI surface is 2-state (Available vs Ended) per the
// simplification handoff. sold_out + unknown both collapse into the
// "available" badge — they read as still-buyable to the user, just
// without confirmation of current stock. ended is the only state
// that hides the listing behind the toggle.
export function mapStatusToUiKey(status: string): "active" | "ended" {
  return status === "ended" ? "ended" : "active";
}

// Identical predicate exposed as a named helper because every caller
// using mapStatusToUiKey just to branch on === "ended" reads less
// well than the directly-named guard. The two helpers are kept
// separate (rather than just exporting one) so a future read site
// that wants to render the badge text always goes through
// mapStatusToUiKey while a filter site that just needs the boolean
// stays terse.
export function isEndedListing(listing: { status: string }): boolean {
  return listing.status === "ended";
}

// Count of "active" bonuses across an album's store listings — the
// number rendered in the green 特典 N badge on AlbumCard and the
// "현재 특전" stat chip on AlbumInfoCard. A bonus counts as active
// when its listing is not `ended` (sold_out + unknown collapse into
// active per isEndedListing's 2-state mapping — they're still buyable,
// just unconfirmed). Extracted here, next to isEndedListing, so the
// Song page sidebar (songAlbums), the Album detail sidebar
// (AlbumInfoCard), and the b09 Artist/Series/Related album surfaces
// all read the same number — the "tab badge says 5, sidebar says 4"
// divergence earlier Album work hit came from this formula being
// copy-pasted into each call site.
//
// Structural input only: each listing needs a `status` string and a
// `bonuses` array whose length is the per-listing contribution. The
// elements themselves are never inspected, so `unknown[]` keeps the
// helper agnostic to whichever bonus include shape the caller fetched.
export function countActiveBonuses(
  listings: ReadonlyArray<{ status: string; bonuses: ReadonlyArray<unknown> }>,
): number {
  return listings
    .filter((l) => !isEndedListing(l))
    .reduce((sum, l) => sum + l.bonuses.length, 0);
}

// Canonical analytics store key from the free-text `originalStoreName`.
// The schema has no normalized store-key column (operator types
// "Amazon JP" / "amazon_jp" / "アマゾン" freely — see the
// AlbumStoreListing schema comment), so the b10c `store_click` event +
// the album page's `has_amazon_listing` flag need a stable key derived
// at read time. Regex set mirrors eventBdState's STORE_PRIORITY (first
// match wins); anything unmatched is `other` so the funnel never drops a
// click. Kept here next to resolveStoreName as the single store-identity
// resolver.
const STORE_KEY_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/amazon/i, "amazon_jp"],
  [/楽天|rakuten/i, "rakuten"],
  [/アニメイト|animate/i, "animate"],
  [/タワー|tower\s*record/i, "tower"],
  [/HMV/i, "hmv"],
  [/ヨドバシ|yodobashi/i, "yodobashi"],
  [/ソフマップ|sofmap/i, "sofmap"],
  [/ゲーマーズ|gamers/i, "gamers"],
];

export function resolveStoreKey(storeName: string | null | undefined): string {
  if (!storeName) return "other";
  for (const [pattern, key] of STORE_KEY_PATTERNS) {
    if (pattern.test(storeName)) return key;
  }
  return "other";
}
