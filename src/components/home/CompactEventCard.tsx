import Link from "next/link";
import { getTranslations } from "next-intl/server";
import EventStatusTicker from "@/components/EventStatusTicker";
import { TrackedAlbumLink } from "@/components/TrackedAlbumLink";
import { EventArt } from "@/components/shared/EventArt";
import { EventNameText } from "@/components/events/EventNameText";
import type { HomeCardView } from "@/lib/homeView";
import { eventDisplayPlain } from "@/lib/eventDisplay";
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
  bonus,
}: {
  view: HomeCardView;
  live?: boolean;
  bonus?: { href: string; albumId: string; albumSlug: string } | null;
}) {
  const t = await getTranslations("Home");
  const songs = view.songCount ?? 0;
  const songLine =
    songs > 0 ? t("setlistSongs", { count: songs }) : t("setlistWaiting");

  const eventLink = (
    <Link
      href={view.href}
      className={bonus ? styles.compactBody : `${styles.compact} ${live ? styles.live : ""}`}
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
          {view.dayLabel && <span className={styles.day}><EventNameText pair={view.dayLabel} /></span>}
        </div>
        <h3 className={styles.cardTitle}><EventNameText pair={view.title} /></h3>
        {(view.city || view.venue) && (
          <p className={styles.venue}>
            <HomePinIcon />
            <span className="[overflow-wrap:anywhere]">
              {view.city}{view.city && view.venue && " · "}
              {view.venue && <EventNameText pair={view.venue} />}
            </span>
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

  if (!bonus) return eventLink;
  return (
    <article className={`${styles.compact} ${styles.compactWithBonus}`}>
      {eventLink}
      <TrackedAlbumLink
        {...bonus}
        eventId={String(view.id)}
        surface="home_bd_purchase"
        prefetch={false}
        className={styles.bonusBadge}
        data-testid="home-bd-bonus"
        aria-label={t("bdBonusFor", {
          event: [eventDisplayPlain(view.title), eventDisplayPlain(view.dayLabel)].filter(Boolean).join(" · "),
        })}
      >
        <HomeGiftIcon />
        {t("bdBonus")}
      </TrackedAlbumLink>
    </article>
  );
}
