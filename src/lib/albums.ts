import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt, parseReleaseYear } from "@/lib/utils";
import { displayNameWithFallback } from "@/lib/display";
import { FALLBACK_LOCALE } from "@/i18n/routing";

/*
 * Data layer for the `/[locale]/albums` list page (b10b).
 *
 * `getAlbumsPage` is the list-page analog of `getTopLevelArtists` — a
 * catalog fetch, newest-release-first, bounded to one page of
 * `ALBUMS_PER_PAGE` rows plus a count over the same filter (consistency
 * v3 §7.5: the catalog reached ~470 albums, and the page used to ship
 * every row in one HTML document). `groupAlbumsByYear` is the pure
 * presentation helper the page uses to render the year sections of the
 * current page; `parseAlbumPageParam` / `albumPageItems` are the pure
 * URL and pager helpers.
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

/** Rows per list page (consistency v3 §7.5). */
export const ALBUMS_PER_PAGE = 20;

/*
 * Highest page fetched optimistically, in parallel with the count (see
 * getAlbumsPage). A hand-typed `?page=99999999999` is out of range for
 * any real catalog, and fetching it would hand Postgres a 13-digit
 * OFFSET for rows that are discarded anyway; above this bound the rows
 * wait for the count and are fetched only when the page exists.
 */
const MAX_OPTIMISTIC_PAGE = 100_000;

/*
 * The one filter both the page query and the count use, so the total,
 * the page count and the rows can never disagree.
 *
 * Artist filter (the list page's `?artist=` chip). The chips are
 * top-level (representative) artists only — matching /artists — so a
 * pick must include albums credited to that artist OR to any of its
 * direct sub-units (Cerise Bouquet / DOLLCHESTRA / … have no chip of
 * their own; without this their albums would be unreachable except via
 * "전체"). One level of nesting is the Phase-1/2 data shape.
 * Undefined = no filter (the "전체" chip). `Album` itself has no soft
 * delete; the deleted-exclusion is on the credited artist.
 */
function albumsListWhere(artistId?: bigint): Prisma.AlbumWhereInput | undefined {
  if (artistId === undefined) return undefined;
  return {
    artists: {
      some: {
        artist: {
          // Exclude soft-deleted sub-units (the top-level chip query
          // already filters isDeleted; keep both consistent so a deleted
          // sub-unit's albums can't leak in).
          isDeleted: false,
          OR: [{ id: artistId }, { parentArtistId: artistId }],
        },
      },
    },
  };
}

/*
 * Newest release first. NULL releaseDate sinks to the bottom — Postgres'
 * default is NULLS FIRST on DESC, which would float un-dated scraping
 * artifacts above the real catalog, so pin `nulls: "last"` (same guard
 * the BD picker + b09 sections use). `id DESC` is the deterministic
 * tiebreak when two albums share a release date (anniversary BOX +
 * single shipping the same day) — with OFFSET paging it is also what
 * keeps a tied pair from appearing on both sides of a page boundary.
 */
const ALBUMS_LIST_ORDER = [
  { releaseDate: { sort: "desc", nulls: "last" } },
  { id: "desc" },
] satisfies Prisma.AlbumOrderByWithRelationInput[];

async function findAlbumsListRows(
  locale: string,
  where: Prisma.AlbumWhereInput | undefined,
  page: number,
) {
  const albums = await prisma.album.findMany({
    where,
    orderBy: ALBUMS_LIST_ORDER,
    skip: (page - 1) * ALBUMS_PER_PAGE,
    take: ALBUMS_PER_PAGE,
    include: albumsListInclude(locale),
  });
  // serializeBigInt narrows BigInt ids → Number (and Date → ISO string
  // via the JSON round-trip). The list page + AlbumCard read ids only
  // through template literals + React keys (coercion-tolerant), and the
  // year grouping reads releaseDate as a string — both fine post-serialize.
  return serializeBigInt(albums);
}

export type AlbumsListItem = Awaited<
  ReturnType<typeof findAlbumsListRows>
>[number];

export type AlbumsPage = {
  /** At most ALBUMS_PER_PAGE rows of the requested page. */
  albums: AlbumsListItem[];
  /** Albums matching the filter, across all pages. */
  total: number;
  /** ceil(total / ALBUMS_PER_PAGE); 0 for an empty result. */
  totalPages: number;
};

/*
 * One page of the album list plus the filter's total.
 *
 * The count and the page query run in parallel: the page has to know
 * the total anyway (summary line + pager), and running the row query
 * optimistically for the requested page saves a sequential round trip
 * in the normal case. When the requested page turns out to be past the
 * end, its (empty) rows are discarded — the caller redirects to the last
 * page, which then renders with its own bounded query.
 *
 * The pool is two connections (src/lib/prisma.ts), so the two queries
 * really do overlap; the artist-chip query runs before this because the
 * filter has to be validated against it. Pages above
 * MAX_OPTIMISTIC_PAGE count first and fetch only an existing page.
 */
export async function getAlbumsPage(
  locale: string,
  artistId: bigint | undefined,
  page: number,
): Promise<AlbumsPage> {
  const where = albumsListWhere(artistId);
  let total: number;
  let albums: AlbumsListItem[];
  if (page <= MAX_OPTIMISTIC_PAGE) {
    [total, albums] = await Promise.all([
      prisma.album.count({ where }),
      findAlbumsListRows(locale, where, page),
    ]);
  } else {
    total = await prisma.album.count({ where });
    albums =
      page <= Math.ceil(total / ALBUMS_PER_PAGE)
        ? await findAlbumsListRows(locale, where, page)
        : [];
  }
  return {
    albums,
    total,
    totalPages: Math.ceil(total / ALBUMS_PER_PAGE),
  };
}

/*
 * `?page=` → requested page number. Absent, non-numeric, zero, negative
 * or fractional values all map to page 1 — a malformed link lands on the
 * start of the list rather than on an error. A repeated param reads its
 * first value (as `?artist=` does), leading zeros normalise ("02" → 2),
 * and a number too large to represent is still a number: it clamps to
 * MAX_SAFE_INTEGER, so the caller treats it as past the end (last page)
 * rather than as malformed. Whether the URL
 * spelled the page canonically is the caller's concern (see
 * `albumPageParamValue`): the page redirects when the raw value differs
 * from the canonical one.
 */
export function parseAlbumPageParam(
  raw: string | string[] | undefined,
): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || !/^\d+$/.test(value)) return 1;
  const n = Number(value);
  if (n < 1) return 1;
  return Math.min(n, Number.MAX_SAFE_INTEGER);
}

/*
 * Canonical `?page=` value for a page: page 1 has no parameter (the bare
 * list URL is page 1, so `/albums` and `/albums?page=1` don't both
 * exist), every later page is its plain decimal number.
 */
export function albumPageParamValue(page: number): string | undefined {
  return page > 1 ? String(page) : undefined;
}

/*
 * Query of the canonical list URL for a filter + page: `artist` when a
 * validated filter is active, `page` only from page 2 on. Shared by the
 * page's normalising redirect and every pager link, so the two can't
 * disagree about which URL is canonical.
 */
export function albumListQuery(
  artist: string | null,
  page: number,
): Record<string, string> {
  const query: Record<string, string> = {};
  if (artist) query.artist = artist;
  const pageValue = albumPageParamValue(page);
  if (pageValue) query.page = pageValue;
  return query;
}

export type AlbumPageItem = number | "ellipsis";

/*
 * Numbered pager window from the approved v3 packet: the first and last
 * page, the current page and one neighbour on each side, and an ellipsis
 * for every hidden run — even a run of one page (page 4 of 24 reads
 * `1 … 3 4 5 … 24`, page 3 reads `1 2 3 4 … 24`).
 */
export function albumPageItems(
  current: number,
  totalPages: number,
): AlbumPageItem[] {
  const shown = new Set(
    [1, current - 1, current, current + 1, totalPages].filter(
      (p) => p >= 1 && p <= totalPages,
    ),
  );
  const items: AlbumPageItem[] = [];
  let prev = 0;
  for (const p of [...shown].sort((a, b) => a - b)) {
    if (p - prev > 1) items.push("ellipsis");
    items.push(p);
    prev = p;
  }
  return items;
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
 * Chip set for the `/albums` artist filter — only top-level
 * (representative) artists, matching the /artists list (the QA pass
 * intent: don't list every sub-unit). A top-level artist appears when it
 * OR any of its sub-units has ≥1 album, since a pick covers the whole
 * family (see getAlbums). Returns id (string, for `?artist=`) + a short
 * display name; ordered by id (≈ creation order, so the parent group
 * leads).
 */
export async function getAlbumArtistFilters(
  locale: string,
): Promise<AlbumArtistFilterOption[]> {
  const artists = await prisma.artist.findMany({
    where: {
      isDeleted: false,
      parentArtistId: null,
      OR: [
        { albums: { some: {} } },
        // Non-deleted sub-units only — consistent with the top-level
        // isDeleted filter + getAlbums' sub-unit branch.
        { subArtists: { some: { isDeleted: false, albums: { some: {} } } } },
      ],
    },
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
