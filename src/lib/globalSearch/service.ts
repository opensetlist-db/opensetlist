import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { SearchType } from "./params";

/*
 * Public global search — ticket 13 (spec "Global search contract").
 *
 * Two steps per type, both bounded:
 *
 *   1. rankIds()  one raw SQL statement that finds, deduplicates, ranks
 *                 and paginates entity IDs over every eligible own name;
 *   2. hydrate()  one Prisma `findMany` over just those IDs with a
 *                 minimal projection (identity, slug, display fields).
 *
 * Why raw SQL for step 1: the ranking contract needs, per entity, the
 * BEST match across all its original / translated / short names
 * (exact → prefix → substring, ID tie-break), computed BEFORE
 * LIMIT/OFFSET. Prisma's `contains: { mode: "insensitive" }` can filter
 * but cannot rank, and ranking in JS would mean loading every candidate
 * — the "no truncation, no loading full graphs" rule rules out both.
 *
 * Normalization — the same expression is applied to BOTH operands inside
 * Postgres, so candidate inclusion and rank can never disagree with each
 * other (the spec's "equivalent normalization" requirement):
 *
 *   lower(btrim(translate(normalize(x, NFKC), <curly apostrophes>, "'")))
 *
 * mirroring `normalizeArtistQuery` in `src/lib/search.ts` (NFKC folds
 * full-width Latin and MICRO SIGN → μ; curly / modifier / full-width
 * apostrophes → ASCII ') plus case folding. The query is passed raw (as
 * a bind parameter, never interpolated) and normalized by the same SQL
 * expression, so no JS-vs-Postgres case-folding drift is possible.
 *
 * Matching uses `strpos` rather than LIKE/ILIKE: no wildcard escaping
 * is needed for user input containing `%` or `_`, and prefix is just
 * `strpos(...) = 1`.
 *
 * Visibility mirrors the public detail pages: Event / Artist / Song
 * exclude `isDeleted`; Album has no deletion column and every existing
 * row is public (`/albums/[id]` 404s only on a missing row). Each type
 * searches only its OWN names: no artist → song/album expansion, no
 * series → concert expansion, no venue/credit matching.
 *
 * No COUNT(*): the UI never shows totals. Each call fetches `limit + 1`
 * rows so the caller knows whether a further page / "more" link exists.
 *
 * Measured plans/latency are recorded in the ticket-13 handoff; no index
 * or helper DDL is part of this module.
 */

const APOSTROPHES_FROM = "‘’ʼ＇";
const APOSTROPHES_TO = "''''";

function norm(expr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`lower(btrim(translate(normalize(${expr}, NFKC), ${APOSTROPHES_FROM}, ${APOSTROPHES_TO})))`;
}

/**
 * Every eligible own name of a type as (id, name, locale, src) rows.
 * `locale` is null for the entity's original-language fields (the caller
 * maps that to `originalLanguage`); `src` orders the tie-break for the
 * matched-name line (original before translations, full before short).
 */
const NAME_SOURCES: Record<SearchType, Prisma.Sql> = {
  events: Prisma.sql`
    SELECT e.id, e."originalName" AS name, NULL::text AS locale, 0 AS src
      FROM "Event" e WHERE e."isDeleted" = false
    UNION ALL
    SELECT e.id, e."originalShortName", NULL, 1
      FROM "Event" e WHERE e."isDeleted" = false AND e."originalShortName" IS NOT NULL
    UNION ALL
    SELECT t."eventId", t.name, t.locale, 2
      FROM "EventTranslation" t JOIN "Event" e ON e.id = t."eventId"
     WHERE e."isDeleted" = false
    UNION ALL
    SELECT t."eventId", t."shortName", t.locale, 3
      FROM "EventTranslation" t JOIN "Event" e ON e.id = t."eventId"
     WHERE e."isDeleted" = false AND t."shortName" IS NOT NULL`,
  artists: Prisma.sql`
    SELECT a.id, a."originalName" AS name, NULL::text AS locale, 0 AS src
      FROM "Artist" a WHERE a."isDeleted" = false
    UNION ALL
    SELECT a.id, a."originalShortName", NULL, 1
      FROM "Artist" a WHERE a."isDeleted" = false AND a."originalShortName" IS NOT NULL
    UNION ALL
    SELECT t."artistId", t.name, t.locale, 2
      FROM "ArtistTranslation" t JOIN "Artist" a ON a.id = t."artistId"
     WHERE a."isDeleted" = false
    UNION ALL
    SELECT t."artistId", t."shortName", t.locale, 3
      FROM "ArtistTranslation" t JOIN "Artist" a ON a.id = t."artistId"
     WHERE a."isDeleted" = false AND t."shortName" IS NOT NULL`,
  songs: Prisma.sql`
    SELECT s.id, s."originalTitle" AS name, NULL::text AS locale, 0 AS src
      FROM "Song" s WHERE s."isDeleted" = false
    UNION ALL
    SELECT t."songId", t.title, t.locale, 2
      FROM "SongTranslation" t JOIN "Song" s ON s.id = t."songId"
     WHERE s."isDeleted" = false`,
  albums: Prisma.sql`
    SELECT al.id, al."originalTitle" AS name, NULL::text AS locale, 0 AS src
      FROM "Album" al
    UNION ALL
    SELECT t."albumId", t.title, t.locale, 2
      FROM "AlbumTranslation" t`,
};

export type RankedId = {
  id: bigint;
  /** 0 exact, 1 prefix, 2 substring. */
  rank: number;
  /** The best-ranked own name that matched (for the matched-name line). */
  matchedName: string;
  /** Locale of that name; null = the entity's original-language field. */
  matchedLocale: string | null;
};

/**
 * Ranked, deduplicated, paginated IDs of one type. Returns up to
 * `limit + 1` rows (the extra row only signals "more").
 */
export async function rankIds(
  type: SearchType,
  query: string,
  limit: number,
  offset: number,
): Promise<RankedId[]> {
  const rows = await prisma.$queryRaw<
    { id: bigint; rank: number; name: string; locale: string | null }[]
  >(Prisma.sql`
    WITH q AS (SELECT ${norm(Prisma.sql`${query}::text`)} AS v),
    names AS (${NAME_SOURCES[type]}),
    scored AS (
      SELECT n.id, n.name, n.locale, n.src,
             CASE WHEN x.nn = q.v THEN 0
                  WHEN strpos(x.nn, q.v) = 1 THEN 1
                  ELSE 2 END AS rank
        FROM names n
        CROSS JOIN q
        CROSS JOIN LATERAL (SELECT ${norm(Prisma.sql`n.name`)} AS nn) x
       WHERE q.v <> '' AND strpos(x.nn, q.v) > 0
    ),
    best AS (
      SELECT DISTINCT ON (id) id, rank, name, locale
        FROM scored
       ORDER BY id, rank, src, locale NULLS FIRST
    )
    SELECT id, rank, name, locale
      FROM best
     ORDER BY rank, id
     LIMIT ${limit + 1} OFFSET ${offset}`);
  return rows.map((r) => ({
    id: r.id,
    rank: Number(r.rank),
    matchedName: r.name,
    matchedLocale: r.locale,
  }));
}

/* ── Projections ─────────────────────────────────────────────────────── */

const EVENT_SELECT = {
  id: true,
  slug: true,
  date: true,
  startTime: true,
  originalName: true,
  originalShortName: true,
  originalVenue: true,
  originalLanguage: true,
  translations: {
    select: { locale: true, name: true, shortName: true, venue: true },
  },
} satisfies Prisma.EventSelect;

const ARTIST_SELECT = {
  id: true,
  slug: true,
  type: true,
  originalName: true,
  originalShortName: true,
  originalLanguage: true,
  translations: { select: { locale: true, name: true, shortName: true } },
} satisfies Prisma.ArtistSelect;

const SONG_SELECT = {
  id: true,
  slug: true,
  originalTitle: true,
  originalLanguage: true,
  variantLabel: true,
  baseVersionId: true,
  translations: { select: { locale: true, title: true, variantLabel: true } },
  // A base song is labelled "base version" only when a visible variant
  // points at it (approved design: no badge on songs without versions).
  _count: { select: { variants: { where: { isDeleted: false } } } },
} satisfies Prisma.SongSelect;

const ALBUM_SELECT = {
  id: true,
  slug: true,
  type: true,
  originalTitle: true,
  originalLanguage: true,
  releaseDate: true,
  imageUrl: true,
  translations: { select: { locale: true, title: true } },
} satisfies Prisma.AlbumSelect;

export type EventHit = Prisma.EventGetPayload<{ select: typeof EVENT_SELECT }>;
export type ArtistHit = Prisma.ArtistGetPayload<{ select: typeof ARTIST_SELECT }>;
export type SongHit = Prisma.SongGetPayload<{ select: typeof SONG_SELECT }>;
export type AlbumHit = Prisma.AlbumGetPayload<{ select: typeof ALBUM_SELECT }>;

type HitByType = {
  events: EventHit;
  artists: ArtistHit;
  songs: SongHit;
  albums: AlbumHit;
};

export type SearchHit<T extends SearchType = SearchType> = {
  [K in T]: {
    type: K;
    entity: HitByType[K];
    matchedName: string;
    matchedLocale: string | null;
  };
}[T];

async function hydrate<T extends SearchType>(
  type: T,
  ids: bigint[],
): Promise<HitByType[T][]> {
  if (ids.length === 0) return [];
  // The visibility filter is repeated here on purpose: an entity
  // soft-deleted between the two statements simply drops out instead of
  // rendering a link to a 404.
  switch (type) {
    case "events":
      return (await prisma.event.findMany({
        where: { id: { in: ids }, isDeleted: false },
        select: EVENT_SELECT,
      })) as HitByType[T][];
    case "artists":
      return (await prisma.artist.findMany({
        where: { id: { in: ids }, isDeleted: false },
        select: ARTIST_SELECT,
      })) as HitByType[T][];
    case "songs":
      return (await prisma.song.findMany({
        where: { id: { in: ids }, isDeleted: false },
        select: SONG_SELECT,
      })) as HitByType[T][];
    case "albums":
      return (await prisma.album.findMany({
        where: { id: { in: ids } },
        select: ALBUM_SELECT,
      })) as HitByType[T][];
  }
  throw new Error(`unknown search type: ${String(type)}`);
}

export type SearchSlice<T extends SearchType = SearchType> = {
  type: T;
  hits: SearchHit<T>[];
  /** Another row exists after this slice (more link / next page). */
  hasMore: boolean;
};

/**
 * One ranked slice of a type: `limit` hits starting at `offset`, in rank
 * order, plus whether more exist.
 */
export async function searchType<T extends SearchType>(
  type: T,
  query: string,
  limit: number,
  offset: number,
): Promise<SearchSlice<T>> {
  const ranked = await rankIds(type, query, limit, offset);
  const hasMore = ranked.length > limit;
  const page = ranked.slice(0, limit);
  const entities = await hydrate(type, page.map((r) => r.id));
  const byId = new Map(entities.map((e) => [String(e.id), e]));
  const hits = page.flatMap((r) => {
    const entity = byId.get(String(r.id));
    if (!entity) return [];
    return [
      {
        type,
        entity,
        matchedName: r.matchedName,
        matchedLocale: r.matchedLocale,
      } as SearchHit<T>,
    ];
  });
  return { type, hits, hasMore };
}
