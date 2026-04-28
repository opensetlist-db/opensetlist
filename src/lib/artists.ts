import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { getEventStatus } from "@/lib/eventStatus";
import type { ArtistType, GroupCategory } from "@/generated/prisma/enums";

type ArtistTranslation = {
  locale: string;
  name: string;
  shortName: string | null;
};

type SeriesAncestor = {
  id: number;
  parentSeriesId: number | null;
  artistId: number | null;
};

const MAX_SERIES_DEPTH = 32;

function getOwningArtistId(
  startSeriesId: number,
  ancestry: Map<number, SeriesAncestor>,
): number | null {
  let cur = startSeriesId;
  for (let i = 0; i < MAX_SERIES_DEPTH; i++) {
    const node = ancestry.get(cur);
    if (!node) return null;
    if (node.artistId != null) return node.artistId;
    if (node.parentSeriesId == null) return null;
    cur = node.parentSeriesId;
  }
  return null;
}

// ─── ARTISTS LIST PAGE (`/[locale]/artists`) ──────────────────────────────
//
// Group-grouped data for the redesigned list page. Returns Groups (with
// hasBoard=true) and their top-level Artists, plus per-artist hasOngoing
// (resolved via getEventStatus, NOT raw event.status — see CLAUDE.md note
// about scheduled-but-actually-ongoing events) and totalEvents.
//
// A single global fetch of {EventSeries, Event} maps every event to its
// owning artist via the parentSeriesId chain (events live on sub-series
// whose parent — possibly grandparent — has the artistId). Doing it this
// way is one extra round trip but avoids per-artist subqueries and keeps
// the count derivation in plain JS where it's easy to read.

export type ArtistsListFilter = "all" | "animegame" | "kpop" | "jpop";

const FILTER_TO_CATEGORIES: Record<
  Exclude<ArtistsListFilter, "all">,
  GroupCategory[]
> = {
  // Anime + Game share a UI chip; both DB enum values match.
  animegame: ["anime", "game"],
  kpop: ["kpop"],
  jpop: ["jpop"],
};

export function isArtistsListFilter(
  value: string | undefined,
): value is ArtistsListFilter {
  return (
    value === "all" ||
    value === "animegame" ||
    value === "kpop" ||
    value === "jpop"
  );
}

// `originalName` is declared `String` (non-null) in schema.prisma but the
// Prisma-7 generated client types it as `string | null` for every model
// here — defensive default the generator applies regardless of the
// schema-level NOT NULL. Match that shape exactly so callers handle the
// null branch instead of crashing on a typed-string contract that the
// generated client doesn't actually guarantee.
export type SubArtistChip = {
  id: number;
  originalName: string | null;
  originalShortName: string | null;
  originalLanguage: string;
  translations: ArtistTranslation[];
};

export type ArtistRowData = {
  id: number;
  slug: string;
  color: string | null;
  type: ArtistType;
  originalName: string | null;
  originalShortName: string | null;
  originalLanguage: string;
  translations: ArtistTranslation[];
  subArtists: SubArtistChip[];
  hasOngoing: boolean;
  totalEvents: number;
};

type GroupTranslationRow = {
  locale: string;
  name: string;
  shortName: string | null;
  description: string | null;
};

export type GroupForList = {
  id: string;
  category: GroupCategory | null;
  originalName: string | null;
  originalShortName: string | null;
  originalLanguage: string;
  translations: GroupTranslationRow[];
  artists: ArtistRowData[];
  hasOngoing: boolean;
};

export async function getArtistGroupsForList(
  filter: ArtistsListFilter,
  referenceNow: Date,
): Promise<GroupForList[]> {
  const categoryClause =
    filter === "all"
      ? {}
      : { category: { in: FILTER_TO_CATEGORIES[filter] } };

  // `hasBoard` was the previous filter here, but it's a discussion-board
  // admin flag (Phase 2 community), not a "show on the artists list"
  // flag. Filtering on it hid every group whose operator hadn't toggled
  // hasBoard=true — including the Phase 1 Hasunosora group, which left
  // the page rendering empty. The list page is content navigation,
  // independent of board state.
  const [groupsRaw, seriesRaw, eventsRaw] = await Promise.all([
    prisma.group.findMany({
      where: { ...categoryClause },
      include: {
        translations: {
          select: {
            locale: true,
            name: true,
            shortName: true,
            description: true,
          },
        },
        artistLinks: {
          // Filter the join rows so we only fetch top-level non-deleted
          // artists. Sub-units render as gray chips on the parent's row,
          // not as their own rows.
          where: {
            artist: { isDeleted: false, parentArtistId: null },
          },
          include: {
            artist: {
              include: {
                translations: {
                  select: { locale: true, name: true, shortName: true },
                },
                subArtists: {
                  where: { isDeleted: false },
                  select: {
                    id: true,
                    originalName: true,
                    originalShortName: true,
                    originalLanguage: true,
                    translations: {
                      select: {
                        locale: true,
                        name: true,
                        shortName: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.eventSeries.findMany({
      where: { isDeleted: false },
      select: { id: true, parentSeriesId: true, artistId: true },
    }),
    prisma.event.findMany({
      where: { isDeleted: false, eventSeriesId: { not: null } },
      select: { eventSeriesId: true, status: true, startTime: true },
    }),
  ]);

  // Build series-id ancestry map (as in getTopLevelArtists), then bucket
  // every event into its owning artist. Two parallel maps so we can
  // derive both `totalEvents` and `hasOngoing` in a single pass.
  const ancestry = new Map(
    (serializeBigInt(seriesRaw) as unknown as SeriesAncestor[]).map((s) => [
      s.id,
      s,
    ]),
  );

  const eventCountByArtist = new Map<number, number>();
  const ongoingByArtist = new Set<number>();
  for (const raw of eventsRaw) {
    if (raw.eventSeriesId == null) continue;
    const seriesId = Number(raw.eventSeriesId);
    const artistId = getOwningArtistId(seriesId, ancestry);
    if (artistId == null) continue;
    eventCountByArtist.set(
      artistId,
      (eventCountByArtist.get(artistId) ?? 0) + 1,
    );
    if (
      getEventStatus(
        { status: raw.status, startTime: raw.startTime },
        referenceNow,
      ) === "ongoing"
    ) {
      ongoingByArtist.add(artistId);
    }
  }

  type RawGroup = (typeof groupsRaw)[number];
  type RawArtistLink = RawGroup["artistLinks"][number];
  type RawArtist = RawArtistLink["artist"];
  type RawSubArtist = RawArtist["subArtists"][number];

  const serializedGroups = serializeBigInt(groupsRaw) as unknown as Array<
    Omit<RawGroup, "artistLinks"> & {
      artistLinks: Array<{
        artist: Omit<RawArtist, "id" | "subArtists"> & {
          id: number;
          subArtists: Array<Omit<RawSubArtist, "id"> & { id: number }>;
        };
      }>;
    }
  >;

  const groups: GroupForList[] = serializedGroups.map((g) => {
    const artists: ArtistRowData[] = g.artistLinks.map(({ artist }) => ({
      id: artist.id,
      slug: artist.slug,
      color: artist.color,
      type: artist.type,
      originalName: artist.originalName,
      originalShortName: artist.originalShortName,
      originalLanguage: artist.originalLanguage,
      translations: artist.translations,
      subArtists: artist.subArtists.map((s) => ({
        id: s.id,
        originalName: s.originalName,
        originalShortName: s.originalShortName,
        originalLanguage: s.originalLanguage,
        translations: s.translations,
      })),
      hasOngoing: ongoingByArtist.has(artist.id),
      totalEvents: eventCountByArtist.get(artist.id) ?? 0,
    }));

    return {
      id: g.id,
      category: g.category,
      originalName: g.originalName,
      originalShortName: g.originalShortName,
      originalLanguage: g.originalLanguage,
      translations: g.translations,
      artists,
      hasOngoing: artists.some((a) => a.hasOngoing),
    };
  });

  // Drop groups with zero matching top-level artists (the category filter
  // already trimmed the candidate set, but a group can still be empty if
  // every top-level artist is soft-deleted).
  const nonEmpty = groups.filter((g) => g.artists.length > 0);

  // Pin groups with ongoing events to top, then alphabetize by
  // originalName (locale-aware sorting happens at display time —
  // originalName is the stable cross-locale anchor).
  return nonEmpty.sort((a, b) => {
    if (a.hasOngoing !== b.hasOngoing) return a.hasOngoing ? -1 : 1;
    return (a.originalName ?? "").localeCompare(b.originalName ?? "");
  });
}

// Categories that have at least one matching board-enabled group with at
// least one non-deleted top-level artist. Drives FilterBar so we don't
// render chips that lead to an empty page (Phase 1 seed is anime/game
// only — K-POP / J-POP chips currently dead-end).
//
// Returns a Set keyed on `ArtistsListFilter`: `all` is always present;
// `animegame` is present if the catalog has any anime OR game entries;
// `kpop` / `jpop` per direct match. The shape mirrors the FilterBar
// chip set so the consumer is a one-line `available.has(value)`.
export async function getAvailableArtistFilters(): Promise<
  Set<ArtistsListFilter>
> {
  const groupsWithArtists = await prisma.group.findMany({
    where: {
      // `hasBoard` is intentionally NOT in this clause — it's a
      // discussion-board admin flag, not a list-visibility flag.
      // Mirrors the `where` shape in `getArtistGroupsForList` so the
      // two queries can't disagree on what counts as a populated group.
      artistLinks: {
        some: { artist: { isDeleted: false, parentArtistId: null } },
      },
    },
    select: { category: true },
  });

  const categories = new Set<GroupCategory>();
  for (const g of groupsWithArtists) {
    if (g.category != null) categories.add(g.category);
  }

  const available = new Set<ArtistsListFilter>(["all"]);
  if (categories.has("anime") || categories.has("game")) {
    available.add("animegame");
  }
  if (categories.has("kpop")) available.add("kpop");
  if (categories.has("jpop")) available.add("jpop");
  return available;
}
