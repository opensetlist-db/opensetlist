import { TrackedAlbumLink } from "@/components/TrackedAlbumLink";
import { getTranslations } from "next-intl/server";
import { CoverImage } from "@/components/shared/CoverImage";
import { FireBdSectionView } from "@/components/FireBdSectionView";
import { displayOriginalTitle } from "@/lib/display";
import { BD_STATE_GA_VALUE, resolveEventBdState } from "@/lib/eventBdState";
import { performanceOfficialUrl, projectPurchaseOptions, type PurchaseListing } from "@/lib/purchaseAvailability";
import { entityPath } from "@/lib/seo/entityUrl";
import { formatDate } from "@/lib/utils";
import styles from "@/components/event/eventDetail.module.css";

type Props = {
  eventId: string;
  startTime: string | Date | null;
  album: {
    id: bigint | number | string;
    slug: string;
    originalTitle: string;
    originalLanguage: string;
    imageUrl: string | null;
    releaseDate: string | Date | null;
    translations: readonly { locale: string; title: string }[];
    listings: readonly (PurchaseListing & { sourceUrl: string | null })[];
  };
  locale: string;
  referenceNow: Date;
};

export async function EventBdSection({ eventId, startTime, album, locale, referenceNow }: Props) {
  const state = resolveEventBdState(
    { startTime: startTime ?? "", status: "completed", bdAlbumId: album.id },
    album,
    referenceNow,
  );
  if (state === "pre" || state === "immediate_post" || state === "long_mid") return null;

  const [t, albumT] = await Promise.all([
    getTranslations({ locale, namespace: "Event.bd" }),
    getTranslations({ locale, namespace: "Album" }),
  ]);
  const title = displayOriginalTitle(album, album.translations, locale);
  const albumHref = entityPath("albums", locale, album.id, album.slug);
  const { bonusStores, basicOptions, bonusCount } = projectPurchaseOptions(
    album.listings, referenceNow, { performanceOnly: true },
  );
  const hasBonus = bonusStores.length > 0;
  const hasOptions = hasBonus || basicOptions.length > 0;
  const officialUrl = !hasOptions && performanceOfficialUrl(album.listings);
  const badge = state === "bd_released" ? "releasedBadge"
    : state === "bd_preorder" ? "preorderBadge" : "announcedBadge";

  return (
    <section
      className={`${styles.panel} ${styles.bdSummary}`}
      aria-labelledby="event-bd-title"
      data-testid="event-bd-summary"
      data-bonus-store-count={bonusStores.length}
    >
      <div className={styles.panelHead}>
        <h2 id="event-bd-title" className={styles.panelTitle}>{t("sectionTitle")}</h2>
        <span className={styles.bdStatus}>{t(badge)}</span>
      </div>
      <div className={styles.bdBody}>
        <CoverImage src={album.imageUrl} size={88} />
        <div className={styles.bdProduct}>
          <h3>
            <TrackedAlbumLink
              href={albumHref}
              albumId={String(album.id)}
              albumSlug={album.slug}
              surface="event_bd_title"
              eventId={eventId}
            >
              {title.main}
            </TrackedAlbumLink>
          </h3>
          {title.sub && <p>{title.sub}</p>}
          {album.releaseDate && (
            <p>{t("releaseDateLabel")} · {formatDate(album.releaseDate, locale)}</p>
          )}
        </div>
        {(hasOptions || officialUrl) && (
          <div className={styles.bdActions}>
            {hasOptions && (
              <p>{hasBonus
                ? t("bonusStoreCount", { count: bonusStores.length })
                : albumT("bonus.basicOptions")}</p>
            )}
            {hasOptions ? (
              <TrackedAlbumLink
                href={`${albumHref}?tab=bonus`}
                albumId={String(album.id)}
                albumSlug={album.slug}
                surface="event_bd_purchase"
                eventId={eventId}
                prefetch={false}
                className={styles.bdPurchase}
                data-testid="event-bd-purchase"
              >
                {t(hasBonus ? "compareCta" : "purchaseCta")}
              </TrackedAlbumLink>
            ) : officialUrl && (
              <a
                href={officialUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.bdOfficial}
                data-testid="event-bd-official"
              >
                {albumT("bonus.officialInfo")} <span aria-hidden="true">↗</span>
              </a>
            )}
          </div>
        )}
      </div>
      <FireBdSectionView
        eventId={eventId}
        albumId={String(album.id)}
        bdState={BD_STATE_GA_VALUE[state]}
        // Keep the existing capped availability metric for the BD funnel.
        topBonusCount={Math.min(3, bonusCount)}
      />
    </section>
  );
}
