import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ResolvedEventStatus } from "@/lib/eventStatus";
import type { SongHistoryGroup } from "./songHistory";
import styles from "./songDetail.module.css";

/*
 * Performance-history tab of the Song detail page (28-v1).
 *
 * Desktop rows are a status / date / event / encore+position grid with a
 * visual column strip; below 700px each row stacks status + date, the
 * full title, then encore/position. Titles are never clamped.
 *
 * Native <details open> instead of the shared client PerformanceGroup:
 * the 28-v1 row and group header differ from that component, and a
 * disclosure element collapses without JS and announces its expanded
 * state for free. The LIVE pill sits in the summary, so a collapsed
 * group with an ongoing event still shows it.
 */
export async function SongHistoryPanel({
  groups,
  locale,
}: {
  groups: SongHistoryGroup[];
  locale: string;
}) {
  const t = await getTranslations({ locale, namespace: "Song" });
  const et = await getTranslations({ locale, namespace: "Event" });

  if (groups.length === 0) {
    return (
      <section
        className={`${styles.panel} ${styles.empty}`}
        aria-labelledby="song-history-heading"
      >
        <h2 id="song-history-heading">{t("performanceHistory")}</h2>
        <p>{t("noPerformances")}</p>
      </section>
    );
  }

  // Row-shaped surfaces read "LIVE" for an ongoing event (events list,
  // home hero) rather than the locale "진행중" / "開催中".
  const statusLabels: Record<ResolvedEventStatus, string> = {
    ongoing: et("live"),
    upcoming: et("status.upcoming"),
    completed: et("status.completed"),
    cancelled: et("status.cancelled"),
  };

  return (
    <section aria-labelledby="song-history-heading">
      <h2 id="song-history-heading" className="sr-only">
        {t("performanceHistory")}
      </h2>
      {/* Visual column labels only; each row's cells already read in
          this order, so the strip is hidden from assistive tech rather
          than faking table semantics. */}
      <div className={styles.historyColumns} aria-hidden="true">
        <span>{t("tableHeader.status")}</span>
        <span>{t("tableHeader.date")}</span>
        <span>{t("tableHeader.event")}</span>
        <span>{t("tableHeader.position")}</span>
      </div>
      {groups.map((group) => (
        <details key={group.key} className={styles.eventGroup} open>
          <summary>
            {group.key === "other"
              ? et("ungrouped")
              : (group.label ?? et("unknownEvent"))}{" "}
            <span className={styles.count}>
              <span aria-hidden="true">{group.rows.length}</span>
              <span className="sr-only">
                {t("performanceCount", { count: group.rows.length })}
              </span>
            </span>
            {group.hasOngoing ? (
              <>
                {" "}
                <span className={styles.status} data-status="ongoing">
                  {statusLabels.ongoing}
                </span>
              </>
            ) : null}
          </summary>
          {group.rows.map((row) => (
            <Link key={row.id} href={row.href} className={styles.performance}>
              <span className={styles.status} data-status={row.status}>
                {statusLabels[row.status]}
              </span>
              <time dateTime={row.dateTime ?? undefined}>{row.formattedDate}</time>
              <strong>{row.name}</strong>
              <span className={styles.trailing}>
                {row.isEncore ? (
                  <span className={styles.encore}>{t("encoreBadge")}</span>
                ) : null}
                <span className={styles.position}>
                  <span className="sr-only">{t("tableHeader.position")} </span>
                  #{row.position}
                </span>
                <span aria-hidden="true">›</span>
              </span>
            </Link>
          ))}
        </details>
      ))}
    </section>
  );
}
