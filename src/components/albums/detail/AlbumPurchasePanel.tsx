import { getTranslations } from "next-intl/server";
import type { Prisma } from "@/generated/prisma/client";
import { TrackedStoreLink } from "@/components/TrackedStoreLink";
import {
  resolveBonusType,
  resolveStoreKey,
  resolveStoreName,
} from "@/lib/albumBonusDisplay";
import { projectPurchaseOptions } from "@/lib/purchaseAvailability";
import { resolvePurchaseLink } from "@/lib/purchaseLink";
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
  const hasOptions = bonusStores.length > 0 || basicOptions.length > 0;

  const tag = process.env.AMAZON_JP_ASSOCIATE_TAG;

  type Listing = AlbumForPurchase["listings"][number];
  const option = (listing: Listing & { productUrl: string }, bonuses: Listing["bonuses"] = []) => {
    const link = resolvePurchaseLink(listing.productUrl, tag);
    if (!link) return null;
    const store = resolveStoreName(listing, locale);
    // Report catalog seller keys, with the legacy buckets as a fallback for missing or malformed keys.
    const storeKey = listing.storeKey && /^[\p{L}\p{N}][\p{L}\p{N} _!&.-]{0,99}$/u.test(listing.storeKey)
      ? listing.storeKey
      : resolveStoreKey(listing.originalStoreName);
    return (
      <div key={listing.id} className={styles.purchaseOption} data-testid="purchase-option">
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
                    <p className={styles.deadline}>
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
        <TrackedStoreLink
          {...link}
          albumId={String(album.id)}
          albumSlug={album.slug}
          purchaseOption={bonuses.length > 0 ? "with_bonus" : "without_bonus"}
          storeKey={storeKey}
          storeStatus={listing.status}
          surface="album_page"
          className={styles.buy}
        >
          {t("bonus.buyAt", { store })}
          <span aria-hidden="true">↗</span>
        </TrackedStoreLink>
        {link.isAffiliate && (
          <p className={styles.affiliateDisclosure}>{t("bonus.affiliateDisclosure")}</p>
        )}
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
    </>
  );
}
