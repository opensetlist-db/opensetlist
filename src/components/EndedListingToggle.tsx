import { getTranslations } from "next-intl/server";
import { colors, radius } from "@/styles/tokens";
import { ListingCard } from "@/components/ListingCard";
import type {
  EnrichedListing,
  EnrichedBonus,
} from "@/lib/albumBonusDisplay";

/*
 * Collapse wrapper around the ended AlbumStoreListing rows on b03's
 * bonus tab. Uses the native <details>/<summary> disclosure widget
 * so the open/close state survives client-side without a useState
 * hook + so the rendered HTML degrades gracefully even without JS.
 *
 * Summary label is ICU-pluralised via Album.bonus.showEnded —
 * "종료된 매장 보기 (N)" / "終了済みの店舗を見る (N)" /
 * "Show N ended stores".
 *
 * The inner cards reuse ListingCard with `muted` so they read as
 * archival rather than actionable. Empty list = render nothing
 * (the surrounding AlbumBonusTab is responsible for checking the
 * count before deciding to mount this).
 */

interface Props {
  listings: (EnrichedListing & { bonuses: EnrichedBonus[] })[];
  locale: string;
}

export async function EndedListingToggle({ listings, locale }: Props) {
  if (listings.length === 0) return null;
  const t = await getTranslations({ locale, namespace: "Album.bonus" });

  return (
    <details
      style={{
        marginTop: 16,
        background: colors.bgCard,
        borderRadius: radius.card,
        border: `1px solid ${colors.borderSubtle}`,
      }}
    >
      <summary
        style={{
          padding: "12px 16px",
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 700,
          color: colors.textSubtle,
          listStyle: "none",
          userSelect: "none",
        }}
      >
        {t("showEnded", { count: listings.length })}
      </summary>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: "0 12px 12px",
        }}
      >
        {listings.map((listing) => (
          <ListingCard
            key={listing.id}
            listing={listing}
            locale={locale}
            muted
          />
        ))}
      </div>
    </details>
  );
}
