import { cache } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt, serializeBigIntAsString } from "@/lib/utils";
import { formatVenueDate } from "@/lib/eventDateTime";
import {
  displayNameWithFallback,
  displayOriginalTitle,
  resolveLocalizedField,
} from "@/lib/display";
import {
  getEventStatus,
  type ResolvedEventStatus,
} from "@/lib/eventStatus";
import { CACHE_TTL, cachedQuery, eventTag, joinIdKey } from "@/lib/dataCache";
import { isWishPredictOpen, wishPredictOpensAt } from "@/lib/eventTiming";
import { deriveOgPaletteFromCachedEvent } from "@/lib/ogPalette";
import { normalizeOgLocale } from "@/lib/ogLabels";
import type { TrendingSong } from "@/components/TrendingSongs";
import type { LiveSetlistItem } from "@/components/LiveSetlist";
import type { Impression } from "@/components/EventImpressions";
import { fetchEventWishlistTop3 } from "@/lib/wishes/top3";
import { LiveEventLayout } from "@/components/LiveEventLayout";
import { safeBigIntToNumber } from "@/lib/copyPastSetlist";
import {
  deriveFestivalFilters,
  deriveUnitFilters,
} from "@/lib/predict/unitFilters";
import {
  getAvailableSongsCached,
  getFestivalGroupArtistsCached,
} from "@/lib/predict/availableSongs";
import {
  mergeFestivalCatalog,
  resolveFestivalGroups,
} from "@/lib/predict/festivalCatalog";
import { getArtistHierarchyCached } from "@/lib/artistHierarchy";
import type { AvailableSong, UnitFilter } from "@/lib/types/predict";
import {
  deriveLineupFromRoster,
  deriveSidebarUnitsAndPerformers,
  deriveSongsCount,
  deriveReactionsValue,
  type EventPerformerSummary,
  type Lineup,
} from "@/lib/sidebarDerivations";
import type { EventRosterEntry } from "@/lib/types/setlist";
import { formatVenueStart } from "@/lib/venueTime";
import { buildEventJsonLd, serializeJsonLd } from "@/lib/seo/eventJsonLd";
import { Breadcrumb, type BreadcrumbItem } from "@/components/Breadcrumb";
import { EventBdSection } from "@/components/EventBdSection";
import { IMPRESSION_PAGE_SIZE } from "@/lib/config";
import { encodeImpressionCursor } from "@/lib/impressionCursor";
import { colors } from "@/styles/tokens";
import {
  FALLBACK_LOCALE,
  defaultLocale,
  locales,
  type Locale,
} from "@/i18n/routing";
import { getLiveSnapshot, type EventSnapshot } from "@/lib/liveSnapshot";
import { revToNumber } from "@/lib/liveBroadcast";
import type { Metadata } from "next";
import {
  absoluteUrl,
  entityAlternates,
  entityPath,
  enforceCanonicalSlug,
} from "@/lib/seo/entityUrl";

type Props = {
  params: Promise<{ locale: string; id: string; slug?: string[] }>;
};

// The wide event read. Called through `getEvent` below, which decides
// per request whether it may come from the cross-request data cache.
//
// Translation locale filter: every nested `translations` block filters
// to `[locale, "ja"]` rather than fetching all locales. Background:
// every translation table is joined as part of the larger include
// tree, and the unfiltered shape multiplies the row count by
// (locales-per-row × every-other-relation-fanout) — the Cartesian
// explosion that drove the 4–5s TTFB. The "ja" half of the pair is
// the canonical-original safety net (every model's `originalLanguage`
// defaults to "ja"); when present it backs `displayOriginalName`'s
// `sub`-line cascade and any future surface that wants the original-
// script name. The display helpers (`displayNameWithFallback`,
// `resolveLocalizedField`) still cascade through the parent's
// `originalName` / `originalShortName` columns when neither row
// matches, so a missing translation never renders blank.
async function fetchEvent(id: bigint, locale: string) {
  const localeFilter = { locale: { in: [locale, FALLBACK_LOCALE] } };
  const event = await prisma.event.findFirst({
    where: { id, isDeleted: false },
    // F24-sibling: this SSR query uses the `relationJoins` strategy
    // (single LATERAL JOIN with JSONB aggregation — see the q1/q2
    // comment below), so every one-to-many relation's rows are
    // materialized INLINE in the aggregated JSON. That duplicates each
    // nested entity once per parent edge (e.g. a stage identity that
    // performs on 30 setlist items is serialized 30×) on the
    // Postgres→Vercel pooler wire, which Supabase meters uncompressed.
    // `include` also returns every scalar column. We `omit` the columns
    // no public-page render path reads (grep-verified): `originalBio` /
    // `sourceNote` are free-text fields (largest single offenders, and
    // multiplied by the inline duplication), and the soft-delete pair
    // `isDeleted` / `deletedAt` is dead weight on every row (the query
    // already filters `isDeleted: false`, and nothing renders the
    // flags). Omitted, not select-narrowed, to keep the join shape and
    // its TTFB win (PR #262 / F20) untouched. `createdAt` stays — the
    // conflict-sort in <ActualSetlist> reads it; `baseVersionId` stays
    // — song-variant matching reads it.
    omit: { isDeleted: true, deletedAt: true },
    include: {
      translations: { where: localeFilter },
      eventSeries: {
        omit: { isDeleted: true, deletedAt: true },
        include: {
          translations: { where: localeFilter },
          // Pulled in so EventHeader can render an artist link.
          // `artistId` is nullable on EventSeries (multi-artist
          // festivals fall back to `organizerName`).
          artist: {
            // NB: `isDeleted` is NOT omitted here — unlike the other
            // artist relations below, the page reads
            // `eventSeries.artist.isDeleted` to drop soft-deleted
            // series artists from the header/predict links (this
            // relation isn't `where: { isDeleted: false }`-filtered).
            omit: { originalBio: true, deletedAt: true },
            include: {
              translations: { where: localeFilter },
              // Roster colors for OG palette empty-setlist fallback.
              // `deriveOgPaletteFromCachedEvent` previously fired
              // sequential `Artist.findUnique` (parent-chain walk in
              // `findRootArtistId`) + `StageIdentityArtist.findMany`
              // (`collectRosterColorsByArtistId`) inside
              // `generateMetadata` whenever an event's setlist had no
              // member colors — typical for upcoming events with
              // predicted-only setlists. Sentry issue 7516837136
              // measured the two queries at ~189ms + ~180ms wall
              // clock, sequential after the mega Event.findFirst.
              //
              // Folding `parentArtist.stageLinks` + own `stageLinks`
              // into the relationJoins LATERAL JOIN tree pays one
              // extra join per request to eliminate both follow-up
              // round-trips. Same pattern that fixed the artist page
              // in commit 30a33c5.
              //
              // Roster-selection rule (#506): `collectArtistRoster
              // FromCachedEvent` uses the event artist's OWN roster
              // first and falls back to `parentArtist`'s roster only
              // when the own roster is empty — matching the artist
              // page's `deriveOgPaletteFromCachedArtist` rule. So a
              // sub-unit-headlined event derives its palette from the
              // sub-unit, not the parent group; root-headlined events
              // are unaffected (own == root). We still pull
              // `parentArtist.stageLinks` so the fallback has data
              // without a second round-trip.
              //
              // Schema-assumption note: today's parent chain is at
              // most one level deep (sub-unit → parent group → null),
              // so a single level of `parentArtist` include covers the
              // fallback. A nested sub-unit (depth ≥ 2) would need a
              // deeper include here AND an explicit chain-walk in the
              // cached helper — neither exists yet by design.
              parentArtist: {
                select: {
                  stageLinks: {
                    select: { stageIdentity: { select: { color: true } } },
                  },
                },
              },
              stageLinks: {
                select: { stageIdentity: { select: { color: true } } },
              },
            },
          },
        },
      },
      // BD album linked via `Event.bdAlbumId` (added in v0.14.0). Pulled
      // here so `<EventBdSection>` can resolve its state machine + render
      // the album / top-3 매장特典 preview without a second roundtrip.
      // Nested include order matches the album-page (`getAlbum`) shape so
      // `displayOriginalTitle` / `displayOriginalName` / `resolveStoreName`
      // / `resolveBonusType` all run against identical translation slices.
      // Returns null when `bdAlbumId` is null (most events at MVP); the
      // component handles the null safely.
      bdAlbum: {
        include: {
          translations: { where: localeFilter },
          artists: {
            include: {
              // Same egress rule as the other artist relations in this
              // query: `originalBio` / `bio` are the widest free-text
              // columns and nothing on the BD render path reads them
              // (the section only needs the name for
              // `displayOriginalName`). The soft-delete pair is dead
              // weight here too — the section doesn't render it.
              artist: {
                omit: { originalBio: true, isDeleted: true, deletedAt: true },
                include: {
                  translations: {
                    where: localeFilter,
                    omit: { bio: true },
                  },
                },
              },
            },
          },
          listings: {
            include: {
              translations: { where: localeFilter },
              bonuses: {
                include: { translations: { where: localeFilter } },
              },
            },
          },
        },
      },
      // Event-level performer roster — used to source the guest set
      // for D10a (Phase 1A): characters flagged here as guests are
      // skipped from host-unit member sublists in Pass-2 below, and
      // marked with the "· 게스트" suffix in the sidebar Performers
      // card. Cheap select-only join; no relation traversal beyond
      // the flag. NOTE: the relation name on the Event model is
      // `performers` (per `prisma/schema.prisma:480`) — distinct from
      // `setlistItems[].performers` (which is `SetlistItemMember[]`).
      // Using the schema name here.
      performers: {
        select: {
          stageIdentityId: true,
          isGuest: true,
        },
      },
      setlistItems: {
        where: { isDeleted: false },
        omit: { note: true, isDeleted: true, deletedAt: true },
        include: {
          songs: {
            include: {
              song: {
                omit: { sourceNote: true, isDeleted: true, deletedAt: true },
                include: {
                  translations: { where: localeFilter },
                  artists: {
                    include: {
                      artist: {
                        omit: {
                          originalBio: true,
                          isDeleted: true,
                          deletedAt: true,
                        },
                        include: { translations: { where: localeFilter } },
                      },
                    },
                  },
                },
              },
            },
            orderBy: { order: "asc" },
          },
          performers: {
            include: {
              stageIdentity: {
                include: {
                  translations: { where: localeFilter },
                  // `artistLinks` carries the StageIdentity → Artist
                  // membership rows. Needed by the page to build the
                  // per-unit members sublist on `<UnitsCard>` (each
                  // performer's links tell us which units they
                  // belong to). We don't filter on dates — see the
                  // "Pass 2" comment block in the page body.
                  artistLinks: {
                    select: {
                      artistId: true,
                    },
                  },
                },
              },
              realPerson: {
                include: { translations: { where: localeFilter } },
              },
            },
          },
          artists: {
            include: {
              artist: {
                omit: {
                  originalBio: true,
                  isDeleted: true,
                  deletedAt: true,
                },
                include: { translations: { where: localeFilter } },
              },
            },
          },
        },
        orderBy: { position: "asc" },
      },
    },
  });
  if (!event) return null;
  return serializeBigInt(event);
}

// Narrow status read — the only thing `getEvent` needs to decide
// cached vs. live. Two columns, so a cache miss here costs bytes, not
// the 50–500 KB of the wide read.
const getEventStatusRow = cachedQuery(
  "event-status",
  (id: bigint) =>
    prisma.event.findFirst({
      where: { id, isDeleted: false },
      select: { status: true, startTime: true },
    }),
  { revalidate: CACHE_TTL.eventStatus, tags: (id) => [eventTag(id)] },
);

// `status` is part of the key, not just an input to the bypass
// decision: `unstable_cache` serves a stale entry once (of any age)
// while it refreshes in the background, so without it the first
// visitor after a show ends would get the pre-show snapshot cached
// under the same key. Keying on the resolved status makes the
// upcoming → completed transition a fresh miss instead.
const getEventCached = cachedQuery(
  "event-detail",
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- key-only arg (see above)
  (id: bigint, locale: string, _status: ResolvedEventStatus) =>
    fetchEvent(id, locale),
  { revalidate: CACHE_TTL.event, tags: (id) => [eventTag(id)] },
);

// Wrapped in `react.cache()` so the duplicate call across
// `generateMetadata` and `EventPage` collapses to one fetch per
// request; `cachedQuery` underneath dedups across requests.
//
// Live shows bypass the data cache: the page seeds reactions,
// impressions and the setlist that the realtime/polling layer then
// keeps current, and that SSR seed must not be up to a TTL behind
// while an operator is entering songs. Everything else (upcoming and
// completed events — i.e. almost every crawler hit) is served from the
// cache. The status is resolved from the cheap cached row with the
// request's clock, so the upcoming → ongoing flip at `startTime` takes
// effect immediately even though the stored `status` is still
// "scheduled".
const getEvent = cache(async (id: bigint, locale: string) => {
  const statusRow = await getEventStatusRow(id);
  if (!statusRow) return null;
  const status = getEventStatus(statusRow);
  return status === "ongoing"
    ? fetchEvent(id, locale)
    : getEventCached(id, locale, status);
});

// Live seed (n14): while the show is ongoing, the setlist, reaction
// counts and wish TOP-3 the client starts from come from the SAME
// snapshot `/api/setlist` serves (`src/lib/liveSnapshot.ts`), together
// with that snapshot's `rev` / `capturedAt`. The client treats them as
// its initially-applied state and only accepts a later fetch with a
// higher revision (or the same revision captured no earlier), so the
// first client fetch can never roll the SSR setlist back — which it
// could when SSR read the items with a separate, later query than the
// revision. The snapshot is the 2 s data-cache entry that every setlist
// writer expires on commit, so the seed is as fresh as the API.
//
// Null for every non-ongoing event: those keep the cached wide read
// (`getEventCached`) and their own reaction / TOP-3 queries, and the
// client starts with no applied revision.
const getLiveSeed = cache(
  async (id: bigint, locale: string): Promise<EventSnapshot | null> => {
    const statusRow = await getEventStatusRow(id);
    if (!statusRow || getEventStatus(statusRow) !== "ongoing") return null;
    const snapshotLocale: Locale = locales.includes(locale as Locale)
      ? (locale as Locale)
      : defaultLocale;
    const { snapshot } = await getLiveSnapshot(id, snapshotLocale);
    return snapshot.found && !snapshot.isDeleted ? snapshot : null;
  },
);

// Event roster with each stage identity's artist memberships — the
// input for the pre-show lineup (`deriveLineupFromRoster`) and the
// JSON-LD `performer` groups. Kept OUT of the wide `fetchEvent` read on
// purpose: that query is `relationJoins`-aggregated, so nesting
// `artistLinks.artist` (+ translations) under every performer there
// would inline each artist once per member link on every event fetch,
// including the uncached live path. A separate narrow, cached read
// costs one extra round-trip per TTL instead.
//
// Order: stage-identity creation order (= seed order, i.e. canonical
// member order), id as the deterministic tiebreak. `artistLinks` by
// artist id so a member's home group (created before later collab
// groups) is listed first — only a tiebreak; the lineup picks the home
// group by roster headcount.
async function fetchEventRoster(
  id: bigint,
  locale: string,
): Promise<EventRosterEntry[]> {
  const localeFilter = { locale: { in: [locale, FALLBACK_LOCALE] } };
  const translationSelect = {
    where: localeFilter,
    select: { locale: true, name: true, shortName: true },
  } as const;
  const rows = await prisma.eventPerformer.findMany({
    where: { eventId: id },
    orderBy: [
      { stageIdentity: { createdAt: "asc" } },
      { stageIdentityId: "asc" },
    ],
    select: {
      isGuest: true,
      stageIdentity: {
        select: {
          id: true,
          slug: true,
          originalName: true,
          originalShortName: true,
          originalLanguage: true,
          translations: translationSelect,
          artistLinks: {
            orderBy: { artistId: "asc" },
            select: {
              artist: {
                select: {
                  id: true,
                  slug: true,
                  type: true,
                  color: true,
                  parentArtistId: true,
                  isMainUnit: true,
                  isDeleted: true,
                  originalName: true,
                  originalShortName: true,
                  originalLanguage: true,
                  translations: translationSelect,
                },
              },
            },
          },
        },
      },
    },
  });
  // serializeBigInt keeps the input's TS types while turning BigInt ids
  // into numbers at runtime; `EventRosterEntry` describes the runtime
  // (number) shape — same boundary cast as `LiveSetlistItem` below.
  return serializeBigInt(rows) as unknown as EventRosterEntry[];
}

// Operators fill the roster well before a show and don't touch it
// during one, so even the live path takes the cached copy.
const getEventRoster = cachedQuery(
  "event-roster",
  (id: bigint, locale: string) => fetchEventRoster(id, locale),
  { revalidate: CACHE_TTL.event, tags: (id) => [eventTag(id)] },
);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  const metaT = await getTranslations({ locale, namespace: "Meta" });
  if (!/^\d+$/.test(id)) return { title: metaT("notFound") };
  const eventId = BigInt(id);
  // Sequential, not Promise.all: the palette derivation reads
  // `eventSeries.artist.color` + every `setlistItem.performers[].
  // stageIdentity.color`, all of which `getEvent` already pulls into
  // its single `relationJoins` mega-query. Running the previous
  // `deriveOgPaletteFromEvent(eventId)` in parallel was firing two
  // duplicate queries (Event.findUnique + SetlistItem.findMany)
  // against columns already in the cache — Sentry trace
  // 5086a051fbe14d3384b7000ceda86503 measured them at 570ms + 579ms
  // each. The cached-event variant computes the same palette
  // in-process and only touches the DB for the rare empty-roster
  // fallback (a setlist with no member colors at all).
  const event = await getEvent(eventId, locale);
  if (!event) return { title: metaT("notFound") };
  const palette = await deriveOgPaletteFromCachedEvent(event);
  const seriesFullName = event.eventSeries
    ? displayNameWithFallback(
        event.eventSeries,
        event.eventSeries.translations,
        locale,
        "full"
      )
    : null;
  const seriesShortName = event.eventSeries
    ? displayNameWithFallback(
        event.eventSeries,
        event.eventSeries.translations,
        locale,
        "short"
      )
    : null;
  const eventFullName = displayNameWithFallback(
    event,
    event.translations,
    locale,
    "full"
  );
  const city = resolveLocalizedField(
    event,
    event.translations,
    locale,
    "city",
    "originalCity"
  );
  const venue = resolveLocalizedField(
    event,
    event.translations,
    locale,
    "venue",
    "originalVenue"
  );

  // Event names are per-day labels ("東京公演 Day.2") that are
  // ambiguous on their own, while the series full name is identical for
  // every day of a tour — using it alone gave all days one shared
  // <title>. Prefix the series SHORT name ("蓮ノ空 6th Live") onto the
  // event's full name so each day's title is unique and still carries
  // the group keyword people search for.
  const headlineName =
    [seriesShortName || seriesFullName, eventFullName]
      .filter(Boolean)
      .join(" ") || null;
  const title = headlineName
    ? metaT("eventTitle", { name: headlineName })
    : "OpenSetlist";
  const details = [
    event.date ? formatVenueDate(event.date, locale) : "",
    venue ?? "",
    city ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  const description = [
    [details, seriesFullName ?? ""].filter(Boolean).join(" — "),
    metaT("eventDescriptionTail"),
  ]
    .filter(Boolean)
    .join(" · ");

  // Pin the status pill into the og:image URL. The crawler that scrapes
  // this page captures the URL with `&s=<status>` baked in, and the OG
  // route honors that value over the clock — so a link shared at T-2h
  // continues to show the "upcoming" pill in social previews even after
  // the event has transitioned to live/completed (cached unfurls on
  // X/Slack/Discord can outlive our CDN's TTL by days). Pages rendered
  // *after* the transition embed the new status, so fresh shares always
  // reflect current state. Existing shares (no `&s=`) fall through to
  // the route's clock-derived path — byte-for-byte the prior behavior.
  const ogStatus = getEventStatus(event);
  const ogImage = `/api/og/event/${id}?lang=${normalizeOgLocale(locale)}&v=${palette.fingerprint}&s=${ogStatus}`;
  const alternates = entityAlternates("events", locale, id, event.slug);

  return {
    title,
    description,
    alternates,
    openGraph: {
      title,
      description,
      url: alternates.canonical,
      siteName: "OpenSetlist",
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
      locale,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
      site: "@opensetlistdb",
    },
  };
}

async function getReactionCounts(eventId: bigint) {
  const groups = await prisma.setlistItemReaction.groupBy({
    by: ["setlistItemId", "reactionType"],
    where: {
      setlistItem: { eventId, isDeleted: false },
    },
    _count: true,
  });

  const result: Record<string, Record<string, number>> = {};
  for (const g of groups) {
    const key = g.setlistItemId.toString();
    if (!result[key]) result[key] = {};
    result[key][g.reactionType] = g._count;
  }
  return result;
}

/**
 * SSR seed for the event impressions list. Returns the most-recent
 * page (size = `IMPRESSION_PAGE_SIZE`) plus the cursor for the next
 * older page and the total impression count for the event — same
 * shape as the `/api/impressions` GET response so the client can
 * treat the SSR seed and the polled refresh interchangeably.
 *
 * Single source of truth for the page size and the cursor format
 * lives in `src/lib/config.ts` and `src/lib/impressionCursor.ts`
 * respectively, so this fetch and the API route can't drift. The
 * count + findMany run in parallel; the count query is cheap
 * (indexed on the same WHERE shape).
 */
async function getEventImpressions(eventId: bigint): Promise<{
  impressions: Impression[];
  nextCursor: string | null;
  totalCount: number;
}> {
  const where = {
    eventId,
    supersededAt: null,
    isDeleted: false,
    isHidden: false,
  } as const;
  // `take: IMPRESSION_PAGE_SIZE + 1` mirrors the same lookahead
  // trick the `/api/impressions` route uses — without the +1, an
  // event whose impression count is an exact multiple of the page
  // size would emit a `nextCursor` that points at the start of an
  // empty next page. The client's "see older" button condition
  // (`loadMoreCursor !== null`) would falsely include that event
  // until the user clicked once and got nothing back.
  const [rowsPlusOne, totalCount] = await Promise.all([
    prisma.eventImpression.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: IMPRESSION_PAGE_SIZE + 1,
    }),
    prisma.eventImpression.count({ where }),
  ]);
  const hasMore = rowsPlusOne.length > IMPRESSION_PAGE_SIZE;
  const rows = hasMore
    ? rowsPlusOne.slice(0, IMPRESSION_PAGE_SIZE)
    : rowsPlusOne;
  const impressions = rows.map((r) => ({
    id: r.id,
    rootImpressionId: r.rootImpressionId,
    eventId: r.eventId.toString(),
    content: r.content,
    locale: r.locale,
    createdAt: r.createdAt.toISOString(),
  }));
  const lastReturned = rows[rows.length - 1];
  const nextCursor =
    hasMore && lastReturned
      ? encodeImpressionCursor(lastReturned.createdAt, lastReturned.id)
      : null;
  return { impressions, nextCursor, totalCount };
}

async function getTrendingSongs(
  eventId: bigint,
  locale: string,
  unknownSongLabel: string
): Promise<TrendingSong[]> {
  const groups = await prisma.setlistItemReaction.groupBy({
    by: ["setlistItemId"],
    where: {
      setlistItem: { eventId, isDeleted: false, songs: { some: {} } },
    },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 3,
  });

  if (groups.length === 0) return [];

  const itemIds = groups.map((g) => g.setlistItemId);

  // Same `[locale, "ja"]` translation filter as `getEvent` above —
  // trims the per-song translation join to the requested locale plus
  // the canonical-original safety net. `displayOriginalTitle` (called
  // below) does a strict locale lookup that falls through to the
  // parent `originalTitle` when no row matches, so the filter is safe.
  //
  // The nested `include` here previously emitted 4 sequential SELECTs
  // (SetlistItem → SetlistItemSong → Song → SongTranslation), one per
  // relation level — Prisma's default DataLoader-style fan-out. PR
  // #262 enabled the `relationJoins` preview feature, which collapses
  // this exact shape into a single LATERAL JOIN with JSONB
  // aggregation. Same query, same result, one roundtrip instead of
  // four.
  //
  // q2 (items) and q3 (typeBreakdown) both only depend on `itemIds`
  // from q1 above, so they run in parallel. Trace
  // 5086a051fbe14d3384b7000ceda86503 had these chained sequentially,
  // burning ~194ms of wall-clock that the second query didn't need.
  const [items, typeBreakdown] = await Promise.all([
    prisma.setlistItem.findMany({
      where: { id: { in: itemIds } },
      include: {
        songs: {
          include: {
            song: {
              include: {
                translations: {
                  where: { locale: { in: [locale, FALLBACK_LOCALE] } },
                },
              },
            },
          },
          orderBy: { order: "asc" },
          take: 1,
        },
      },
    }),
    prisma.setlistItemReaction.groupBy({
      by: ["setlistItemId", "reactionType"],
      where: { setlistItemId: { in: itemIds } },
      _count: true,
    }),
  ]);

  const typeMap: Record<string, Record<string, number>> = {};
  for (const g of typeBreakdown) {
    const key = g.setlistItemId.toString();
    if (!typeMap[key]) typeMap[key] = {};
    typeMap[key][g.reactionType] = g._count;
  }

  // Map the items so the per-group lookup below is O(1) instead of
  // O(n×m) via `Array.find`. With trending top-3 both sides are
  // bounded at 3, so the practical difference is ~9 ops/request —
  // negligible — but the Map keeps the hot path linear regardless of
  // any future change to the `take: 3` cap.
  const itemById = new Map(items.map((i) => [i.id, i] as const));

  return groups.map((g) => {
    const item = itemById.get(g.setlistItemId);
    const song = item?.songs[0]?.song;
    // Original-primary title display — same cascade as <SetlistRow>
    // so the trending card reads "originalTitle (sub: localizedTitle)"
    // consistently with the main setlist below it. Items without a
    // backed song (rare; admin-typed placeholder) fall through to the
    // i18n unknown label on the main slot.
    const titleDisp = song
      ? displayOriginalTitle(song, song.translations, locale)
      : null;

    const types = typeMap[g.setlistItemId.toString()] ?? {};

    return {
      setlistItemId: g.setlistItemId.toString(),
      mainTitle: titleDisp?.main ?? unknownSongLabel,
      subTitle: titleDisp?.sub ?? null,
      variantLabel: titleDisp?.variant ?? null,
      totalReactions: g._count.id,
      // Pass the per-type counts straight through. The renderer in
      // `<TrendingSongs>` iterates `REACTION_TYPES` (canonical order)
      // and falls back to 0 for missing keys, so the shape here is
      // just the raw map.
      reactionCounts: types,
    };
  });
}

export default async function EventPage({ params }: Props) {
  const { locale, id, slug } = await params;

  let eventId: bigint;
  try {
    eventId = BigInt(id);
  } catch {
    notFound();
  }

  // Launch `getEvent` in parallel with the i18n + per-event helper
  // batch — all six only need `eventId` (already parsed from the URL
  // above), so there's no dependency forcing `getEvent` to be serial
  // in front. Trending stays serial after this batch because the
  // skip-when-ongoing decision (see comment at the trending fetch
  // below) needs `event.status` from `getEvent` first; running
  // trending unconditionally would reintroduce ~940ms of pure DB
  // waste during live shows that the existing skip avoids — see
  // `LiveSetlist.tsx:62-64` for the client-side re-derivation that
  // makes the SSR fetch dead weight when ongoing.
  //
  // The live seed is resolved once and shared: when present, its
  // reaction counts and TOP-3 replace the standalone queries (same
  // snapshot as the items — see `getLiveSeed`).
  const liveSeedPromise = getLiveSeed(eventId, locale);
  const [
    event,
    t,
    ct,
    st,
    aT,
    reactionCounts,
    impressionsResult,
    fanTop3,
    roster,
    liveSeed,
  ] = await Promise.all([
      getEvent(eventId, locale),
      getTranslations("Event"),
      getTranslations("Common"),
      getTranslations("Song"),
      getTranslations("Artist"),
      liveSeedPromise.then(
        (seed) => seed?.reactionCounts ?? getReactionCounts(eventId),
      ),
      getEventImpressions(eventId),
      // Wishlist fan TOP-3 — shared loader in src/lib/wishes/top3.ts
      // so polled `/api/setlist` and this SSR seed always emit the
      // same shape (incl. soft-delete filter + deterministic ordering).
      // Cheap bounded query; safe on completed events (returns the
      // historical aggregate).
      liveSeedPromise.then(
        (seed) => seed?.top3Wishes ?? fetchEventWishlistTop3(eventId, locale),
      ),
      getEventRoster(eventId, locale),
      liveSeedPromise,
    ]);
  if (!event) notFound();
  // Bare id / wrong or legacy localized slug → 308 to the canonical
  // `/events/{id}/{db-slug}`. Runs after the parallel batch above
  // rather than before it: serializing `getEvent` in front would add
  // a DB round-trip to every canonical hit (the common case) to save
  // work only on the rare non-canonical one.
  enforceCanonicalSlug("events", locale, id, event.slug, slug);

  // Anchor every per-request status read to the same `now`. Two
  // `getEventStatus(event)` calls without this would each construct
  // their own `new Date()` and could disagree at a boundary tick (e.g.
  // status flips ongoing → completed between the polling-gate
  // computation and the header-badge computation). Pass `referenceNow`
  // through to the second call below so the page is internally
  // consistent.
  const referenceNow = new Date();
  const resolvedStatus = getEventStatus(event, referenceNow);
  const isOngoing = resolvedStatus === "ongoing";
  // Wishlist + Predicted Setlist visibility gate (D-7 default, or the
  // per-event `engagementOpensAt` override). Snap-frozen
  // at SSR with the same `referenceNow` that drives the rest of this
  // page — see `src/lib/eventTiming.ts#isWishPredictOpen` for why
  // we don't tick this client-side. Threaded through
  // `<LiveEventLayout>` → `<LiveSetlist>` → both child surfaces.
  const wishPredictOpen = isWishPredictOpen(
    {
      startTime: event.startTime,
      status: resolvedStatus,
      engagementOpensAt: event.engagementOpensAt,
    },
    referenceNow,
  );
  const {
    impressions,
    nextCursor: impressionsNextCursor,
    totalCount: impressionsTotalCount,
  } = impressionsResult;

  // Skip the 3-query SSR trending fetch when ongoing — LiveSetlist derives
  // trending client-side from `initialReactionCounts` on first paint and
  // refreshes from polling thereafter, so the SSR result would just be
  // thrown away on a hot path (live events are the high-traffic case).
  const trendingSongs = isOngoing
    ? []
    : await getTrendingSongs(eventId, locale, st("unknown"));

  // Predicted-setlist song-picker catalog (v0.13.14+). Only loaded
  // while `resolvedStatus === "upcoming"` — past-lock the picker UI is
  // hidden anyway; running the query would be dead weight. Two scopes:
  //
  //   - Single-artist path (`eventSeries.artist` set + alive): the
  //     artist and all its descendants; chips from `deriveUnitFilters`
  //     (a sub-unit with zero songs produces no chip). Composite chips
  //     ("all" / "others") use `Predict.picker` translations; group /
  //     individual labels come from the artist's localized name.
  //   - Festival path (no series artist — the Fes, n10): one catalog
  //     per root group reached from the roster, merged and deduped,
  //     with one chip per group (see `src/lib/predict/festivalCatalog.ts`).
  //     Only an upcoming multi-artist event with NO roster still has
  //     no defensible scope; there the picker hides and the surface
  //     degrades to copy-from-past + share CTA.
  const seriesPrimaryArtist =
    event.eventSeries?.artist && !event.eventSeries.artist.isDeleted
      ? event.eventSeries.artist
      : null;
  let availableSongs: AvailableSong[] = [];
  let unitFilters: UnitFilter[] = [];
  if (resolvedStatus === "upcoming" && seriesPrimaryArtist) {
    const [songs, predictPickerTrans] = await Promise.all([
      getAvailableSongsCached(BigInt(seriesPrimaryArtist.id), locale),
      getTranslations("Predict.picker"),
    ]);
    availableSongs = songs;
    const primaryArtistLabel = displayNameWithFallback(
      seriesPrimaryArtist,
      seriesPrimaryArtist.translations,
      locale,
      "short",
    );
    const safePrimaryArtistId = safeBigIntToNumber(seriesPrimaryArtist.id);
    unitFilters = deriveUnitFilters(
      songs,
      safePrimaryArtistId,
      primaryArtistLabel,
      predictPickerTrans("filterAll"),
      predictPickerTrans("filterOthers"),
      colors.primary,
    );
  } else if (resolvedStatus === "upcoming" && roster.length > 0) {
    const hierarchy = await getArtistHierarchyCached();
    const groupRefs = resolveFestivalGroups(roster, hierarchy);
    if (groupRefs.length > 0) {
      // Sorted id key so the display-row cache entry is independent of
      // roster order (the chip ORDER still comes from `groupRefs`).
      const idKey = joinIdKey(
        groupRefs.map((g) => g.rootId).sort((a, b) => Number(a) - Number(b)),
      );
      const [groupArtists, perGroup, predictPickerTrans] = await Promise.all([
        getFestivalGroupArtistsCached(idKey, locale),
        Promise.all(
          groupRefs.map((g) => getAvailableSongsCached(BigInt(g.rootId), locale)),
        ),
        getTranslations("Predict.picker"),
      ]);
      const artistById = new Map(groupArtists.map((a) => [String(a.id), a]));
      // A root that came back missing (soft-deleted between the
      // hierarchy read and this one) or whose id isn't JS-safe drops
      // out together with its catalog, keeping the two arrays aligned.
      const groups: Array<{
        artistId: number;
        slug: string;
        label: string;
        color: string | null;
      }> = [];
      const groupCatalogs: AvailableSong[][] = [];
      groupRefs.forEach((ref, i) => {
        const artist = artistById.get(ref.rootId);
        const artistId = artist ? safeBigIntToNumber(artist.id) : null;
        if (!artist || artistId === null) return;
        groups.push({
          artistId,
          slug: artist.slug,
          label: displayNameWithFallback(
            artist,
            artist.translations,
            locale,
            "short",
          ),
          color: artist.color,
        });
        groupCatalogs.push(perGroup[i]);
      });
      availableSongs = mergeFestivalCatalog(
        groups.map((g) => g.artistId),
        groupCatalogs,
      );
      unitFilters = deriveFestivalFilters(
        groups,
        availableSongs,
        predictPickerTrans("filterAll"),
        predictPickerTrans("filterOthers"),
        colors.primary,
      );
    }
  }

  const eventFullName = displayNameWithFallback(
    event,
    event.translations,
    locale,
    "full"
  );
  const seriesShortName = event.eventSeries
    ? displayNameWithFallback(
        event.eventSeries,
        event.eventSeries.translations,
        locale,
        // `displayNameWithFallback` defaults to `"full"` — passing
        // `"short"` explicitly is what makes this variable actually
        // resolve to the localized shortName cascade. Without it,
        // breadcrumb + EventHeader were rendering the full name.
        "short",
      )
    : null;
  // Full localized series name for the EventHeader sidebar card's
  // series link (operator preference). Breadcrumb above stays on
  // `seriesShortName`; only the prominent first sidebar card opts
  // into the full form. Re-introduced after round-4 dropped it —
  // `headerTitle` doesn't need it (still cascades via
  // `eventFullName || seriesShortName`), but the EventHeader
  // `series.name` prop does.
  const seriesFullName = event.eventSeries
    ? displayNameWithFallback(
        event.eventSeries,
        event.eventSeries.translations,
        locale,
      )
    : null;
  // Short event name for the breadcrumb tail. Cascades the same way as
  // every other display-name resolution: localized shortName → localized
  // name → originalShortName → originalName.
  const eventShortName = displayNameWithFallback(
    event,
    event.translations,
    locale,
    "short"
  );

  // Artist context for EventHeader: prefer the series artist (link
  // target → /artists/{id}/{slug}); fall back to the series'
  // `organizerName` for multi-artist festivals where artistId is null.
  // Mirrors the cascade in the series detail page header.
  //
  // Soft-deleted artists are dropped — `Artist.isDeleted=true` rows
  // 404 on `/artists/{id}` (the artist page calls notFound()), so
  // linking to them would dead-end. Treat as absent and fall through
  // to the organizerName branch.
  const seriesArtist =
    event.eventSeries?.artist && !event.eventSeries.artist.isDeleted
      ? event.eventSeries.artist
      : null;
  const headerArtist = seriesArtist
    ? {
        // String() — `Artist.id` is BigInt; `Number(bigint)` truncates
        // precision for IDs >= 2^53. Mirrors the policy on
        // `series.id` (which `EventHeader` accepts as `number |
        // bigint` for the same reason).
        id: String(seriesArtist.id),
        slug: seriesArtist.slug,
        name:
          displayNameWithFallback(
            seriesArtist,
            seriesArtist.translations,
            locale
          ) || aT("unknown"),
      }
    : null;
  // Organizer (主催) labels resolve like city/venue: the viewer-locale
  // translation row, else the parent's original-language column. The
  // event-level value wins over the series one for JSON-LD (a
  // standalone multi-artist event carries its own organizer); the
  // header keeps reading the series value only, matching the series
  // page header it mirrors. Both `translations` relations in
  // `fetchEvent` are `include`d (where-filtered, not `select`-narrowed),
  // so the `organizerName` column arrives with every row.
  const seriesOrganizerName = event.eventSeries
    ? resolveLocalizedField(
        event.eventSeries,
        event.eventSeries.translations,
        locale,
        "organizerName",
        "organizerName"
      )
    : null;
  const eventOrganizerName = resolveLocalizedField(
    event,
    event.translations,
    locale,
    "organizerName",
    "organizerName"
  );
  const headerOrganizerName = !headerArtist ? seriesOrganizerName : null;
  const venue = resolveLocalizedField(
    event,
    event.translations,
    locale,
    "venue",
    "originalVenue"
  );
  const cityBase = resolveLocalizedField(
    event,
    event.translations,
    locale,
    "city",
    "originalCity"
  );
  // Mockup `event-page-desktop-mockup-v2.jsx:542` puts city next
  // to country (e.g. `Fukuoka, Japan`). `Event.country` is an
  // ISO-3166 code (`KR` / `JP` / `US`); resolve to the locale-
  // appropriate display name via `Intl.DisplayNames`. Server-only
  // call — Node.js bundles full ICU on Vercel, so the lookup is
  // deterministic and matches what the browser would produce.
  const countryName = event.country
    ? (() => {
        try {
          return (
            new Intl.DisplayNames(locale, { type: "region" }).of(
              event.country,
            ) ?? null
          );
        } catch {
          return null;
        }
      })()
    : null;
  const city =
    cityBase && countryName
      ? `${cityBase}, ${countryName}`
      : (cityBase ?? countryName);

  // Display title: event FULL name. The series short name already
  // renders as a small blue link above the title (in EventHeader's
  // series slot), so making the h1 *also* show the series name
  // would be redundant — the operator flagged this in round 3.
  // The h1 now carries the event identifier (e.g. "Day 2 ·
  // Marine Messe Fukuoka"), with the series link providing the
  // parent context above it.
  const headerTitle =
    eventFullName || seriesShortName || t("unknownEvent");

  // ───────────────────────────────────────────────────────────
  // Sidebar derivations
  //
  // The four sidebar values (`songsCount` + `reactionsValue` for the
  // EventHeader card; `sidebarUnits` for `<UnitsCard>`;
  // `sidebarPerformers` for `<PerformersCard>`) used to be built
  // inline in this file. They've been lifted to
  // `src/lib/sidebarDerivations.ts` so the same pure functions also
  // run client-side inside `LiveEventLayout` whenever
  // `useSetlistPolling` ticks during an ongoing event — that's what
  // makes the sidebar live-update with new setlist items / performers /
  // reactions instead of staying frozen on the server-rendered snapshot.
  //
  // The `event.performers` relation is the event-level guest roster
  // (NOT `setlistItems[].performers`, which is per-song
  // `SetlistItemMember[]`). Operators set guests before the show; we
  // pass it through as a stable prop and never poll it.
  //
  // Cast via `as unknown as LiveSetlistItem[]` mirrors the existing
  // boundary cast for `<LiveSetlist>` below: `serializeBigInt()`
  // converts BigInt → Number at runtime but its generic signature
  // preserves the input's TS types, so `event.setlistItems` reads as
  // bigint at the type level even though runtime values are numbers.
  // `LiveSetlistItem` mirrors the runtime (Number) shape.
  //
  // While ongoing, the live seed's items (already wire-shaped) are the
  // source, so the sidebar, the counts and the client's initial items
  // all describe the snapshot whose `rev` the client starts from.
  const setlistItemsForDerivation: LiveSetlistItem[] = liveSeed
    ? liveSeed.items
    : (event.setlistItems as unknown as LiveSetlistItem[]);
  const eventPerformers: EventPerformerSummary[] = event.performers.map(
    (p) => ({
      stageIdentityId: p.stageIdentityId,
      isGuest: p.isGuest,
    }),
  );
  const { units: sidebarUnits, performers: sidebarPerformers } =
    deriveSidebarUnitsAndPerformers(
      setlistItemsForDerivation,
      eventPerformers,
      locale,
      aT("unknown"),
      t("unknownPerformer"),
    );
  const songsCount = deriveSongsCount(setlistItemsForDerivation);
  const reactionsValue = deriveReactionsValue(reactionCounts, locale);

  // Roster-derived lineup. Computed for every status because its
  // `groups` also feed the JSON-LD performers, but handed to the
  // sidebar only for upcoming events — completed-with-empty-setlist
  // and the live sidebar keep their item-derived behavior.
  const rosterLineup: Lineup | null =
    roster.length > 0
      ? deriveLineupFromRoster(
          roster,
          locale,
          aT("unknown"),
          t("unknownPerformer"),
        )
      : null;
  const sidebarLineup =
    resolvedStatus === "upcoming" && rosterLineup
      ? { units: rosterLineup.units, performers: rosterLineup.performers }
      : null;

  // Pre-show empty-state copy pieces, venue-local and server-formatted
  // (hydration-stable). The predict-opens line shows only while the
  // window is still ahead — once open, the predict surface itself is
  // on the page. The date comes from `wishPredictOpensAt`, the same
  // instant the gate uses, so a per-event `engagementOpensAt` override
  // is announced correctly instead of the D-7 default.
  const setlistStartLabel =
    resolvedStatus === "upcoming"
      ? formatVenueStart(event.startTime, event.country, locale)
      : null;
  // `startTime` is non-null in the schema; the truthiness guard is
  // belt-and-braces so a bad row can never turn `new Date(null)` into
  // an epoch-1970 "opens" date.
  const predictOpensLabel =
    resolvedStatus === "upcoming" && !wishPredictOpen && event.startTime
      ? formatVenueStart(
          wishPredictOpensAt(
            new Date(event.startTime),
            event.engagementOpensAt,
          ),
          event.country,
          locale,
        )
      : null;

  // schema.org MusicEvent. Name mirrors the <title> composition (series
  // short + event full) so a per-day name like "Day.1" isn't ambiguous
  // on its own. Performers: the lineup's host groups, else the series
  // artist (single-artist events without a roster).
  const jsonLdName =
    [seriesShortName || seriesFullName, eventFullName]
      .filter(Boolean)
      .join(" ") || headerTitle;
  const rosterHostGroups =
    rosterLineup?.groups.filter((g) => !g.isGuest) ?? [];
  const jsonLdPerformers =
    rosterHostGroups.length > 0
      ? rosterHostGroups
      : headerArtist
        ? [headerArtist]
        : [];
  const eventJsonLd = buildEventJsonLd({
    name: jsonLdName,
    startTime: event.startTime,
    country: event.country,
    status: resolvedStatus,
    venue,
    city: cityBase,
    performers: jsonLdPerformers,
    organizerName: eventOrganizerName ?? seriesOrganizerName,
    canonicalUrl: absoluteUrl(entityPath("events", locale, id, event.slug)),
    locale,
  });

  // Breadcrumb: always [Home › seriesShort › eventShort] when a series
  // exists; falls back to [Home › eventShort] otherwise. Operator
  // confirmed "Home › series › event" as the canonical shape (mockup
  // `event-page-desktop-mockup-v2.jsx:481-485`); the prior 2-item
  // shape (series → event) dropped Home and was inconsistent with
  // every other detail page's breadcrumb. Hrefs are fully
  // locale-prefixed since `Breadcrumb` uses `next/link`.
  const breadcrumbItems: BreadcrumbItem[] = [
    { label: ct("home"), href: `/${locale}` },
    ...(event.eventSeries && seriesShortName
      ? [
          {
            label: seriesShortName,
            href: `/${locale}/series/${event.eventSeries.id}/${event.eventSeries.slug}`,
          } satisfies BreadcrumbItem,
        ]
      : []),
    { label: eventShortName || t("unknownEvent") },
  ];

  return (
    <main
      // Fluid width — operator wants the page to flow without a fixed
      // cap. The inner sidebar+main grid governs natural width via
      // `lg:grid-cols-[300px_1fr]`. Page padding still applies.
      className="px-4 py-8 lg:px-8"
      // Match the slate-tinted page surface every other top-level page
      // uses (home, events list, artists, series, legal). Without it,
      // the white EventHeader card has no contrast against the body and
      // the sticky desktop sidebar reads as "missing".
      style={{ background: colors.bgPage }}
    >
      {/* Next's metadata API has no JSON-LD slot; an inline script in
          the body is Google's documented equivalent. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(eventJsonLd) }}
      />
      <Breadcrumb ariaLabel={ct("breadcrumb")} items={breadcrumbItems} />

      {/*
        Layout grid + every dynamic-state owner now lives inside
        `<LiveEventLayout>` — that wrapper holds the page's sole
        `useSetlistPolling` subscription and re-derives the four
        sidebar values (songsCount, reactionsValue, sidebarUnits,
        sidebarPerformers) from the same poll cycle that drives the
        right-column setlist. The page (server component) keeps doing
        the SSR derivation so first paint is byte-identical and
        crawlers see the populated sidebar.
      */}
      <LiveEventLayout
        eventId={id}
        isOngoing={isOngoing}
        locale={locale}
        // Rendered as a server-component slot. `LiveEventLayout` is a
        // client component that owns the column-layout grid + sibling
        // order between `<LiveSetlist>` and `<EventImpressions>`; passing
        // EventBdSection's JSX through as a node keeps the section
        // server-rendered (state machine + bonus selection on the server)
        // without making LiveEventLayout aware of the BD data shape.
        bdSection={
          <EventBdSection
            event={{
              id: event.id,
              startTime: event.startTime,
              // Use the page's snap-frozen `resolvedStatus`
              // (getEventStatus at request time), not the raw stored
              // `event.status` — they can disagree at a clock boundary
              // (stored status updated lazily), and a mismatch would let
              // the BD purchase CTA open while the page renders `ongoing`
              // (resolveEventBdState's D+0 ad gate keys off `=== "ongoing"`).
              // `resolvedStatus` is the UI status; its only value outside
              // the DB EventStatus enum is `"upcoming"`, which the resolver
              // treats the same as the DB's pre-event `"scheduled"` (neither
              // is ongoing/cancelled → time-based logic takes over), so map
              // it across to satisfy EventStatus.
              status: resolvedStatus === "upcoming" ? "scheduled" : resolvedStatus,
              bdAlbumId: event.bdAlbumId ?? null,
              // Run the bdAlbum subtree through serializeBigIntAsString
              // so the **type system** narrows to BigIntStringified
              // (string ids + ISO-string Dates) — the same contract the
              // bonus-display helpers (resolveStoreName /
              // resolveBonusType) expect, sourced from AlbumInfoCard /
              // ListingCard / AlbumBonusTab. At runtime this is
              // effectively a deep clone: getEvent already ran
              // serializeBigInt over the whole tree, so the bigints are
              // already Numbers (not bigints) by the time we get here —
              // serializeBigIntAsString's replacer only matches
              // `typeof === "bigint"`, leaves Numbers alone. The
              // section's read sites (template literals,
              // React keys, bonus-helper translation lookups) are all
              // coercion-tolerant between Number and string, so the
              // residual type/runtime mismatch on id columns is the
              // same shape every other Prisma-payload consumer in this
              // file accepts (see LiveSetlistItem cast at line 881).
              bdAlbum: event.bdAlbum
                ? serializeBigIntAsString(event.bdAlbum)
                : null,
            }}
            locale={locale}
            referenceNow={referenceNow}
          />
        }
        unknownArtistLabel={aT("unknown")}
        unknownPerformerLabel={t("unknownPerformer")}
        unknownSongLabel={st("unknown")}
        eventPerformers={eventPerformers}
        status={resolvedStatus}
        isWishPredictOpen={wishPredictOpen}
        // Match the rest of the codebase's badge convention: `LIVE`
        // for ongoing events (home, event list, artist/member/series
        // detail all use t("live")), localized status text for
        // upcoming/completed/cancelled. Without this, the same
        // ongoing event reads as "LIVE" in the event list but
        // "진행 중" / "Ongoing" / "進行中" on its own detail page.
        statusLabel={
          resolvedStatus === "ongoing"
            ? t("live")
            : t(`status.${resolvedStatus}`)
        }
        date={event.date}
        startTime={event.startTime}
        artist={headerArtist}
        organizerName={headerOrganizerName}
        series={
          // EventHeader's series link shows the FULL localized
          // series name (operator preference: the sidebar's first
          // card is the most prominent place a viewer identifies
          // the tour, so the full canonical name is worth the line
          // height). Breadcrumb crumbs above continue to use the
          // short variant. String() at the boundary — EventHeader is
          // a client component and BigInt isn't serializable across
          // RSC. Same convention as `artist.id`.
          event.eventSeries && seriesFullName
            ? {
                id: String(event.eventSeries.id),
                slug: event.eventSeries.slug,
                name: seriesFullName,
              }
            : null
        }
        title={headerTitle}
        venue={venue}
        city={city}
        // Short variants — consumed by LiveEventLayout for the share
        // card header (v0.11.6 preference: prefer short over full for
        // the captured PNG; full names overflow on long series).
        // Other surfaces (EventHeader, breadcrumb) keep using
        // headerTitle / seriesFullName which already encode the
        // longer or short-with-fallback variant they want.
        seriesShortName={seriesShortName}
        eventShortName={eventShortName}
        initialImpressions={impressions}
        initialImpressionsNextCursor={impressionsNextCursor}
        initialImpressionsTotalCount={impressionsTotalCount}
        initialItems={setlistItemsForDerivation}
        initialReactionCounts={reactionCounts}
        initialSidebarUnits={sidebarUnits}
        initialSidebarPerformers={sidebarPerformers}
        lineup={sidebarLineup}
        setlistStartLabel={setlistStartLabel}
        predictOpensLabel={predictOpensLabel}
        initialSongsCount={songsCount}
        initialReactionsValue={reactionsValue}
        initialTrendingSongs={trendingSongs}
        initialFanTop3={fanTop3}
        initialRev={liveSeed ? revToNumber(liveSeed.rev) : null}
        initialCapturedAt={liveSeed ? liveSeed.capturedAt.toISOString() : null}
        availableSongs={availableSongs}
        unitFilters={unitFilters}
      />
    </main>
  );
}
