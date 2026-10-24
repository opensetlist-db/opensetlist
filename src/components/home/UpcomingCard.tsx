"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import EventStatusTicker from "@/components/EventStatusTicker";
import { EventArt } from "@/components/shared/EventArt";
import { trackEvent } from "@/lib/analytics";
import type { UpcomingCardView } from "@/lib/homeView";
import { HomeChevronIcon, HomePinIcon } from "./HomeIcons";
import styles from "./home.module.css";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const TICK_MS = 30 * 1000;

/*
 * Upcoming concert card (approved 14-v1.3: art slot on top, then
 * date + day label, full title, place, and the status badges).
 *
 * Behaviour carried over unchanged from the pre-redesign card:
 *   - the "D-N" status turns into an hours/minutes countdown inside the
 *     last 24h, ticking every 30s on the client (the server label is
 *     bucket-cached, so it can be up to one bucket stale);
 *   - `EventStatusTicker` refreshes the route at startTime so the card
 *     moves to the ongoing section;
 *   - the GA4 `home_upcoming_click` event with the event id and whether
 *     the prediction badge was visible.
 */
export function UpcomingCard({ view }: { view: UpcomingCardView }) {
  const t = useTranslations("Home");
  const [countdown, setCountdown] = useState<string | null>(null);

  useEffect(() => {
    const startMs = new Date(view.startTimeIso).getTime();
    if (Number.isNaN(startMs)) return;

    const compute = () => {
      const diffMs = startMs - Date.now();
      if (diffMs <= 0 || diffMs >= DAY_MS) {
        setCountdown(null);
      } else if (diffMs >= HOUR_MS) {
        setCountdown(t("hoursLeft", { hours: Math.floor(diffMs / HOUR_MS) }));
      } else {
        setCountdown(
          t("minutesLeft", {
            minutes: Math.max(1, Math.floor(diffMs / MINUTE_MS)),
          }),
        );
      }
    };

    compute();
    const interval = setInterval(compute, TICK_MS);
    return () => clearInterval(interval);
  }, [view.startTimeIso, t]);

  const statusLabel = countdown ?? t("dDay", { days: view.daysLeft });

  return (
    <Link
      href={view.href}
      className={styles.card}
      onClick={() => {
        trackEvent("home_upcoming_click", {
          event_id: view.id,
          badge_visible: view.showWishBadge,
        });
      }}
    >
      <EventArt logoUrl={view.logoUrl} title={view.artTitle} tint={view.tint} />
      <div className={styles.cardBody}>
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
        <div className={styles.cardBottom}>
          <div className={styles.badges}>
            <span className={styles.badge}>
              {t("scheduled", { label: statusLabel })}
            </span>
            {view.showWishBadge && (
              <span className={`${styles.badge} ${styles.badgeWish}`}>
                {t("wishOpen")}
              </span>
            )}
          </div>
          <HomeChevronIcon />
        </div>
      </div>
      <EventStatusTicker startTime={view.startTimeIso} />
    </Link>
  );
}
