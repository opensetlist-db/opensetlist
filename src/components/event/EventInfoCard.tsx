"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { EventStartTime } from "@/components/EventStartTime";
import { formatVenueDate } from "@/lib/eventDateTime";
import { entityPath } from "@/lib/seo/entityUrl";
import styles from "./eventDetail.module.css";

/*
 * Sidebar "공연 정보" panel (18-v3 `.facts`). Successor of the old
 * sidebar header card: the title, status and artist line moved to the
 * page Hero (`<EventHero>`); the at-a-glance facts stay here as a
 * definition list.
 *
 * Client component because the live layout re-renders it: the song and
 * reaction counts tick with the realtime snapshot (`LiveEventLayout`),
 * exactly as they did on the old card. Rows with no value are dropped
 * entirely — a pre-show page with "0 songs · 0 reactions" rows was half
 * of Google's Soft 404 signal, so both counters only appear once there
 * is something to count.
 *
 * `formatVenueDate` reads only the UTC parts of the stored venue date,
 * so server and client print the same string without a mounted guard.
 * The viewer-local start time keeps `<EventStartTime>` (mounted-gated,
 * UTC on the server pass).
 */

interface Props {
  locale: string;
  date: Date | string | null;
  startTime: Date | string | null;
  venue: string | null;
  city: string | null;
  series: { id: string; slug: string; name: string } | null;
  /** Song-typed items with a song; the row hides at 0. */
  songsCount: number;
  /** Pre-formatted compact reaction total; null hides the row. */
  reactionsValue: string | null;
}

export function EventInfoCard({
  locale,
  date,
  startTime,
  venue,
  city,
  series,
  songsCount,
  reactionsValue,
}: Props) {
  const t = useTranslations("EventDetail");
  const et = useTranslations("Event");
  const ct = useTranslations("Common");

  const rows: Array<{ key: string; label: string; value: ReactNode }> = [
    { key: "date", label: t("factDate"), value: formatVenueDate(date, locale) || null },
    {
      key: "start",
      label: t("factStart"),
      value: startTime ? <EventStartTime date={date} startTime={startTime} /> : null,
    },
    { key: "venue", label: ct("venue"), value: venue },
    { key: "city", label: et("iconLabelCity"), value: city },
    {
      key: "series",
      label: ct("series"),
      value: series ? (
        <Link href={entityPath("series", locale, series.id, series.slug)}>
          {series.name}
        </Link>
      ) : null,
    },
    {
      key: "songs",
      label: et("iconLabelSongs"),
      value: songsCount > 0 ? et("songsValue", { count: songsCount }) : null,
    },
    { key: "reactions", label: et("iconLabelReactions"), value: reactionsValue },
  ];

  return (
    <section
      id="event-info"
      aria-labelledby="event-info-title"
      className={`${styles.panel} ${styles.infoPanel}`}
    >
      <div className={styles.panelHead}>
        <h2 id="event-info-title" className={styles.panelTitle}>
          {t("infoTitle")}
        </h2>
      </div>
      <dl className={styles.facts}>
        {rows
          .filter((row) => row.value != null && row.value !== "")
          .map((row) => (
            <div key={row.key}>
              <dt>{row.label}</dt>
              <dd data-testid={row.key === "start" ? "event-start-row" : undefined}>
                {row.value}
              </dd>
            </div>
          ))}
      </dl>
    </section>
  );
}
