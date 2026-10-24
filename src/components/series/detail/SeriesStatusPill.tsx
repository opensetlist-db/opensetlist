import type { ResolvedEventStatus } from "@/lib/eventStatus";
import styles from "./seriesDetail.module.css";

/*
 * Event status pill of the series page (32-v1 `.event-status`). Tones
 * are page-local in the CSS module (measured in the packet's
 * contrast.json); `ongoing` reads "LIVE" (`Event.live`) like the home
 * and concert-list pages.
 */
export function SeriesStatusPill({
  status,
  label,
}: {
  status: ResolvedEventStatus;
  label: string;
}) {
  return (
    <span className={styles.status} data-status={status}>
      {label}
    </span>
  );
}
