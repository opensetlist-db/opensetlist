import Link from "next/link";
import styles from "./seriesDetail.module.css";

/*
 * Schedule / songs tab row (32-v1). Plain links with
 * `aria-current="page"`, the same choice as the album page (23): the
 * tabs are server-routed views (`?tab=` re-renders the page), so a link
 * works without JS, opens in a new tab on middle-click, and back /
 * forward walk the tab history. `scroll={false}` keeps the reader's
 * position; Next keeps focus on the clicked link because it re-renders
 * in place.
 *
 * The series page has no other query parameters, so each href is the
 * canonical path plus `?tab=`.
 */
export function SeriesTabs<K extends string>({
  tabs,
  active,
  basePath,
  ariaLabel,
}: {
  tabs: ReadonlyArray<{ key: K; label: string }>;
  active: K;
  /** Locale-prefixed canonical series path (`entityPath`). */
  basePath: string;
  ariaLabel: string;
}) {
  return (
    <nav className={styles.tabs} aria-label={ariaLabel}>
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={`${basePath}?tab=${tab.key}`}
          scroll={false}
          className={styles.tab}
          aria-current={tab.key === active ? "page" : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
