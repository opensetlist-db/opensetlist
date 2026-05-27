import { getTranslations } from "next-intl/server";
import type { Prisma } from "@/generated/prisma/client";
import { ListingCard } from "@/components/ListingCard";
import { EndedListingToggle } from "@/components/EndedListingToggle";
import { isEndedListing } from "@/lib/albumBonusDisplay";
import { colors, radius } from "@/styles/tokens";
import type { BigIntStringified } from "@/lib/utils";

/*
 * Top-level surface for b03 — fills the Album page's "매장特典" tab
 * (one of the three TabBar slots b02 wired up).
 *
 * Composition:
 *   - Album with zero listings: i18n-keyed empty placeholder
 *     (Album.bonus.empty).
 *   - Otherwise: active listings (status ≠ "ended") render in a
 *     vertical stack of ListingCards, then ended listings live
 *     inside the EndedListingToggle disclosure underneath. Default
 *     ordering inside each bucket is the AlbumStoreListing fetch
 *     order from getAlbum (originalStoreName asc — set in page.tsx's
 *     include).
 *
 * Type alias is the narrow Prisma payload this component actually
 * reads — keeping it local rather than importing the page's
 * AlbumForInfoCard equivalent because the bonus tab needs the nested
 * listings + bonuses + translations tree while the sidebar only
 * needs counts. Both shapes are a subset of the page's getAlbum
 * include, so the same cached fetch serves all three b02/b03/b04
 * consumers without a type-side coupling between them.
 */

// BigIntStringified-wrapped — page.tsx's getAlbum runs
// serializeBigIntAsString so every `bigint` id and every `Date`
// column arrives as a string. isEndedListing + ListingCard +
// EndedListingToggle consume the listing rows; their types share
// this same wrapper so the chain stays type-honest end-to-end.
export type AlbumForBonusTab = BigIntStringified<
  Prisma.AlbumGetPayload<{
    include: {
      listings: {
        include: {
          bonuses: { include: { translations: true } };
          translations: true;
        };
      };
    };
  }>
>;

interface Props {
  album: AlbumForBonusTab;
  locale: string;
}

export async function AlbumBonusTab({ album, locale }: Props) {
  const t = await getTranslations({ locale, namespace: "Album.bonus" });

  if (album.listings.length === 0) {
    return (
      <div
        style={{
          background: colors.bgCard,
          borderRadius: radius.card,
          padding: "32px 20px",
          textAlign: "center",
          color: colors.textMuted,
          fontSize: 14,
        }}
      >
        {t("empty")}
      </div>
    );
  }

  const activeListings = album.listings.filter((l) => !isEndedListing(l));
  const endedListings = album.listings.filter((l) => isEndedListing(l));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {activeListings.map((listing) => (
        <ListingCard key={listing.id} listing={listing} locale={locale} />
      ))}
      <EndedListingToggle listings={endedListings} locale={locale} />
    </div>
  );
}
