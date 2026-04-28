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

// 1:1 with the GroupCategory enum after the v2 reshape (animegame
// merged from anime+game; `others` added) plus `all` as a no-op
// passthrough. Each value other than `all` maps directly to a single
// `GroupCategory` enum value, so the page can pass `filter` straight
// to `where: { category: filter }` without an intermediate table.
export type ArtistsListFilter =
  | "all"
  | "animegame"
  | "kpop"
  | "jpop"
  | "cpop"
  | "others";

export function isArtistsListFilter(
  value: string | undefined,
): value is ArtistsListFilter {
  return (
    value === "all" ||
    value === "animegame" ||
    value === "kpop" ||
    value === "jpop" ||
    value === "cpop" ||
    value === "others"
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
  // Synthetic sections wrap top-level Artists with no `hasBoard=true`
  // Group link. They render as Group cards visually but don't have a
  // backing Group row; downstream consumers should resolve the section
  // header via i18n (`Artist.ungroupedSection` /
  // `ungroupedNoCategorySection`) instead of `displayNameWithFallback`,
  // and skip any "open this group's board" link if added later. Real
  // Groups always come back with `isSynthetic: false`.
  isSynthetic: boolean;
};

export async function getArtistGroupsForList(
  filter: ArtistsListFilter,
  referenceNow: Date,
): Promise<GroupForList[]> {
  // After the v2 enum reshape each filter value other than `all` maps
  // to exactly one `GroupCategory` enum value, so we can pass `filter`
  // straight through to `where: { category: filter }` for both the
  // Group query (real sections) and the Artist query (synthetic
  // ungrouped sections).
  const categoryClause =
    filter === "all" ? {} : { category: filter as GroupCategory };

  // `hasBoard` was the previous filter here, but it's a discussion-board
  // admin flag (Phase 2 community), not a "show on the artists list"
  // flag. Filtering on it hid every group whose operator hadn't toggled
  // hasBoard=true — including the Phase 1 Hasunosora group, which left
  // the page rendering empty. The list page is content navigation,
  // independent of board state.
  const [groupsRaw, seriesRaw, eventsRaw, ungroupedRaw] = await Promise.all([
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
                  // `isMainUnit: true` filter: the chip strip rendered next
                  // to a parent artist's row would otherwise blow up to
                  // every event-specific or member-pair sub-unit (~20 for
                  // Hasunosora). The flag is operator-curated so we always
                  // honor it here. Implication for ops: a freshly-imported
                  // unit defaults to `isMainUnit=false` and stays hidden
                  // until promoted via the admin form or CSV.
                  where: { isDeleted: false, isMainUnit: true },
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
    // Ungrouped artists: top-level Artists with NO ArtistGroup link
    // at all. The real-Groups query above doesn't filter on hasBoard
    // — it surfaces every Group regardless of board state — so the
    // "ungrouped" predicate has to mirror that and exclude any artist
    // already reachable through a real Group section. Otherwise an
    // artist linked only to a `hasBoard=false` Group renders TWICE:
    // once under the real Group's card and again under the synthetic
    // ungrouped section (this exact bug shipped to preview).
    //
    // Apply the SAME `categoryClause` here so the filter chip is
    // consistent: the chip filters the union of grouped + ungrouped.
    // For `filter === "all"` we want every ungrouped artist regardless
    // of `Artist.category` (including null); for any other filter,
    // `Artist.category` must equal the chip value exactly.
    prisma.artist.findMany({
      where: {
        isDeleted: false,
        parentArtistId: null,
        groupLinks: { none: {} },
        ...categoryClause,
      },
      include: {
        translations: {
          select: { locale: true, name: true, shortName: true },
        },
        subArtists: {
          where: { isDeleted: false, isMainUnit: true },
          select: {
            id: true,
            originalName: true,
            originalShortName: true,
            originalLanguage: true,
            translations: {
              select: { locale: true, name: true, shortName: true },
            },
          },
        },
      },
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
      isSynthetic: false,
    };
  });

  // Drop groups with zero matching top-level artists (the category filter
  // already trimmed the candidate set, but a group can still be empty if
  // every top-level artist is soft-deleted).
  const realGroups = groups.filter((g) => g.artists.length > 0);

  // Pin groups with ongoing events to top, then alphabetize by
  // originalName (locale-aware sorting happens at display time —
  // originalName is the stable cross-locale anchor).
  realGroups.sort((a, b) => {
    if (a.hasOngoing !== b.hasOngoing) return a.hasOngoing ? -1 : 1;
    return (a.originalName ?? "").localeCompare(b.originalName ?? "");
  });

  // ── Synthetic ungrouped sections ──────────────────────────────────
  type RawUngroupedArtist = (typeof ungroupedRaw)[number];
  const serializedUngrouped = serializeBigInt(
    ungroupedRaw,
  ) as unknown as Array<
    Omit<RawUngroupedArtist, "id" | "subArtists"> & {
      id: number;
      subArtists: Array<
        Omit<RawUngroupedArtist["subArtists"][number], "id"> & { id: number }
      >;
    }
  >;

  const ungroupedRows: Array<{
    category: GroupCategory | null;
    artist: ArtistRowData;
  }> = serializedUngrouped.map((artist) => ({
    category: artist.category,
    artist: {
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
    },
  }));

  // Real Groups always render above synthetic sections (rationale:
  // a real Group is a curated/board-eligible entity; pinning a
  // synthetic bucket above one would be visually surprising). If an
  // ungrouped artist is currently ongoing and the operator wants it
  // top-pinned, the right ops fix is to link it to a Group.
  return [...realGroups, ...synthesizeUngroupedSections(ungroupedRows, filter)];
}

/**
 * Bucket ungrouped artists by `Artist.category` and emit one
 * synthetic `GroupForList` section per non-empty bucket. Pure: no
 * Prisma access, no `Date.now` — drives unit-test coverage of the
 * page's bucketing rules.
 *
 * Bucketing rules:
 * - Artists with a non-null category land in the bucket matching that
 *   category (animegame / kpop / jpop / cpop / others).
 * - Artists with `category === null` land in the synthetic "none"
 *   bucket, which is ONLY emitted when `filter === "all"` — null is
 *   intrinsically unmatchable against any chip, so showing the bucket
 *   under any filtered view would be misleading.
 * - Section ordering is fixed: animegame, kpop, jpop, cpop, others,
 *   none. Operator-facing chip order (FilterBar) matches this so the
 *   page reads top-to-bottom in the same order as the chips left-to-
 *   right.
 *
 * Synthetic sections always have `isSynthetic: true` so consumers
 * (GroupSection, future per-section affordances) can branch on the
 * flag rather than string-sniffing the synthetic id namespace.
 */
export function synthesizeUngroupedSections(
  rows: Array<{ category: GroupCategory | null; artist: ArtistRowData }>,
  filter: ArtistsListFilter,
): GroupForList[] {
  const buckets = new Map<string, ArtistRowData[]>();
  for (const { category, artist } of rows) {
    const bucketKey = category ?? "none";
    const existing = buckets.get(bucketKey);
    if (existing) existing.push(artist);
    else buckets.set(bucketKey, [artist]);
  }

  const SYNTHETIC_ORDER: Array<GroupCategory | "none"> = [
    "animegame",
    "kpop",
    "jpop",
    "cpop",
    "others",
    "none",
  ];

  const sections: GroupForList[] = [];
  for (const key of SYNTHETIC_ORDER) {
    if (key === "none" && filter !== "all") continue;
    const artists = buckets.get(key);
    if (!artists || artists.length === 0) continue;
    sections.push({
      id: `synthetic:ungrouped:${key}`,
      category: key === "none" ? null : (key as GroupCategory),
      // Section header falls through to a translated label in
      // GroupSection when isSynthetic is true. Leaving originalName
      // null surfaces any code that accidentally renders it.
      originalName: null,
      originalShortName: null,
      originalLanguage: "",
      translations: [],
      artists,
      hasOngoing: artists.some((a) => a.hasOngoing),
      isSynthetic: true,
    });
  }
  return sections;
}

// Categories that have at least one matching populated source —
// either a Group (with at least one non-deleted top-level artist) or
// an ungrouped top-level Artist with `Artist.category` set. Drives
// FilterBar so we don't render chips that lead to an empty page
// (Phase 1 seed is animegame only — K-POP / J-POP / C-POP chips
// currently dead-end).
//
// Returns a Set keyed on `ArtistsListFilter`: `all` is always present;
// each enum value is present if the union of grouped+ungrouped has any
// matching row. After the v2 enum reshape every category maps 1:1 to
// a single chip, so the shape is a flat lookup.
export async function getAvailableArtistFilters(): Promise<
  Set<ArtistsListFilter>
> {
  const [groupsWithArtists, ungroupedArtistCategories] = await Promise.all([
    prisma.group.findMany({
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
    }),
    prisma.artist.findMany({
      where: {
        isDeleted: false,
        parentArtistId: null,
        category: { not: null },
        // Mirror the `groupLinks: { none: {} }` predicate from
        // getArtistGroupsForList so this helper agrees on what
        // "ungrouped" means. Otherwise the chip set could include
        // categories that won't actually surface anywhere.
        groupLinks: { none: {} },
      },
      select: { category: true },
    }),
  ]);

  const categories = new Set<GroupCategory>();
  for (const g of groupsWithArtists) {
    if (g.category != null) categories.add(g.category);
  }
  for (const a of ungroupedArtistCategories) {
    if (a.category != null) categories.add(a.category);
  }

  const available = new Set<ArtistsListFilter>(["all"]);
  if (categories.has("animegame")) available.add("animegame");
  if (categories.has("kpop")) available.add("kpop");
  if (categories.has("jpop")) available.add("jpop");
  if (categories.has("cpop")) available.add("cpop");
  if (categories.has("others")) available.add("others");
  return available;
}
