import Link from "next/link";
import { useTranslations } from "next-intl";
import { entityPath } from "@/lib/seo/entityUrl";
import styles from "./eventDetail.module.css";

/*
 * Sidebar "같은 시리즈" panel (18-v3): the series' full name and a
 * button to the series page, where the other days and legs are listed.
 * Renders nothing for an event without a series.
 */

interface Props {
  locale: string;
  series: { id: string; slug: string; name: string } | null;
}

export function EventSeriesCard({ locale, series }: Props) {
  const t = useTranslations("EventDetail");
  if (!series) return null;
  return (
    <section
      aria-labelledby="event-series-title"
      className={`${styles.panel} ${styles.infoPanel}`}
    >
      <div className={styles.panelHead}>
        <h2 id="event-series-title" className={styles.panelTitle}>
          {t("sameSeriesTitle")}
        </h2>
      </div>
      <p className={styles.seriesName}>{series.name}</p>
      <Link
        href={entityPath("series", locale, series.id, series.slug)}
        className={styles.blockButton}
      >
        {t("viewSeries")}
      </Link>
    </section>
  );
}
