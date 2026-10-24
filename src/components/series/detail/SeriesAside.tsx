import type { LangText } from "./SeriesIdentity";
import { SeriesStatusPill } from "./SeriesStatusPill";
import styles from "./seriesDetail.module.css";

/*
 * Tour progress + participating units (32-v1 aside). A 300px column
 * beside the schedule on desktop, 260px below 1100px, and moved ABOVE
 * the schedule below 768px (CSS `order: -1`) so a phone reader sees how
 * far the tour has gone before the city list.
 *
 * Progress keeps the existing meaning: completed / total, where
 * cancelled shows count in the total only. The bar is a native
 * `<progress>` (value/max), so the percentage is announced without a
 * separate message. Zero events omit the panel, as before. Both panels
 * are omitted when empty, so the aside can render nothing at all.
 */
export function SeriesAside({
  progress,
  units,
}: {
  progress: {
    title: string;
    value: string;
    completed: number;
    total: number;
    completedLabel: string;
    upcomingLabel: string;
    /** Present while an event of the series is LIVE. */
    ongoing: { pill: string; label: string } | null;
  } | null;
  units: { title: string; names: ReadonlyArray<LangText & { key: string }> } | null;
}) {
  if (!progress && !units) return null;
  return (
    <aside className={styles.aside}>
      {progress ? (
        <section
          className={`${styles.panel} ${styles.asidePanel}`}
          aria-labelledby="series-progress-title"
        >
          <h2 id="series-progress-title">
            {progress.title}
            <span className={styles.progressValue}>{progress.value}</span>
          </h2>
          <progress
            className={styles.progress}
            max={progress.total}
            value={progress.completed}
            aria-labelledby="series-progress-title"
          />
          <div className={styles.progressLabels}>
            <span>{progress.completedLabel}</span>
            <span>{progress.upcomingLabel}</span>
          </div>
          {progress.ongoing ? (
            <p className={styles.ongoingNote}>
              <SeriesStatusPill status="ongoing" label={progress.ongoing.pill} />
              {progress.ongoing.label}
            </p>
          ) : null}
        </section>
      ) : null}
      {units ? (
        <section
          className={`${styles.panel} ${styles.asidePanel}`}
          aria-labelledby="series-units-title"
        >
          <h2 id="series-units-title">{units.title}</h2>
          <ul className={styles.unitTags}>
            {units.names.map((u) => (
              <li key={u.key} lang={u.lang}>
                {u.text}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </aside>
  );
}
