import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  serializeBigInt,
  pickTranslation,
  slugify,
} from "@/lib/utils";
import { formatVenueDate } from "@/lib/eventDateTime";
import { displayName } from "@/lib/display";
import { getEventStatus, EVENT_STATUS_BADGE } from "@/lib/eventStatus";
import { TrendingSongs, type TrendingSong } from "@/components/TrendingSongs";
import { LiveSetlist, type LiveSetlistItem } from "@/components/LiveSetlist";
import { EventImpressions, type Impression } from "@/components/EventImpressions";
import { EventDateTime } from "@/components/EventDateTime";
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
  const event = await getEvent(BigInt(id), locale);
  if (!event) return { title: "Not Found" };
  const t = await getTranslations({ locale, namespace: "Event" });
  const tr = pickTranslation(event.translations, locale);
  const seriesTr = event.eventSeries
    ? pickTranslation(event.eventSeries.translations, locale)
    : null;

  const headlineName = seriesTr
    ? displayName(seriesTr, "full")
    : tr?.name
      ? displayName(tr, "full")
      : null;
  const title = headlineName
    ? `${headlineName} ${t("setlist")} | OpenSetlist`
    : "OpenSetlist";
  const description = [
    event.date ? formatVenueDate(event.date, locale) : "",
    tr?.city,
    tr?.venue,
    seriesTr ? displayName(seriesTr) : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const ogImage = `/api/og/event/${id}`;
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

const EMOJI_MAP: Record<string, string> = {
  waiting: "😭",
  best: "🔥",
  surprise: "😱",
  moved: "🩷",
};

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
    where: { eventId, isDeleted: false, isHidden: false },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  return rows.map((r) => ({
    id: r.id,
    eventId: r.eventId.toString(),
    content: r.content,
    locale: r.locale,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

async function getTrendingSongs(
  eventId: bigint,
  locale: string
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
    const sTr = song ? pickTranslation(song.translations, locale) : null;
    const songTitle = sTr?.title ?? song?.originalTitle ?? "Unknown";

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

  const [t, ct, reactionCounts, trendingSongs, impressions] = await Promise.all([
    getTranslations("Event"),
    getTranslations("Common"),
    getReactionCounts(eventId),
    getTrendingSongs(eventId, locale),
    getEventImpressions(eventId),
  ]);

  const tr = pickTranslation(event.translations, locale);

  const seriesTr = event.eventSeries
    ? pickTranslation(event.eventSeries.translations, locale)
    : null;

  const isOngoing = getEventStatus(event) === "ongoing";

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      {/* Breadcrumb */}
      <nav className="mb-4 flex flex-wrap items-center gap-1 text-sm text-zinc-500">
        <Link href={`/${locale}`} className="hover:underline">
          {ct("backToHome")}
        </Link>
        {event.eventSeries && seriesTr && (
          <>
            {" / "}
            <Link
              href={`/${locale}/series/${event.eventSeries.id}/${slugify(seriesTr.name)}`}
              className="hover:underline"
            >
              {displayName(seriesTr)}
            </Link>
          </>
        )}
      </nav>

      {/* Header */}
      <header className="mb-8">
        <h1 className="text-3xl font-bold">
          {seriesTr
            ? displayName(seriesTr, "full")
            : tr?.name ?? t("unknownEvent")}
        </h1>
        {seriesTr && tr?.name && (
          <p className="mt-1 text-lg text-zinc-600">{tr.name}</p>
        )}
        <div className="mt-2 space-y-1 text-sm text-zinc-600">
          <div className="flex items-center gap-2">
            {(() => {
              const badge = EVENT_STATUS_BADGE[getEventStatus(event)];
              return (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.color}`}
                >
                  {t(badge.labelKey)}
                </span>
              );
            })()}
            {event.date && (
              <EventDateTime
                date={event.date ?? null}
                startTime={event.startTime ?? null}
                variant="inline"
              />
            )}
          </div>
          {tr?.venue && (
            <div>
              {tr.venue}
              {tr.city && `, ${tr.city}`}
            </div>
          )}
        </div>
      </header>

      {/* Trending Songs */}
      <TrendingSongs songs={trendingSongs} />

      {/* Setlist */}
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
