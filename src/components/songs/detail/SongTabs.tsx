import Link from "next/link";
import styles from "./songDetail.module.css";

/*
 * Underlined tab row for the Song detail page (28-v1): history, then
 * variations only when the song has more than one version.
 *
 * Plain links with `aria-current="page"` (same as the album page): the
 * tabs are server-routed views (`?tab=` re-renders the page), so a link
 * works without JS, opens in a new tab on middle-click, and back/forward
 * walk the tab history. `scroll={false}` keeps the reader's position.
 */

export type SongTabKey = "history" | "variations";

export function SongTabs({
  tabs,
  active,
  basePath,
  ariaLabel,
}: {
  tabs: ReadonlyArray<{ key: SongTabKey; label: string }>;
  active: SongTabKey;
  /** Canonical song path; each tab appends `?tab=<key>`. */
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
