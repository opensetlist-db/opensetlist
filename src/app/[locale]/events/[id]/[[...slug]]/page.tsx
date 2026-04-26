import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
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
import { StatusBadge } from "@/components/StatusBadge";
import { deriveOgPaletteFromEvent } from "@/lib/ogPalette";
import { normalizeOgLocale } from "@/lib/ogLabels";
import { EMOJI_MAP } from "@/lib/reactions";
import type { TrendingSong } from "@/components/TrendingSongs";
import { LiveSetlist, type LiveSetlistItem } from "@/components/LiveSetlist";
import { EventImpressions, type Impression } from "@/components/EventImpressions";
import { EventDateTime } from "@/components/EventDateTime";
import EventStatusTicker from "@/components/EventStatusTicker";
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
        include: { translations: true },
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
              stageIdentity: { include: { translations: true } },
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

  const [t, ct, st, reactionCounts, impressions] = await Promise.all([
    getTranslations("Event"),
    getTranslations("Common"),
    getTranslations("Song"),
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

  const eventName = displayNameWithFallback(event, event.translations, locale);
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
        locale
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
  const venue = resolveLocalizedField(
    event,
    event.translations,
    locale,
    "venue",
    "originalVenue"
  );
  const city = resolveLocalizedField(
    event,
    event.translations,
    locale,
    "city",
    "originalCity"
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      {/* Breadcrumb */}
      <nav className="mb-4 flex flex-wrap items-center gap-1 text-sm text-zinc-500">
        <Link href={`/${locale}`} className="hover:underline">
          {ct("backToHome")}
        </Link>
        {event.eventSeries && seriesShortName && (
          <>
            {" / "}
            <Link
              href={`/${locale}/series/${event.eventSeries.id}/${event.eventSeries.slug}`}
              className="hover:underline"
            >
              {seriesShortName}
            </Link>
          </>
        )}
      </nav>

      {/* Header */}
      <header className="mb-8">
        <EventStatusTicker
          startTime={
            typeof event.startTime === "string"
              ? event.startTime
              : event.startTime?.toISOString() ?? null
          }
        />
        <h1 className="text-3xl font-bold">
          {seriesFullName || eventFullName || t("unknownEvent")}
        </h1>
        {seriesFullName && eventName && eventName !== seriesFullName && (
          <p className="mt-1 text-lg text-zinc-600">{eventName}</p>
        )}
        <div className="mt-2 space-y-1 text-sm text-zinc-600">
          <div className="flex items-center gap-2">
            <StatusBadge
              status={resolvedStatus}
              label={t(`status.${resolvedStatus}`)}
              size="md"
            />

            {event.date && (
              <EventDateTime
                date={event.date ?? null}
                startTime={event.startTime ?? null}
                variant="inline"
              />
            )}
          </div>
          {(venue || city) && (
            <div>
              {venue ?? city}
              {venue && city && `, ${city}`}
            </div>
          )}
        </div>
      </header>

      {/* Setlist (renders TrendingSongs at the top, derived from polling state
          while ongoing so trending refreshes alongside per-item counts). */}
      {/*
        serializeBigInt() converts BigInt → Number at runtime, but its generic
        signature preserves the input's TS types, so `setlistItems` still reports
        bigint ids. Cast at the boundary — LiveSetlistItem mirrors the runtime
        (Number) shape.
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
    </main>
  );
}
