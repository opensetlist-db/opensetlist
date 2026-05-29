import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { getAlbums, groupAlbumsByYear } from "@/lib/albums";
import { countActiveBonuses } from "@/lib/albumBonusDisplay";
import { AlbumCard } from "@/components/AlbumCard";
import { displayOriginalName } from "@/lib/display";
import { colors } from "@/styles/tokens";

/*
 * `/[locale]/albums` — top-level album discovery list (b10b).
 *
 * Closes the Album discovery loop: b02 shipped the detail page and
 * b08/b09 added inbound cross-links, but there was no entry point to
 * browse the catalog. This page + the 4th header nav item (`albums`)
 * provide it.
 *
 * Layout follows raw/mockups/albums-list-mockup.jsx: albums grouped by
 * release year (desc), rendered via the AlbumCard `list` variant which
 * is itself responsive (mobile row / desktop grid card). The year-
 * section wrapper below is white-rounded-container-with-dividers on
 * mobile and a transparent grid on desktop — the two halves the `list`
 * variant's mobile-row and desktop-card blocks slot into. No type/
 * artist filter (Phase 3) and no pagination (small catalog; same rule
 * as /artists).
 *
 * Frame mirrors src/app/[locale]/artists/page.tsx: `<main flex-1>`
 * carries the full-width page background, the inner `mx-auto` div holds
 * the reading-comfort column. `main` being the flex child (not the
 * mx-auto div) is what avoids the flex-column mx-auto width-shrink bug
 * (see the album-detail width-parity fix, PR #480).
 */

// Wider than /artists' 960 — the desktop year grid wants up to 4
// columns of album cards, which reads cramped under ~1000px.
const PAGE_MAX_WIDTH = 1100;

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
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Album" });

  const albums = await getAlbums(locale);
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

                {/* Responsive wrapper — mobile: one white rounded card
                    with `divide-y` separators between rows; desktop:
                    transparent grid (2→4 cols). The arbitrary
                    `divide-[#f1f5f9]` is the `colors.borderLight` hex; a
                    breakpoint-conditional divide color can't be inlined,
                    so it lives in className. */}
                <div className="overflow-hidden rounded-2xl bg-white shadow-sm divide-y divide-[#f1f5f9] lg:grid lg:grid-cols-2 xl:grid-cols-4 lg:gap-3 lg:divide-y-0 lg:rounded-none lg:bg-transparent lg:shadow-none lg:overflow-visible">
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
