import { getTranslations } from "next-intl/server";
import { staticAlternates } from "@/lib/seo/entityUrl";
import type { Metadata } from "next";
import {
  getAlbums,
  groupAlbumsByYear,
  getAlbumArtistFilters,
} from "@/lib/albums";
import { countActiveBonuses } from "@/lib/albumBonusDisplay";
import { AlbumListRow } from "@/components/albums/AlbumListRow";
import { AlbumArtistFilter } from "@/components/albums/AlbumArtistFilter";
import { displayOriginalName } from "@/lib/display";
import styles from "@/components/albums/albumList.module.css";

/*
 * `/[locale]/albums` — top-level album discovery list, laid out from the
 * approved redesign packet 26-v1 (CSS in albumList.module.css).
 *
 * Albums grouped by release year (desc, undated last), one white panel
 * of full-width rows per year, single column at every width. A
 * top-level artist filter (`?artist=`) narrows the catalog to that
 * artist and its direct sub-units. No pagination, sorting or type
 * filter — the packet keeps the existing catalog behaviour.
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
  // `?artist=` filter variants consolidate onto the unfiltered list.
  return { title: t("title"), alternates: staticAlternates(locale, "/albums") };
}

export default async function AlbumsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ artist?: string | string[] }>;
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

  const albums = await getAlbums(
    locale,
    activeArtist ? BigInt(activeArtist) : undefined,
  );
  const groups = groupAlbumsByYear(albums);

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
          groups.map((group) => {
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
                    {t("yearAlbumCount", { count: group.albums.length })}
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
          })
        )}
      </div>
    </main>
  );
}
