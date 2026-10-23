import { getTranslations } from "next-intl/server";
import { staticAlternates } from "@/lib/seo/entityUrl";
import type { Metadata } from "next";
import { redirect } from "@/i18n/navigation";
import {
  ALBUMS_PER_PAGE,
  getAlbumsPage,
  groupAlbumsByYear,
  getAlbumArtistFilters,
  parseAlbumPageParam,
  albumPageParamValue,
} from "@/lib/albums";
import { countActiveBonuses } from "@/lib/albumBonusDisplay";
import { AlbumListRow } from "@/components/albums/AlbumListRow";
import { AlbumArtistFilter } from "@/components/albums/AlbumArtistFilter";
import {
  AlbumPagination,
  ALBUM_RESULTS_ID,
} from "@/components/albums/AlbumPagination";
import { displayOriginalName } from "@/lib/display";
import styles from "@/components/albums/albumList.module.css";

/*
 * `/[locale]/albums` — top-level album discovery list, laid out from the
 * approved redesign packet 26-v1 (CSS in albumList.module.css).
 *
 * Albums grouped by release year (desc, undated last), one white panel
 * of full-width rows per year, single column at every width. A
 * top-level artist filter (`?artist=`) narrows the catalog to that
 * artist and its direct sub-units. No sorting or type filter — the
 * packet keeps the existing catalog behaviour.
 *
 * Pagination (consistency v3 §7.5): 20 albums per page, fetched with a
 * bounded query plus a count over the same filter (`getAlbumsPage`), so
 * the HTML carries one page, never the whole catalog. Year sections are
 * built from the current page only, and their count reads "N on this
 * page". URL rules, applied with a 307 redirect so the address bar
 * always shows the page actually rendered:
 *   - page 1 has no `?page=`; `?page=1`, malformed values (`abc`, `0`,
 *     `-2`, `1.5`), a repeated param and leading zeros redirect to the
 *     canonical spelling (malformed → page 1);
 *   - a page past the end redirects to the last page; with no results
 *     at all, to the bare list (the empty panel);
 *   - the `?artist=` filter is kept on every page link, and changing it
 *     (filter chips carry no `page`) starts again at page 1.
 * The redirect is temporary: the last page moves as the catalog grows.
 *
 * Body is a flex column: `<main>` takes the remaining height
 * (`flex-1`) and `.page` pins `width: 100%` next to its max-width so the
 * column tracks the viewport, not its content (PR #480). The page
 * background comes from the 06 shell's body colour.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Album" });
  // `?artist=` filter and `?page=` variants consolidate onto the
  // unfiltered first page, the same rule as the concert list's
  // `?filter=` / `?pastPage=`: list pages are navigation, and every album
  // they lead to has its own canonical URL in the sitemap.
  return { title: t("title"), alternates: staticAlternates(locale, "/albums") };
}

export default async function AlbumsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    artist?: string | string[];
    page?: string | string[];
  }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "Album" });

  const artistFilters = await getAlbumArtistFilters(locale);
  // Validate the `?artist=` param against the known filter set — an
  // unknown / hand-typed value falls back to "전체" (no filter) rather
  // than a guaranteed-empty list. Validated ids are our own numeric
  // strings, so BigInt() is safe.
  const rawArtist = Array.isArray(sp.artist) ? sp.artist[0] : sp.artist;
  const activeArtist =
    rawArtist && artistFilters.some((o) => o.id === rawArtist)
      ? rawArtist
      : null;

  const requestedPage = parseAlbumPageParam(sp.page);
  const { albums, total, totalPages } = await getAlbumsPage(
    locale,
    activeArtist ? BigInt(activeArtist) : undefined,
    requestedPage,
  );

  // Past the end → last page (bare list when there are no results).
  const page = Math.min(requestedPage, Math.max(totalPages, 1));
  const canonicalPage = albumPageParamValue(page);
  if (sp.page !== canonicalPage) {
    // `redirect` throws, so nothing below runs for a non-canonical URL.
    // The query is rebuilt from validated values only: an unknown
    // `?artist=` (already treated as "all") is dropped with it.
    const query: Record<string, string> = {};
    if (activeArtist) query.artist = activeArtist;
    if (canonicalPage) query.page = canonicalPage;
    redirect({ href: { pathname: "/albums", query }, locale });
  }

  const groups = groupAlbumsByYear(albums);
  const first = (page - 1) * ALBUMS_PER_PAGE + 1;

  return (
    <main className="flex-1">
      <div className={styles.page}>
        <header className={styles.heading}>
          <h1 className={styles.title}>{t("title")}</h1>
        </header>

        <AlbumArtistFilter active={activeArtist} options={artistFilters} />

        {albums.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyNote} aria-hidden="true">
              ♫
            </span>
            <p className={styles.emptyText}>{t("noAlbums")}</p>
          </div>
        ) : (
          <>
            {/* Results summary; the pager links land here
                (`#album-results`). tabIndex -1 makes it a focusable
                fragment target, so keyboard and screen-reader users
                continue from the summary of the new page. */}
            <p id={ALBUM_RESULTS_ID} tabIndex={-1} className={styles.summary}>
              {t("pagination.summary", {
                total,
                start: first,
                end: first + albums.length - 1,
                perPage: ALBUMS_PER_PAGE,
                page,
                totalPages,
              })}
            </p>
            {groups.map((group) => {
              const headingId = `album-year-${group.year ?? "undated"}`;
              return (
                <section
                  key={group.year ?? "undated"}
                  className={styles.yearGroup}
                  aria-labelledby={headingId}
                >
                  {/* Year + divider rule + count; the rule is the
                      heading's ::after, between the two. */}
                  <div className={styles.yearHeading}>
                    <h2 id={headingId} className={styles.yearTitle}>
                      {group.year ?? t("undatedYear")}
                    </h2>
                    <span className={styles.yearCount}>
                      {t("yearPageCount", { count: group.albums.length })}
                    </span>
                  </div>

                  <ul className={styles.rows}>
                    {group.albums.map((album) => {
                      const primaryArtist = album.artists[0]?.artist ?? null;
                      const artistName = primaryArtist
                        ? displayOriginalName(
                            primaryArtist,
                            primaryArtist.translations,
                            locale,
                          ).main
                        : undefined;
                      return (
                        <li key={`${album.id}`}>
                          <AlbumListRow
                            album={album}
                            locale={locale}
                            artistName={artistName}
                            activeBonusCount={countActiveBonuses(album.listings)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
            <AlbumPagination
              page={page}
              totalPages={totalPages}
              artist={activeArtist}
            />
          </>
        )}
      </div>
    </main>
  );
}
