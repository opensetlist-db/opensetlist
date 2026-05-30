import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt, parseReleaseYear } from "@/lib/utils";
import { displayNameWithFallback } from "@/lib/display";
import { FALLBACK_LOCALE } from "@/i18n/routing";

/*
 * Data layer for the `/[locale]/albums` list page (b10b).
 *
 * `getAlbums` is the list-page analog of `getTopLevelArtists` — a flat
 * catalog fetch, newest-release-first, no pagination (the Phase 1/2
 * catalog is small; pagination lands when it grows, same rule as the
 * artists list). `groupAlbumsByYear` is the pure presentation helper
 * the page uses to render the mockup's year sections.
 *
 * Include note: this mirrors `albumCardInclude` (src/lib/albumHighlights.ts,
 * b09) for `translations` + `listings.bonuses`, but additionally selects
 * the primary artist's name fields (`originalName` / `originalShortName`
 * / `originalLanguage`) so the page can resolve a displayable artist
 * label via `displayOriginalName` — the b09 highlight surfaces never
 * render the artist name, so the shared include doesn't carry it.
 */

const localeFilter = (locale: string) => ({
  locale: { in: [locale, FALLBACK_LOCALE] },
});

function albumsListInclude(locale: string) {
  const lf = localeFilter(locale);
  return {
    translations: { where: lf },
    artists: {
      // AlbumArtist has no role/display-order column (unlike SongArtist's
      // `role`), so order the junction by `artistId ASC` for a stable
      // "first artist" — the list page reads `artists[0]` for the card's
      // display name, and without an explicit orderBy Prisma's relation
      // order is undefined, which would let a multi-artist album's shown
      // name flip between requests. Same determinism tiebreak b08 uses
      // for `album.id`.
      orderBy: { artistId: "asc" },
      include: {
        artist: {
          select: {
            color: true,
            originalName: true,
            originalShortName: true,
            originalLanguage: true,
            translations: {
              where: lf,
              select: { locale: true, name: true, shortName: true },
            },
          },
        },
      },
    },
    listings: { include: { bonuses: true } },
  } satisfies Prisma.AlbumInclude;
}

export type AlbumsListItem = Awaited<ReturnType<typeof getAlbums>>[number];

export async function getAlbums(locale: string, artistId?: bigint) {
  const albums = await prisma.album.findMany({
    // Artist filter (the list page's `?artist=` chip). AlbumArtist is the
    // N:N junction, so match albums that credit the artist. Undefined =
    // no filter (the "전체" chip).
    where:
      artistId !== undefined
        ? { artists: { some: { artistId } } }
        : undefined,
    // Newest release first. NULL releaseDate sinks to the bottom —
    // Postgres' default is NULLS FIRST on DESC, which would float
    // un-dated scraping artifacts above the real catalog, so pin
    // `nulls: "last"` (same guard the BD picker + b09 sections use).
    // `id DESC` is the deterministic tiebreak when two albums share a
    // release date (anniversary BOX + single shipping the same day).
    orderBy: [
      { releaseDate: { sort: "desc", nulls: "last" } },
      { id: "desc" },
    ],
    include: albumsListInclude(locale),
  });
  // serializeBigInt narrows BigInt ids → Number (and Date → ISO string
  // via the JSON round-trip). The list page + AlbumCard read ids only
  // through template literals + React keys (coercion-tolerant), and the
  // year grouping reads releaseDate as a string — both fine post-serialize.
  return serializeBigInt(albums);
}

export type AlbumYearGroup = {
  // null = albums with no release date (rare; their own trailing bucket).
  year: number | null;
  albums: AlbumsListItem[];
};

/*
 * Bucket albums into release-year groups for the list page's year
 * sections. Pure + deterministic so it's unit-testable without a DB.
 *
 * - Year is taken in UTC (`getUTCFullYear`) per the CLAUDE.md date rule.
 *   `releaseDate` is a date-only column, so the year is TZ-stable, but
 *   reading it through a local-time getter would still be a latent bug
 *   if the column ever carried a time — use the UTC getter on principle.
 * - Groups are ordered year-desc; the null-release bucket always sorts
 *   last (it has no position on the timeline).
 * - Within each group, input order is preserved — `getAlbums` already
 *   sorted newest-first, so each year stays newest-first.
 */
export function groupAlbumsByYear(
  albums: ReadonlyArray<AlbumsListItem>,
): AlbumYearGroup[] {
  const byYear = new Map<number | null, AlbumsListItem[]>();
  for (const album of albums) {
    const year = parseReleaseYear(album.releaseDate);
    const bucket = byYear.get(year);
    if (bucket) {
      bucket.push(album);
    } else {
      byYear.set(year, [album]);
    }
  }
  return [...byYear.entries()]
    .map(([year, groupAlbums]) => ({ year, albums: groupAlbums }))
    .sort((a, b) => {
      // null bucket last; otherwise year descending.
      if (a.year === null) return 1;
      if (b.year === null) return -1;
      return b.year - a.year;
    });
}

export type AlbumArtistFilterOption = { id: string; name: string };

/*
 * Artists that have ≥1 album — the chip set for the `/albums` artist
 * filter (added in the Sprint B2 QA pass). Returns id (string, for the
 * `?artist=` param) + a short display name. Sub-units are included
 * (they have their own credited albums); ordered by id (≈ creation
 * order, so the parent group leads).
 */
export async function getAlbumArtistFilters(
  locale: string,
): Promise<AlbumArtistFilterOption[]> {
  const artists = await prisma.artist.findMany({
    where: { isDeleted: false, albums: { some: {} } },
    select: {
      id: true,
      originalName: true,
      originalShortName: true,
      originalLanguage: true,
      translations: {
        where: localeFilter(locale),
        select: { locale: true, name: true, shortName: true },
      },
    },
    orderBy: { id: "asc" },
  });
  return artists.map((a) => ({
    id: String(a.id),
    // `Artist.originalName` is non-nullable in the schema, so the chain
    // already yields a string — the trailing `|| ""` is belt-and-suspenders
    // to keep `name: string` airtight if the column ever goes nullable.
    name:
      displayNameWithFallback(a, a.translations, locale, "short") ||
      a.originalName ||
      "",
  }));
}
