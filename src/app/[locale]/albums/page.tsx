import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import {
  getAlbums,
  groupAlbumsByYear,
  getAlbumArtistFilters,
} from "@/lib/albums";
import { countActiveBonuses } from "@/lib/albumBonusDisplay";
import { AlbumCard } from "@/components/AlbumCard";
import { AlbumArtistFilter } from "@/components/albums/AlbumArtistFilter";
import { displayOriginalName } from "@/lib/display";
import { colors } from "@/styles/tokens";

/*
 * `/[locale]/albums` — top-level album discovery list (b10b; Sprint B2
 * QA pass tweaks).
 *
 * Albums grouped by release year (desc), rendered as single-column
 * `AlbumCard` list rows at every breakpoint (the QA pass dropped the
 * former desktop 4-col grid — desktop now matches mobile). A top-level
 * artist filter (`?artist=`) narrows the catalog.
 *
 * Frame mirrors src/app/[locale]/artists/page.tsx: `<main flex-1>`
 * carries the full-width page background, the inner `mx-auto` div holds
 * the reading-comfort column. `main` being the flex child (not the
 * mx-auto div) is what avoids the flex-column mx-auto width-shrink bug
 * (see the album-detail width-parity fix, PR #480).
 */

// Single-column rows read better in a narrower column — match the
// /artists list width (was 1100 for the now-removed 4-col grid).
const PAGE_MAX_WIDTH = 960;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Album" });
  return { title: t("title") };
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
    <main className="flex-1" style={{ background: colors.bgPage }}>
      <div
        className="mx-auto"
        style={{ maxWidth: PAGE_MAX_WIDTH, padding: "24px 0 48px" }}
      >
        <header style={{ padding: "0 16px 16px" }}>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: colors.textPrimary,
              margin: 0,
            }}
          >
            {t("title")}
          </h1>
        </header>

        <AlbumArtistFilter active={activeArtist} options={artistFilters} />

        {albums.length === 0 ? (
          <p
            style={{
              fontSize: 13,
              color: colors.textMuted,
              textAlign: "center",
              padding: "48px 16px",
            }}
          >
            {t("noAlbums")}
          </p>
        ) : (
          <div
            style={{
              padding: "0 16px",
              display: "flex",
              flexDirection: "column",
              gap: 24,
            }}
          >
            {groups.map((group) => (
              <section key={group.year ?? "undated"}>
                {/* Year header: label + divider rule + count chip. */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    marginBottom: 10,
                  }}
                >
                  <span
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      color: colors.textPrimary,
                    }}
                  >
                    {group.year ?? t("undatedYear")}
                  </span>
                  <div
                    style={{ flex: 1, height: 1, background: colors.border }}
                  />
                  <span style={{ fontSize: 11, color: colors.textMuted }}>
                    {t("yearAlbumCount", { count: group.albums.length })}
                  </span>
                </div>

                {/* One white rounded container per year with `divide-y`
                    separators between the rows — at every breakpoint (the
                    desktop grid was removed in the QA pass). The arbitrary
                    `divide-[#f1f5f9]` is the `colors.borderLight` hex (a
                    divide color can't be expressed inline). */}
                <div className="overflow-hidden rounded-2xl bg-white shadow-sm divide-y divide-[#f1f5f9]">
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
                      <AlbumCard
                        key={`${album.id}`}
                        variant="list"
                        album={album}
                        locale={locale}
                        artistName={artistName}
                        activeBonusCount={countActiveBonuses(album.listings)}
                      />
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
