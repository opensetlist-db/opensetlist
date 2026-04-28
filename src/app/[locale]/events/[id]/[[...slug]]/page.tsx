import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import {
  serializeBigInt,
  pickLocaleTranslation,
} from "@/lib/utils";
import { formatVenueDate } from "@/lib/eventDateTime";
import {
  displayNameWithFallback,
  resolveLocalizedField,
} from "@/lib/display";
import { getEventStatus } from "@/lib/eventStatus";
import { deriveOgPaletteFromEvent } from "@/lib/ogPalette";
import { normalizeOgLocale } from "@/lib/ogLabels";
import { EMOJI_MAP } from "@/lib/reactions";
import type { TrendingSong } from "@/components/TrendingSongs";
import { LiveSetlist, type LiveSetlistItem } from "@/components/LiveSetlist";
import { EventImpressions, type Impression } from "@/components/EventImpressions";
import { EventHeader } from "@/components/EventHeader";
import { UnitsCard, type UnitsCardItem } from "@/components/event/UnitsCard";
import {
  PerformersCard,
  type PerformersCardItem,
} from "@/components/event/PerformersCard";
import { Breadcrumb, type BreadcrumbItem } from "@/components/Breadcrumb";
import { resolveUnitColor } from "@/lib/artistColor";
import { colors } from "@/styles/tokens";
import type { Metadata } from "next";

type Props = {
  params: Promise<{ locale: string; id: string }>;
};

async function getEvent(id: bigint, locale: string) {
  const event = await prisma.event.findFirst({
    where: { id, isDeleted: false },
    include: {
      translations: true,
      eventSeries: {
        include: {
          translations: true,
          // Pulled in so EventHeader can render an artist link.
          // `artistId` is nullable on EventSeries (multi-artist
          // festivals fall back to `organizerName`).
          artist: { include: { translations: true } },
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
                  translations: true,
                  artists: {
                    include: {
                      artist: { include: { translations: true } },
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
                  translations: true,
                  // `artistLinks` carries the StageIdentity → Artist
                  // membership rows. Needed by the page to build the
                  // per-unit members sublist on `<UnitsCard>` (each
                  // performer's links tell us which units they
                  // belong to).
                  artistLinks: {
                    select: {
                      artistId: true,
                      endDate: true,
                    },
                  },
                },
              },
              realPerson: { include: { translations: true } },
            },
          },
          artists: {
            include: {
              artist: { include: { translations: true } },
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

  const ogImage = `/api/og/event/${id}?lang=${normalizeOgLocale(locale)}&v=${palette.fingerprint}`;
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

async function getEventImpressions(eventId: bigint): Promise<Impression[]> {
  const rows = await prisma.eventImpression.findMany({
    where: { eventId, supersededAt: null, isDeleted: false, isHidden: false },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.map((r) => ({
    id: r.id,
    rootImpressionId: r.rootImpressionId,
    eventId: r.eventId.toString(),
    content: r.content,
    locale: r.locale,
    createdAt: r.createdAt.toISOString(),
  }));
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

  const items = await prisma.setlistItem.findMany({
    where: { id: { in: itemIds } },
    include: {
      songs: {
        include: {
          song: { include: { translations: true } },
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

  return groups.map((g) => {
    const item = items.find((i) => i.id === g.setlistItemId);
    const song = item?.songs[0]?.song;
    const sTr = song ? pickLocaleTranslation(song.translations, locale) : null;
    const songTitle = sTr?.title ?? song?.originalTitle ?? unknownSongLabel;

    const types = typeMap[g.setlistItemId.toString()] ?? {};
    const topType = Object.entries(types).sort((a, b) => b[1] - a[1])[0];

    return {
      setlistItemId: g.setlistItemId.toString(),
      songTitle,
      totalReactions: g._count.id,
      topReaction: topType
        ? { type: topType[0], emoji: EMOJI_MAP[topType[0]] ?? "", count: topType[1] }
        : { type: "best", emoji: "🔥", count: 0 },
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

  const event = await getEvent(eventId, locale);
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

  const [t, ct, st, aT, reactionCounts, impressions] = await Promise.all([
    getTranslations("Event"),
    getTranslations("Common"),
    getTranslations("Song"),
    getTranslations("Artist"),
    getReactionCounts(eventId),
    getEventImpressions(eventId),
  ]);

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
  const seriesFullName = event.eventSeries
    ? displayNameWithFallback(
        event.eventSeries,
        event.eventSeries.translations,
        locale,
        "full"
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

  // Sidebar count rows: `songsCount` mirrors `<LiveSetlist>`'s
  // subtitle predicate exactly — `type === "song"` AND a song row
  // is actually attached. An admin-created song-typed placeholder
  // with no song picked yet would inflate the EventHeader count
  // above the setlist subtitle, which the operator would read as
  // a bug. Reactions total sums every reaction across every setlist
  // item.
  const songsCount = event.setlistItems.filter(
    (i) => i.type === "song" && i.songs.length > 0,
  ).length;
  const reactionsCount = Object.values(reactionCounts).reduce(
    (sum, perItem) =>
      sum + Object.values(perItem).reduce((s, n) => s + n, 0),
    0,
  );
  // Pre-format the reaction-count display string server-side so the
  // locale-correct compact suffix (`1.2K` / `1.2천` / `1.2K`) renders
  // identically on first paint and on hydration — no SSR-vs-client
  // `Intl.NumberFormat` divergence even if the runtimes' ICU versions
  // differ slightly.
  const reactionsValue = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(reactionsCount);

  // ───────────────────────────────────────────────────────────
  // Sidebar Units + Performers data prep
  //
  // 1. Walk `setlistItems[].artists` once to build the unique unit
  //    list (deduped by `Artist.id`, type === "unit" only, first-
  //    seen order preserved). Each unit's color is resolved here:
  //    `Artist.color` if set, else `UNIT_COLOR_FALLBACK` — the same
  //    rule applies to both the Units card's color bar and the
  //    Performers card's pill tint, so resolving once keeps them
  //    in lockstep.
  //
  // 2. Walk `setlistItems[].performers` once to build the unit→
  //    members map. Each StageIdentity carries `artistLinks` with
  //    `artistId, endDate`; we look up `artistId` against the unit
  //    map. Membership rows whose `endDate` predates `referenceNow`
  //    are skipped (graduated members shouldn't show up on a
  //    current-event lineup).
  //
  // 3. Walk `setlistItems[].performers` once more to build the
  //    Performers card list — each character's pill tint is the
  //    color of their *primary* unit (first matching active link
  //    against the unit map). Falls back to `UNIT_COLOR_FALLBACK`
  //    if no unit link resolves at all.
  type SidebarUnit = UnitsCardItem & {
    /** Resolved color (`Artist.color` or `UNIT_COLOR_FALLBACK`). Always set. */
    resolvedColor: string;
  };

  const unitsById = new Map<string, SidebarUnit>();
  const memberSeen = new Map<string, Set<string>>();
  for (const item of event.setlistItems) {
    for (const a of item.artists) {
      if (a.artist.type !== "unit") continue;
      const id = String(a.artist.id);
      if (unitsById.has(id)) continue;
      const name =
        displayNameWithFallback(
          a.artist,
          a.artist.translations,
          locale,
          "short",
        ) || aT("unknown");
      unitsById.set(id, {
        id,
        slug: a.artist.slug,
        name,
        color: a.artist.color ?? null,
        resolvedColor: resolveUnitColor(a.artist),
        members: [],
      });
      memberSeen.set(id, new Set());
    }
  }

  // Helper: pick the primary (first-active) unit for a performer's
  // artist links. Returns null when no link points at one of the
  // event's unit set — caller then falls back to the global default.
  const pickPrimaryUnit = (
    links: { artistId: number | bigint; endDate: Date | string | null }[],
  ): SidebarUnit | null => {
    for (const link of links) {
      if (
        link.endDate &&
        new Date(String(link.endDate)).getTime() < referenceNow.getTime()
      ) {
        continue;
      }
      const u = unitsById.get(String(link.artistId));
      if (u) return u;
    }
    return null;
  };

  // Pass 2: populate per-unit member lists.
  for (const item of event.setlistItems) {
    for (const p of item.performers) {
      const links = p.stageIdentity.artistLinks ?? [];
      for (const link of links) {
        if (
          link.endDate &&
          new Date(String(link.endDate)).getTime() < referenceNow.getTime()
        ) {
          continue;
        }
        const unitId = String(link.artistId);
        const u = unitsById.get(unitId);
        if (!u) continue;
        const members = memberSeen.get(unitId)!;
        if (members.has(p.stageIdentity.id)) continue;
        members.add(p.stageIdentity.id);
        u.members.push(
          displayNameWithFallback(
            p.stageIdentity,
            p.stageIdentity.translations,
            locale,
            "short",
          ) || t("unknownPerformer"),
        );
      }
    }
  }
  // Drop `resolvedColor` from the Units card payload — the card
  // resolves its own fallback per row from `color`. The unit-color
  // map keeps `resolvedColor` for the Performers card lookup.
  const sidebarUnits: UnitsCardItem[] = [...unitsById.values()].map(
    ({ id, slug, name, color, members }) => ({
      id,
      slug,
      name,
      color,
      members,
    }),
  );

  // Sidebar Performers card: each pill tint is the primary unit's
  // resolved color. Personal `StageIdentity.color` is intentionally
  // NOT used — operator wants the lineup to read as "members of
  // these units" rather than "individual character palette".
  // Names use the FULL cascade (not "short") per operator
  // preference — sidebar pills have room for "林田乃理" (vs the
  // short "ノリ"), and the full form is unambiguous when scanning.
  const sidebarPerformers: PerformersCardItem[] = (() => {
    const seen = new Map<string, PerformersCardItem>();
    for (const item of event.setlistItems) {
      for (const p of item.performers) {
        const id = p.stageIdentity.id;
        if (seen.has(id)) continue;
        const name =
          displayNameWithFallback(
            p.stageIdentity,
            p.stageIdentity.translations,
            locale,
            "full",
          ) || t("unknownPerformer");
        const primaryUnit = pickPrimaryUnit(p.stageIdentity.artistLinks ?? []);
        seen.set(id, {
          id,
          name,
          // Always set — `resolveUnitColor` covers the case where
          // the primary unit's own color is null, and a missing
          // primary unit (rare) falls through to the same fallback.
          color:
            primaryUnit?.resolvedColor ?? resolveUnitColor({ color: null }),
        });
      }
    }
    return [...seen.values()];
  })();

  // Breadcrumb: always [Home › seriesShort › eventShort] when a series
  // exists; falls back to [Home › eventShort] otherwise. Operator
  // confirmed "Home › series › event" as the canonical shape (mockup
  // `event-page-desktop-mockup-v2.jsx:481-485`); the prior 2-item
  // shape (series → event) dropped Home and was inconsistent with
  // every other detail page's breadcrumb. Hrefs are fully
  // locale-prefixed since `Breadcrumb` uses `next/link`.
  const breadcrumbItems: BreadcrumbItem[] = [
    { label: ct("backToHome"), href: `/${locale}` },
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
        Mobile: single column (header on top, setlist + impressions below).
        Desktop (lg ≥ 1024px): 2-col grid 300px / 1fr with sticky sidebar at
        top: 72px. Grid's natural single-col on mobile means EventHeader
        renders above the main column without any extra layout branching.
      */}
      <div className="lg:grid lg:grid-cols-[300px_1fr] lg:gap-6 lg:items-start">
        {/* sticky offset = Nav.tsx desktop height (56px) + 16px breathing room.
            Three sidebar cards stacked with consistent gap; flex column wraps
            the stack so sticky positioning still applies to the topmost edge. */}
        <aside
          className="lg:sticky lg:top-[72px]"
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
        >
          <EventHeader
            status={resolvedStatus}
            statusLabel={t(`status.${resolvedStatus}`)}
            date={event.date}
            startTime={event.startTime}
            locale={locale}
            artist={headerArtist}
            organizerName={headerOrganizerName}
            series={
              event.eventSeries && seriesShortName
                ? {
                    // String() at the boundary — EventHeader is a
                    // client component and BigInt isn't serializable
                    // across RSC. Same convention as `artist.id`.
                    id: String(event.eventSeries.id),
                    slug: event.eventSeries.slug,
                    shortName: seriesShortName,
                  }
                : null
            }
            title={headerTitle}
            songsCount={songsCount}
            reactionsValue={reactionsValue}
            venue={venue}
            city={city}
          />
          <UnitsCard locale={locale} units={sidebarUnits} />
          <PerformersCard performers={sidebarPerformers} />
        </aside>

        <div className="mt-6 lg:mt-0 min-w-0">
          {/*
            serializeBigInt() converts BigInt → Number at runtime, but its
            generic signature preserves the input's TS types, so
            `setlistItems` still reports bigint ids. Cast at the boundary —
            LiveSetlistItem mirrors the runtime (Number) shape.
          */}
          <LiveSetlist
            eventId={id}
            initialItems={event.setlistItems as unknown as LiveSetlistItem[]}
            initialReactionCounts={reactionCounts}
            initialTrendingSongs={trendingSongs}
            unknownSongLabel={st("unknown")}
            isOngoing={isOngoing}
            locale={locale}
          />

          <EventImpressions
            eventId={id}
            initialImpressions={impressions}
            isOngoing={isOngoing}
          />
        </div>
      </div>
    </main>
  );
}
