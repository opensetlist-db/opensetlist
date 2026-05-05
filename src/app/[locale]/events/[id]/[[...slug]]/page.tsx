import { cache } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { formatVenueDate } from "@/lib/eventDateTime";
import {
  displayNameWithFallback,
  displayOriginalTitle,
  resolveLocalizedField,
} from "@/lib/display";
import { getEventStatus } from "@/lib/eventStatus";
import { deriveOgPaletteFromEvent } from "@/lib/ogPalette";
import { normalizeOgLocale } from "@/lib/ogLabels";
import type { TrendingSong } from "@/components/TrendingSongs";
import type { LiveSetlistItem } from "@/components/LiveSetlist";
import type { Impression } from "@/components/EventImpressions";
import type { FanTop3Entry } from "@/lib/types/setlist";
import { LiveEventLayout } from "@/components/LiveEventLayout";
import {
  deriveSidebarUnitsAndPerformers,
  deriveSongsCount,
  deriveReactionsValue,
  type EventPerformerSummary,
} from "@/lib/sidebarDerivations";
import { Breadcrumb, type BreadcrumbItem } from "@/components/Breadcrumb";
import { IMPRESSION_PAGE_SIZE } from "@/lib/config";
import { encodeImpressionCursor } from "@/lib/impressionCursor";
import { colors } from "@/styles/tokens";
import type { Metadata } from "next";

type Props = {
  params: Promise<{ locale: string; id: string }>;
};

// Wrapped in `react.cache()` so the duplicate call across
// `generateMetadata` and `EventPage` collapses to one DB fetch per
// request. Cache is per-request, scoped by RSC's request memoization
// — no cross-request leakage.
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
const getEvent = cache(async (id: bigint, locale: string) => {
  const localeFilter = { locale: { in: [locale, "ja"] } };
  const event = await prisma.event.findFirst({
    where: { id, isDeleted: false },
    include: {
      translations: { where: localeFilter },
      eventSeries: {
        include: {
          translations: { where: localeFilter },
          // Pulled in so EventHeader can render an artist link.
          // `artistId` is nullable on EventSeries (multi-artist
          // festivals fall back to `organizerName`).
          artist: { include: { translations: { where: localeFilter } } },
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
        omit: { note: true },
        include: {
          songs: {
            include: {
              song: {
                include: {
                  translations: { where: localeFilter },
                  artists: {
                    include: {
                      artist: {
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
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  const metaT = await getTranslations({ locale, namespace: "Meta" });
  if (!/^\d+$/.test(id)) return { title: metaT("notFound") };
  const eventId = BigInt(id);
  const [event, palette] = await Promise.all([
    getEvent(eventId, locale),
    deriveOgPaletteFromEvent(eventId),
  ]);
  if (!event) return { title: metaT("notFound") };
  const t = await getTranslations({ locale, namespace: "Event" });
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
        locale
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

  const headlineName = seriesFullName || eventFullName || null;
  const title = headlineName
    ? `${headlineName} ${t("setlist")} | OpenSetlist`
    : "OpenSetlist";
  const description = [
    event.date ? formatVenueDate(event.date, locale) : "",
    city ?? "",
    venue ?? "",
    seriesShortName ?? "",
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
  const pageUrl = `/${locale}/events/${id}/${event.slug}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: pageUrl,
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

/**
 * SSR seed for the wishlist (Phase 1B) fan TOP-3. One indexed
 * `groupBy` on `SongWish(eventId, songId)` followed by a bounded
 * `findMany` resolves the song display payload — same shape returned
 * by the polled `/api/setlist` endpoint. Empty array when no wishes
 * yet, so the wishlist surface still SSRs structurally for pre-show
 * events even before any fan submits.
 *
 * Translation locale filter: `[locale, "ja"]` — same trim as the
 * rest of the page query so the join doesn't fan out across every
 * locale.
 */
async function getEventWishlistTop3(
  eventId: bigint,
  locale: string,
): Promise<FanTop3Entry[]> {
  const groups = await prisma.songWish.groupBy({
    by: ["songId"],
    where: { eventId },
    _count: { _all: true },
    orderBy: { _count: { id: "desc" } },
    take: 3,
  });
  if (groups.length === 0) return [];

  const songIds = groups.map((g) => g.songId);
  const songs = await prisma.song.findMany({
    where: { id: { in: songIds } },
    select: {
      id: true,
      originalTitle: true,
      originalLanguage: true,
      variantLabel: true,
      baseVersionId: true,
      translations: {
        where: { locale: { in: [locale, "ja"] } },
        select: { locale: true, title: true, variantLabel: true },
      },
    },
  });
  const songById = new Map(songs.map((s) => [s.id, s] as const));

  // `as unknown as ...` per the project's serializeBigInt boundary
  // convention (page.tsx:617). Runtime values are numbers.
  return groups.flatMap((g) => {
    const song = songById.get(g.songId);
    if (!song) return [];
    return [
      {
        count: g._count._all,
        song: serializeBigInt(song) as unknown as FanTop3Entry["song"],
      },
    ];
  });
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
  const items = await prisma.setlistItem.findMany({
    where: { id: { in: itemIds } },
    include: {
      songs: {
        include: {
          song: {
            include: {
              translations: { where: { locale: { in: [locale, "ja"] } } },
            },
          },
        },
        orderBy: { order: "asc" },
        take: 1,
      },
    },
  });

  const typeBreakdown = await prisma.setlistItemReaction.groupBy({
    by: ["setlistItemId", "reactionType"],
    where: { setlistItemId: { in: itemIds } },
    _count: true,
  });

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
  const { locale, id } = await params;

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
  const [event, t, ct, st, aT, reactionCounts, impressionsResult, fanTop3] =
    await Promise.all([
      getEvent(eventId, locale),
      getTranslations("Event"),
      getTranslations("Common"),
      getTranslations("Song"),
      getTranslations("Artist"),
      getReactionCounts(eventId),
      getEventImpressions(eventId),
      // Wishlist fan TOP-3 — runs in parallel since it only depends
      // on `eventId` + `locale` (both already in scope). Cheap
      // bounded query; safe to fetch unconditionally even on
      // completed events (just returns the historical aggregate).
      getEventWishlistTop3(eventId, locale),
    ]);
  if (!event) notFound();

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
  const headerOrganizerName =
    !headerArtist && event.eventSeries?.organizerName
      ? event.eventSeries.organizerName
      : null;
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
  const setlistItemsForDerivation =
    event.setlistItems as unknown as LiveSetlistItem[];
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
        unknownArtistLabel={aT("unknown")}
        unknownPerformerLabel={t("unknownPerformer")}
        unknownSongLabel={st("unknown")}
        eventPerformers={eventPerformers}
        status={resolvedStatus}
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
        initialImpressions={impressions}
        initialImpressionsNextCursor={impressionsNextCursor}
        initialImpressionsTotalCount={impressionsTotalCount}
        initialItems={setlistItemsForDerivation}
        initialReactionCounts={reactionCounts}
        initialSidebarUnits={sidebarUnits}
        initialSidebarPerformers={sidebarPerformers}
        initialSongsCount={songsCount}
        initialReactionsValue={reactionsValue}
        initialTrendingSongs={trendingSongs}
        initialFanTop3={fanTop3}
      />
    </main>
  );
}
