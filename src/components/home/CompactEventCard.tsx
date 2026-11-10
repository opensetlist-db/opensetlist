import Link from "next/link";
import { getTranslations } from "next-intl/server";
import EventStatusTicker from "@/components/EventStatusTicker";
import { EventArt } from "@/components/shared/EventArt";
import type { HomeCardView } from "@/lib/homeView";
import { motion } from "@/styles/tokens";
import { HomeChevronIcon, HomeGiftIcon, HomePinIcon } from "./HomeIcons";
import styles from "./home.module.css";

/*
 * Row-shaped card shared by the ongoing and past sections (approved
 * 14-v1.3): compact art slot, date + day label, full title, place, and
 * the setlist line.
 *
 * `live` switches to the ongoing treatment — warm white card, coral
 * LIVE capsule whose small dot pulses (reduced motion: solid), and a
 * "view setlist" button instead of the inline link. An ongoing show
 * with no songs yet says it is waiting for updates rather than "0
 * songs". Ongoing cards also mount `EventStatusTicker`, so the page
 * refreshes when the 12h ongoing window closes and the card moves on.
 */
export async function CompactEventCard({
  view,
  live = false,
  bonusHref,
}: {
  view: HomeCardView;
  live?: boolean;
  bonusHref?: string | null;
}) {
  const t = await getTranslations("Home");
  const songs = view.songCount ?? 0;
  const songLine =
    songs > 0 ? t("setlistSongs", { count: songs }) : t("setlistWaiting");

  const eventLink = (
    <Link
      href={view.href}
      className={bonusHref ? styles.compactBody : `${styles.compact} ${live ? styles.live : ""}`}
    >
      <EventArt
        logoUrl={view.logoUrl}
        title={view.artTitle}
        tint={view.tint}
        variant="compact"
      />
      <div>
        {live && (
          <span className={styles.liveBadge}>
            <span
              aria-hidden="true"
              className={styles.liveDot}
              style={{ animation: motion.livePulse }}
            />
            {t("liveBadge")}
          </span>
        )}
        <div className={styles.dateLine}>
          <time dateTime={view.startTimeIso}>{view.dateLabel}</time>
          {view.dayLabel && <span className={styles.day}>{view.dayLabel}</span>}
        </div>
        <h3 className={styles.cardTitle}>{view.title}</h3>
        {view.place && (
          <p className={styles.venue}>
            <HomePinIcon />
            <span>{view.place}</span>
          </p>
        )}
        {live ? (
          <p className={styles.meta}>
            <span>{songLine}</span>
            <span className={styles.liveCta}>{t("viewSetlist")} →</span>
          </p>
        ) : (
          <p className={styles.meta}>
            {songLine} ·{" "}
            <span className={styles.metaLink}>{t("viewSetlist")} →</span>
          </p>
        )}
      </div>
      <HomeChevronIcon />
      {live && <EventStatusTicker startTime={view.startTimeIso} />}
    </Link>
  );

  if (!bonusHref) return eventLink;
  return (
    <article className={`${styles.compact} ${styles.compactWithBonus}`}>
      {eventLink}
      <Link
        href={bonusHref}
        prefetch={false}
        className={styles.bonusBadge}
        data-testid="home-bd-bonus"
        aria-label={t("bdBonusFor", { event: view.dayLabel ? `${view.title} · ${view.dayLabel}` : view.title })}
      >
        <HomeGiftIcon />
        {t("bdBonus")}
      </Link>
    </article>
  );
}
