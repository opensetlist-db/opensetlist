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

async function getEventSeries(id: bigint, locale: string) {
  const series = await prisma.eventSeries.findFirst({
    where: { id, isDeleted: false },
    include: {
      translations: true,
      artist: { include: { translations: true } },
      parentSeries: { include: { translations: true } },
      childSeries: {
        where: { isDeleted: false },
        include: { translations: true },
        orderBy: { createdAt: "asc" },
      },
      events: {
        where: { isDeleted: false },
        include: {
          translations: true,
          childEvents: {
            where: { isDeleted: false },
            include: { translations: true },
            orderBy: { date: "asc" },
          },
        },
        orderBy: { date: "asc" },
      },
    },
  });
  if (!series) return null;
  return serializeBigInt(series);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  const series = await getEventSeries(BigInt(id), locale);
  if (!series) return { title: "Not Found" };
  const tr = pickTranslation(series.translations, locale);
  return {
    title: tr?.name ? `${tr.name} | OpenSetlist` : "OpenSetlist",
    description: tr?.description ?? undefined,
  };
}

export default async function EventSeriesPage({ params }: Props) {
  const { locale, id } = await params;

  let seriesId: bigint;
  try {
    seriesId = BigInt(id);
  } catch {
    notFound();
  }

  const series = await getEventSeries(seriesId, locale);
  if (!series) notFound();

  const t = await getTranslations("EventSeries");
  const ct = await getTranslations("Common");
  const evT = await getTranslations("Event");
  const tr = pickTranslation(series.translations, locale);
  const artistTr = series.artist
    ? pickTranslation(series.artist.translations, locale)
    : null;
  const parentTr = series.parentSeries
    ? pickTranslation(series.parentSeries.translations, locale)
    : null;

  // Separate top-level events (no parentEventId) from leg containers
  const topLevelEvents = series.events.filter((e) => !e.parentEventId);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      {/* Breadcrumb */}
      <nav className="mb-4 text-sm text-zinc-500">
        <Link href={`/${locale}`} className="hover:underline">
          {ct("backToHome")}
        </Link>
        {series.parentSeries && parentTr && (
          <>
            {" / "}
            <Link
              href={`/${locale}/series/${series.parentSeries.id}/${slugify(parentTr.name)}`}
              className="hover:underline"
            >
              {parentTr.name}
            </Link>
          </>
        )}
      </nav>

      {/* Header */}
      <header className="mb-8">
        <h1 className="text-3xl font-bold">{tr?.name ?? "Unknown Series"}</h1>
        <div className="mt-2 flex flex-wrap gap-3 text-sm text-zinc-500">
          <span>{t(`type.${series.type}`)}</span>
          {artistTr && (
            <Link
              href={`/${locale}/artists/${series.artist!.id}/${slugify(artistTr.name)}`}
              className="text-blue-600 hover:underline"
            >
              {artistTr.name}
            </Link>
          )}
          {series.organizerName && (
            <span>
              {t("organizer")}: {series.organizerName}
            </span>
          )}
        </div>
        {tr?.description && (
          <p className="mt-4 text-zinc-700">{tr.description}</p>
        )}
      </header>

      {/* Child Series */}
      {series.childSeries.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">{ct("series")}</h2>
          <ul className="space-y-1">
            {series.childSeries.map((child) => {
              const childTr = pickTranslation(child.translations, locale);
              return (
                <li key={child.id}>
                  <Link
                    href={`/${locale}/series/${child.id}/${slugify(childTr?.name ?? "")}`}
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

      {/* Events */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold">{t("events")}</h2>
        {topLevelEvents.length === 0 ? (
          <p className="text-zinc-500">{t("noEvents")}</p>
        ) : (
          <ul className="space-y-4">
            {topLevelEvents.map((event) => {
              const evTr = pickTranslation(event.translations, locale);
              const isLegContainer = event.childEvents.length > 0;

              return (
                <li key={event.id}>
                  <div className="flex items-baseline gap-3">
                    {event.date && (
                      <span className="shrink-0 text-sm text-zinc-400">
                        {formatDate(event.date, locale)}
                      </span>
                    )}
                    <Link
                      href={`/${locale}/events/${event.id}/${slugify(evTr?.name ?? "")}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {evTr?.name ?? "Unknown Event"}
                    </Link>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        event.status === "completed"
                          ? "bg-zinc-100 text-zinc-600"
                          : event.status === "upcoming"
                            ? "bg-blue-100 text-blue-700"
                            : event.status === "ongoing"
                              ? "bg-green-100 text-green-700"
                              : "bg-red-100 text-red-700"
                      }`}
                    >
                      {evT(`status.${event.status}`)}
                    </span>
                  </div>
                  {event.venue && (
                    <p className="ml-9 text-sm text-zinc-500">
                      {event.venue}
                      {event.city && `, ${event.city}`}
                    </p>
                  )}
                  {/* Nested child events (days) */}
                  {isLegContainer && (
                    <ul className="ml-9 mt-2 space-y-1 border-l-2 border-zinc-100 pl-3">
                      {event.childEvents.map((child) => {
                        const childTr = pickTranslation(
                          child.translations,
                          locale
                        );
                        return (
                          <li
                            key={child.id}
                            className="flex items-baseline gap-3"
                          >
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
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
