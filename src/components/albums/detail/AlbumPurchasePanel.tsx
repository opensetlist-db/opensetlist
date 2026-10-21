import { getTranslations } from "next-intl/server";
import type { Prisma } from "@/generated/prisma/client";
import { TrackedStoreLink } from "@/components/TrackedStoreLink";
import {
  isEndedListing,
  mapStatusToUiKey,
  resolveBonusType,
  resolveEditionLabel,
  resolveStoreKey,
  resolveStoreName,
} from "@/lib/albumBonusDisplay";
import { isSafeExternalUrl, type BigIntStringified } from "@/lib/utils";
import styles from "./albumDetail.module.css";

// Wire shape after the page's `serializeBigIntAsString`.
export type AlbumForPurchase = BigIntStringified<
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

/*
 * Purchase tab of the Album detail page (22-v1): a store-bonus summary,
 * current listings as a two-column card grid (one column under 768px),
 * ended listings collapsed underneath.
 *
 * Data rules kept from the pre-redesign bonus tab:
 *   - "Current" = every listing whose status is not `ended` (sold_out and
 *     unknown included — `isEndedListing`). The page promises nothing
 *     about live retailer stock.
 *   - The buy link is the operator's productUrl verbatim, only when it is
 *     an http(s) URL (`isSafeExternalUrl` keeps `javascript:` out of the
 *     href), new tab with noopener/noreferrer, through TrackedStoreLink
 *     so `store_click` keeps firing with surface `album_page` and
 *     `isAffiliate: false`. Ended listings get no buy link.
 *   - Store / edition / bonus-type names follow the locale → original
 *     fallback in `albumBonusDisplay`. Bonus descriptions, images and
 *     lifecycle dates stay unrendered, as before.
 *
 * The summary box carries the counts the old sidebar chips showed
 * (total incl. ended / current / ended), so they stayed on the page when
 * the sidebar went away.
 */
export async function AlbumPurchasePanel({
  album,
  locale,
}: {
  album: AlbumForPurchase;
  locale: string;
}) {
  const t = await getTranslations({ locale, namespace: "Album" });

  if (album.listings.length === 0) {
    return (
      <>
        <h2 className={styles.purchaseHeading}>{t("tab.bonus")}</h2>
        <div className={`${styles.panel} ${styles.empty}`}>
          {t("bonus.empty")}
        </div>
      </>
    );
  }

  const current = album.listings.filter((l) => !isEndedListing(l));
  const ended = album.listings.filter(isEndedListing);
  const total = album.listings.reduce((s, l) => s + l.bonuses.length, 0);
  const endedBonuses = ended.reduce((s, l) => s + l.bonuses.length, 0);

  const card = (listing: AlbumForPurchase["listings"][number]) => {
    const isEnded = isEndedListing(listing);
    const edition = resolveEditionLabel(listing, locale);
    return (
      <article
        key={listing.id}
        className={`${styles.store} ${isEnded ? styles.storeEnded : ""}`}
      >
        <div className={styles.storeHeading}>
          <div>
            <h3>{resolveStoreName(listing, locale)}</h3>
            {edition ? <p className={styles.edition}>{edition}</p> : null}
          </div>
          <span className={styles.storeStatus}>
            {t(`bonus.status.${mapStatusToUiKey(listing.status)}`)}
          </span>
        </div>
        {listing.bonuses.length > 0 ? (
          <ul className={styles.bonusList}>
            {listing.bonuses.map((bonus) => (
              <li key={bonus.id}>{resolveBonusType(bonus, locale)}</li>
            ))}
          </ul>
        ) : null}
        {!isEnded && isSafeExternalUrl(listing.productUrl) ? (
          <TrackedStoreLink
            href={listing.productUrl}
            albumId={String(album.id)}
            storeKey={resolveStoreKey(listing.originalStoreName)}
            storeStatus={listing.status}
            surface="album_page"
            isAffiliate={false}
            className={styles.buy}
          >
            {t("bonus.buy")}
            <span aria-hidden="true">↗</span>
          </TrackedStoreLink>
        ) : null}
      </article>
    );
  };

  return (
    <>
      <h2 className={styles.purchaseHeading}>{t("tab.bonus")}</h2>
      {total > 0 ? (
        <div className={styles.bonusSummary}>
          <strong>{t("stats.bonusSectionLabel")}</strong>
          <span>{t("bonus.summary.total", { count: total })}</span>
          <span>{t("bonus.summary.current", { count: total - endedBonuses })}</span>
          <span>{t("bonus.summary.ended", { count: endedBonuses })}</span>
        </div>
      ) : null}
      {current.length > 0 ? (
        <div className={styles.storeGrid}>{current.map(card)}</div>
      ) : null}
      {ended.length > 0 ? (
        <details className={styles.endedList}>
          <summary>{t("bonus.showEnded", { count: ended.length })}</summary>
          <div className={styles.storeGrid}>{ended.map(card)}</div>
        </details>
      ) : null}
    </>
  );
}
