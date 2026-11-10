import { getTranslations } from "next-intl/server";
import type { Prisma } from "@/generated/prisma/client";
import { PurchaseStoreLink } from "@/components/PurchaseStoreLink";
import {
  resolveBonusType,
  resolveEditionLabel,
  resolveStoreKey,
  resolveStoreName,
} from "@/lib/albumBonusDisplay";
import { performanceOfficialUrl, projectPurchaseOptions } from "@/lib/purchaseAvailability";
import { formatDate, formatTime, isSafeExternalUrl, type BigIntStringified } from "@/lib/utils";
import styles from "./albumDetail.module.css";

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

export async function AlbumPurchasePanel({
  album,
  locale,
  now = new Date(),
  performanceOnly = false,
}: {
  album: AlbumForPurchase;
  locale: string;
  now?: Date;
  performanceOnly?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "Album" });
  const { bonusStores, basicOptions } = projectPurchaseOptions(album.listings, now, { performanceOnly });
  const officialUrl = performanceOnly
    ? performanceOfficialUrl(album.listings)
    : album.listings.map((listing) => listing.sourceUrl).find(isSafeExternalUrl);
  const hasOptions = bonusStores.length > 0 || basicOptions.length > 0;

  type Listing = AlbumForPurchase["listings"][number];
  const option = (listing: Listing & { productUrl: string }, bonuses: Listing["bonuses"] = []) => {
    const edition = resolveEditionLabel(listing, locale);
    const store = resolveStoreName(listing, locale);
    return (
      <div key={listing.id} className={styles.purchaseOption} data-testid="purchase-option">
        {edition && <p className={styles.edition}>{edition}</p>}
        {listing.selectionGuide && <p>{listing.selectionGuide}</p>}
        {bonuses.length > 0 && (
          <ul className={styles.bonusList}>
            {bonuses.map((bonus) => {
              const label = resolveBonusType(bonus, locale);
              const description = bonus.translations?.find((entry) => entry.locale === locale)?.bonusDescription
                ?? bonus.originalBonusDescription;
              const deadline = [listing.endsAt, bonus.endsAt].filter((date) => date !== null).sort()[0];
              return (
                <li key={bonus.id}>
                  {isSafeExternalUrl(bonus.bonusImageUrl) && (
                    // eslint-disable-next-line @next/next/no-img-element -- bonus images use the approved storage URL directly.
                    <img src={bonus.bonusImageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className={styles.bonusImage} />
                  )}
                  <strong>{label}</strong>
                  {description && <p>{description}</p>}
                  {deadline && (
                    <p className={styles.edition}>
                      {t("bonus.deadline", {
                        time: formatDate(deadline, locale, { dateStyle: "medium", timeZone: "UTC" })
                          + " " + formatTime(deadline, locale, { timeStyle: "short", timeZone: "UTC" }) + " UTC",
                      })}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <PurchaseStoreLink
          href={listing.productUrl}
          albumId={String(album.id)}
          storeKey={resolveStoreKey(listing.originalStoreName)}
          storeStatus={listing.status}
          surface="album_page"
          disclosure={t("bonus.affiliateDisclosure")}
          className={styles.buy}
        >
          {t("bonus.buyAt", { store })}
          <span aria-hidden="true">↗</span>
        </PurchaseStoreLink>
      </div>
    );
  };

  return (
    <>
      <h2 className={styles.purchaseHeading}>{t("tab.bonus")}</h2>
      {bonusStores.length > 0 && (
        <section className={styles.purchaseSection} aria-label={t("bonus.options")}>
          <div className={styles.bonusSummary}>
            <strong>{t("bonus.options")}</strong>
            <span>{t("bonus.storeCount", { count: bonusStores.length })}</span>
          </div>
          <div className={styles.storeGrid}>
            {bonusStores.map(({ key, options }) => (
              <article key={key} className={styles.store}>
                <h3>{resolveStoreName(options[0].listing, locale)}</h3>
                {options.map(({ listing, bonuses }) => option(listing, bonuses))}
              </article>
            ))}
          </div>
        </section>
      )}
      {basicOptions.length > 0 && (
        <section className={styles.purchaseSection}>
          <h3>{t("bonus.basicOptions")}</h3>
          <div className={styles.storeGrid}>
            {basicOptions.map((listing) => (
              <article key={listing.id} className={styles.store}>
                <h4>{resolveStoreName(listing, locale)}</h4>
                {option(listing)}
              </article>
            ))}
          </div>
        </section>
      )}
      {!hasOptions && <p className={`${styles.panel} ${styles.empty}`}>{t("bonus.empty")}</p>}
      {officialUrl && (
        <a className={styles.buy} href={officialUrl} target="_blank" rel="noopener noreferrer">
          {t("bonus.officialInfo")} <span aria-hidden="true">↗</span>
        </a>
      )}
    </>
  );
}
