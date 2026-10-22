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
 * Other query parameters survive a tab switch (the previous shared
 * TabBar did the same): only `tab` is replaced.
 */
export function SeriesTabs<K extends string>({
  tabs,
  active,
  basePath,
  searchParams,
  ariaLabel,
}: {
  tabs: ReadonlyArray<{ key: K; label: string }>;
  active: K;
  /** Locale-prefixed canonical series path (`entityPath`). */
  basePath: string;
  /** The request's query; repeated keys keep every value. */
  searchParams: Record<string, string | string[] | undefined>;
  ariaLabel: string;
}) {
  const hrefFor = (key: K) => {
    const q = new URLSearchParams();
    for (const [name, value] of Object.entries(searchParams)) {
      if (name === "tab" || value === undefined) continue;
      for (const v of Array.isArray(value) ? value : [value]) q.append(name, v);
    }
    q.set("tab", key);
    return `${basePath}?${q.toString()}`;
  };
  return (
    <nav className={styles.tabs} aria-label={ariaLabel}>
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={hrefFor(tab.key)}
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
