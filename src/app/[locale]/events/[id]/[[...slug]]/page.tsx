import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  serializeBigInt,
  pickTranslation,
  slugify,
  formatDate,
} from "@/lib/utils";
import { displayName, displaySongTitle } from "@/lib/display";
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
      parentEvent: {
        include: { translations: true },
      },
      childEvents: {
        where: { isDeleted: false },
        include: { translations: true },
        orderBy: { date: "asc" },
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
  const tr = pickTranslation(event.translations, locale);
  const seriesTr = event.eventSeries
    ? pickTranslation(event.eventSeries.translations, locale)
    : null;

  const title = tr?.name
    ? `${displayName(tr)} 셋리스트 | OpenSetlist`
    : "OpenSetlist";
  const description = [
    event.date
      ? new Date(event.date).toLocaleDateString("ko-KR", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : "",
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

  const t = await getTranslations("Event");
  const ct = await getTranslations("Common");
  const tr = pickTranslation(event.translations, locale);

  const seriesTr = event.eventSeries
    ? pickTranslation(event.eventSeries.translations, locale)
    : null;
  const parentTr = event.parentEvent
    ? pickTranslation(event.parentEvent.translations, locale)
    : null;

  // Split setlist into main and encore
  const mainItems = event.setlistItems.filter((item) => !item.isEncore);
  const encoreItems = event.setlistItems.filter((item) => item.isEncore);

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
        {event.parentEvent && parentTr && (
          <>
            {" / "}
            <Link
              href={`/${locale}/events/${event.parentEvent.id}/${slugify(parentTr.name)}`}
              className="hover:underline"
            >
              {displayName(parentTr)}
            </Link>
          </>
        )}
      </nav>

      {/* Header */}
      <header className="mb-8">
        <h1 className="text-3xl font-bold">{tr?.name ?? "Unknown Event"}</h1>
        <div className="mt-2 space-y-1 text-sm text-zinc-600">
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                event.status === "completed"
                  ? "bg-zinc-100 text-zinc-600"
                  : event.status === "upcoming"
                    ? "bg-blue-100 text-blue-700"
                    : event.status === "ongoing"
                      ? "bg-green-100 text-green-700"
                      : "bg-red-100 text-red-700"
              }`}
            >
              {t(`status.${event.status}`)}
            </span>
            {event.date && (
              <span>{formatDate(event.date, locale)}</span>
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

      {/* Child Events (legs/days) */}
      {event.childEvents.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">{ct("events")}</h2>
          <ul className="space-y-2">
            {event.childEvents.map((child) => {
              const childTr = pickTranslation(child.translations, locale);
              return (
                <li key={child.id} className="flex items-baseline gap-3">
                  <span className="shrink-0 text-sm text-zinc-400">
                    {formatDate(child.date, locale)}
                  </span>
                  <Link
                    href={`/${locale}/events/${child.id}/${slugify(childTr?.name ?? "")}`}
                    className="text-blue-600 hover:underline"
                  >
                    {childTr?.name ?? "Unknown"}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Setlist */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold">{t("setlist")}</h2>
        {event.setlistItems.length === 0 ? (
          <p className="text-zinc-500">{t("noSetlist")}</p>
        ) : (
          <>
            <SetlistTable items={mainItems} locale={locale} t={t} />
            {encoreItems.length > 0 && (
              <>
                <h3 className="mb-2 mt-6 text-lg font-semibold text-zinc-600">
                  {ct("encore")}
                </h3>
                <SetlistTable items={encoreItems} locale={locale} t={t} />
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}

function SetlistTable({
  items,
  locale,
  t,
}: {
  items: Awaited<ReturnType<typeof getEvent>> extends infer E
    ? E extends { setlistItems: infer S }
      ? S
      : never
    : never;
  locale: string;
  t: Awaited<ReturnType<typeof getTranslations<"Event">>>;
}) {
  return (
    <ol className="space-y-3">
      {items.map((item, index) => {
        const songNames = item.songs.map((s) => {
          const sTr = pickTranslation(s.song.translations, locale);
          const { main, sub } = displaySongTitle(s.song, sTr ?? null, locale);
          return {
            id: s.song.id,
            main,
            sub,
            variantLabel: s.song.variantLabel,
            artists: s.song.artists,
          };
        });

        const performers = item.performers.map((p) => {
          const siTr = pickTranslation(
            p.stageIdentity.translations,
            locale
          );
          return siTr?.name ?? "Unknown";
        });

        // Resolve unit artist for display (#6)
        const unitArtist = item.stageType !== "full_group" && item.artists?.[0]
          ? item.artists[0]
          : null;
        const unitArtistTr = unitArtist
          ? pickTranslation(unitArtist.artist.translations, locale)
          : null;

        return (
          <li key={item.id} className="border-b border-zinc-100 pb-2">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 w-6 shrink-0 text-right text-sm font-mono text-zinc-400">
                {index + 1}
              </span>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-1">
                  {songNames.length > 0 ? (
                    songNames.map((song, i) => (
                      <span key={song.id}>
                        {i > 0 && (
                          <span className="mx-1 text-zinc-400">+</span>
                        )}
                        <Link
                          href={`/${locale}/songs/${song.id}/${slugify(song.main)}`}
                          className="font-medium text-blue-600 hover:underline"
                        >
                          {song.main}
                        </Link>
                        {song.sub && (
                          <span className="ml-1 text-sm text-zinc-400">
                            {song.sub}
                          </span>
                        )}
                        {song.variantLabel && (
                          <span className="ml-1 text-xs text-zinc-500">
                            ({song.variantLabel})
                          </span>
                        )}
                      </span>
                    ))
                  ) : item.type !== "song" ? (
                    <span className="font-medium text-zinc-500">
                      {t(`itemType.${item.type}`)}
                    </span>
                  ) : (
                    <span className="text-zinc-400">곡 미지정</span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-sm text-zinc-500">
                  {item.stageType !== "full_group" && (
                    unitArtistTr ? (
                      <Link
                        href={`/${locale}/artists/${unitArtist!.artist.id}/${slugify(unitArtistTr.name)}`}
                        className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs hover:underline"
                      >
                        {unitArtistTr.name}
                      </Link>
                    ) : (
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs">
                        {item.unitName ?? item.stageType}
                      </span>
                    )
                  )}
                  {performers.length > 0 && (
                    <span>{performers.join(", ")}</span>
                  )}
                </div>
                {item.type === "song" && !item.isEncore && item.note && (
                  <p className="mt-1 text-xs text-zinc-400">{item.note}</p>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
