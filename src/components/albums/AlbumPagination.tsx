import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { albumListQuery, albumPageItems } from "@/lib/albums";
import styles from "./albumList.module.css";

/*
 * Pager of the `/[locale]/albums` list (consistency v3 §7.5, packet
 * `.c03-pagination`). Deliberately not the concert list's shared
 * `Pagination`: the approved album pager keeps Previous/Next in place as
 * disabled items on the first/last page and shows a ±1 window, where the
 * concert list omits them and shows ±2 — another list's behaviour does
 * not override the album approval.
 *
 * Every link is a locale-aware `<Link>` to the canonical URL of its page
 * (page 1 has no `?page=`), carries the active `?artist=` filter, and
 * ends in `#album-results` so a page change scrolls back to the results
 * summary instead of leaving the reader at the old page's bottom.
 * Navigation is plain server navigation: back/forward and reload replay
 * the URL, and with it the same filter and page.
 */

export const ALBUM_RESULTS_ID = "album-results";

interface Props {
  page: number;
  totalPages: number;
  /** Validated `?artist=` id, or null for the unfiltered list. */
  artist: string | null;
}

function albumListHref(artist: string | null, page: number) {
  return {
    pathname: "/albums" as const,
    query: albumListQuery(artist, page),
    hash: ALBUM_RESULTS_ID,
  };
}

export async function AlbumPagination({ page, totalPages, artist }: Props) {
  if (totalPages <= 1) return null;
  const t = await getTranslations("Album.pagination");

  const step = (target: number, label: string, enabled: boolean) =>
    enabled ? (
      <Link href={albumListHref(artist, target)} className={styles.pageItem}>
        {label}
      </Link>
    ) : (
      <span className={styles.pageItem} aria-disabled="true">
        {label}
      </span>
    );

  return (
    <nav aria-label={t("aria")} className={styles.pager}>
      {step(page - 1, t("prev"), page > 1)}
      {albumPageItems(page, totalPages).map((item, i) =>
        item === "ellipsis" ? (
          <span
            key={`ellipsis-${i}`}
            className={styles.pageEllipsis}
            aria-hidden="true"
          >
            …
          </span>
        ) : item === page ? (
          <span
            key={item}
            className={styles.pageItem}
            aria-current="page"
            aria-label={t("pageLabel", { page: item })}
          >
            {item}
          </span>
        ) : (
          <Link
            key={item}
            href={albumListHref(artist, item)}
            className={styles.pageItem}
            aria-label={t("pageLabel", { page: item })}
          >
            {item}
          </Link>
        ),
      )}
      {step(page + 1, t("next"), page < totalPages)}
    </nav>
  );
}
