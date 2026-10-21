import Link from "next/link";
import styles from "./albumDetail.module.css";

/*
 * Underlined tab row for the Album detail page (22-v1).
 *
 * Plain links with `aria-current="page"`, not the shared button TabBar:
 * the tabs are server-routed views (`?tab=` re-renders the page), so a
 * link is the honest element — it works without JS, opens in a new tab
 * on middle-click, and back/forward walk the tab history. Same reason
 * the shared TabBar avoids `role="tab"`.
 *
 * `scroll={false}` keeps the reader's position when switching tabs, and
 * Next keeps focus on the clicked link because it re-renders in place.
 */

export interface AlbumTab<K extends string = string> {
  key: K;
  label: string;
  count: number;
  /** Active (non-ended) store bonuses exist — draws the accent dot. */
  indicator?: boolean;
}

export function AlbumTabs<K extends string>({
  tabs,
  active,
  basePath,
  ariaLabel,
  indicatorLabel,
}: {
  tabs: ReadonlyArray<AlbumTab<K>>;
  active: K;
  /** Canonical album path; each tab appends `?tab=<key>`. */
  basePath: string;
  ariaLabel: string;
  /** Accessible name of the bonus dot (e.g. "매장특전"). */
  indicatorLabel: string;
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
          <span className={styles.count}>{tab.count}</span>
          {tab.indicator ? (
            <span
              className={styles.bonusDot}
              role="img"
              aria-label={indicatorLabel}
            />
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
