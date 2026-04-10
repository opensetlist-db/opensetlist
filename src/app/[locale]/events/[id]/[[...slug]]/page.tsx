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
  return {
    title: tr?.name ? `${tr.name} | OpenSetlist` : "OpenSetlist",
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
              {seriesTr.name}
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
              {parentTr.name}
            </Link>
          </>
        )}
      </nav>

      {/* Header */}
      <header className="mb-8">
        <h1 className="text-3xl font-bold">{tr?.name ?? "Unknown Event"}</h1>
        <div className="mt-2 flex flex-wrap gap-3 text-sm text-zinc-600">
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
            <span>
              {ct("date")}: {formatDate(event.date, locale)}
            </span>
          )}
          {event.venue && (
            <span>
              {ct("venue")}: {event.venue}
              {event.city && `, ${event.city}`}
            </span>
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
            <SetlistTable items={mainItems} locale={locale} />
            {encoreItems.length > 0 && (
              <>
                <h3 className="mb-2 mt-6 text-lg font-semibold text-zinc-600">
                  {ct("encore")}
                </h3>
                <SetlistTable items={encoreItems} locale={locale} />
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
}: {
  items: Awaited<ReturnType<typeof getEvent>> extends infer E
    ? E extends { setlistItems: infer S }
      ? S
      : never
    : never;
  locale: string;
}) {
  return (
    <ol className="space-y-3">
      {items.map((item) => {
        const songNames = item.songs.map((s) => {
          const sTr = pickTranslation(s.song.translations, locale);
          return {
            id: s.song.id,
            title: sTr?.title ?? s.song.originalTitle,
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

        return (
          <li key={item.id} className="border-b border-zinc-100 pb-2">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 w-6 shrink-0 text-right text-sm font-mono text-zinc-400">
                {item.position}
              </span>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-1">
                  {songNames.map((song, i) => (
                    <span key={song.id}>
                      {i > 0 && (
                        <span className="mx-1 text-zinc-400">+</span>
                      )}
                      <Link
                        href={`/${locale}/songs/${song.id}/${slugify(song.title)}`}
                        className="font-medium text-blue-600 hover:underline"
                      >
                        {song.title}
                      </Link>
                      {song.variantLabel && (
                        <span className="ml-1 text-xs text-zinc-500">
                          ({song.variantLabel})
                        </span>
                      )}
                    </span>
                  ))}
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-sm text-zinc-500">
                  {item.stageType !== "full_group" && (
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs">
                      {item.unitName ?? item.stageType}
                    </span>
                  )}
                  {performers.length > 0 && (
                    <span>{performers.join(", ")}</span>
                  )}
                </div>
                {item.note && (
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
